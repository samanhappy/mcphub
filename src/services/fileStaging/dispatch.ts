import { randomUUID } from 'node:crypto';

import type { ServerConfig, ServerInfo } from '../../types/index.js';
import { getServerDao } from '../../dao/index.js';
import { isReplicaMode } from '../../utils/replicaMode.js';
import { logger } from '../../utils/logger.js';
import { getNameSeparator } from '../../config/index.js';
import { findToolConfig } from '../../utils/toolConfig.js';
import { isLegacyServerId } from '../../utils/serverIdentity.js';
import {
  hasStagedTools,
  serverVersionMatchesPinnedProfile,
  validateSshServerConfig,
} from './adapter.js';
import { resolveStagingPrincipal } from './identity.js';
import { applyRewrite, planRewrite } from './rewrite.js';
import { getFileStagingSettings, getStagingStateStore } from './settings.js';
import { StagingError } from './types.js';

/**
 * The single staging seam for a concrete upstream tool call (#1056).
 *
 * Order matters and is security-relevant:
 *   1. re-read the server config and validate the trust declaration,
 *   2. take read pins on inputs and exclusive leases on outputs *before* the
 *      child is invoked,
 *   3. rewrite only the declared parameters,
 *   4. finalize (or fail) the outputs and release every pin,
 *      including on timeout/abort/throw.
 */

export interface StagedCall {
  serverName: string;
  serverId: string;
  toolName: string;
  inputParams: string[];
  outputParams: string[];
}

const containsStagingRef = (value: unknown): boolean => {
  if (typeof value === 'string') return value.startsWith('mcpfile://');
  if (Array.isArray(value)) return value.some(containsStagingRef);
  if (value && typeof value === 'object') return Object.values(value).some(containsStagingRef);
  return false;
};

const errorText = (error: unknown): string => {
  if (error instanceof StagingError) return error.message;
  return 'File staging request failed';
};

/** The staging target for one concrete tool call, or undefined for a normal call. */
export const resolveStagedCall = async (
  serverInfo: ServerInfo,
  toolName: string,
): Promise<StagedCall | undefined> => {
  const config: ServerConfig | undefined = serverInfo.config;
  if (!config?.staging || !hasStagedTools(config)) return undefined;
  // Replica mode cannot own a lease or a file. Disable staging, not the
  // server: non-staging tools keep working and a ref is rejected below.
  if (isReplicaMode()) return undefined;
  const settings = await getFileStagingSettings();
  // Master switch off: normal calls pass through, but a staging ref is still
  // rejected by the containsStagingRef guard below rather than forwarded.
  if (!settings.enabled) return undefined;
  // Trust decisions are re-read at call time: a group/visibility change must not
  // be bypassed by a stale in-memory config.
  const fresh = (await getServerDao().findById(serverInfo.name)) ?? config;
  const validation = validateSshServerConfig(fresh);
  if (!validation.ok || isLegacyServerId(fresh.id, serverInfo.name)) {
    // Disable staging for this server, not the server itself: other tools and
    // non-ref calls must keep working. A ref is refused by the guard below.
    logger.warn(
      `[staging] ${serverInfo.name} is not a staging target: ${
        validation.ok ? 'legacy server id' : validation.reason
      }`,
    );
    return undefined;
  }
  // Unknown version is as unsafe as a mismatch: the boundary behavior was
  // verified for one pinned release only.
  if (!serverVersionMatchesPinnedProfile(serverInfo.version)) {
    logger.warn(
      `[staging] ${serverInfo.name} reports version ${serverInfo.version ?? 'unknown'}; staging stays disabled`,
    );
    return undefined;
  }
  const runtimeNames = serverInfo.tools.map((tool) => tool.name);
  const toolConfig = findToolConfig(fresh.tools, serverInfo.name, toolName, runtimeNames);
  if (!toolConfig?.fileStaging?.enabled) return undefined;
  const declared = [
    ...(toolConfig.fileStaging.inputParams ?? []),
    ...(toolConfig.fileStaging.outputParams ?? []),
  ];
  // When the connected tool schema is known, a declared parameter must exist:
  // a typo would otherwise silently stage nothing until the child rejects it.
  const prefix = `${serverInfo.name}${getNameSeparator()}`;
  const bareName = toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
  const toolDefinition = serverInfo.tools.find(
    (tool) => tool.name === toolName || tool.name === bareName,
  );
  const properties = toolDefinition?.inputSchema?.properties;
  if (properties && typeof properties === 'object') {
    for (const param of declared) {
      const root = param.split('.')[0];
      if (!(root in (properties as Record<string, unknown>))) {
        throw new StagingError(
          'invalid-ref',
          `Staged parameter "${param}" is not part of the tool input schema`,
        );
      }
    }
  }
  return {
    serverName: serverInfo.name,
    serverId: fresh.id ?? serverInfo.name,
    toolName,
    inputParams: [...(toolConfig.fileStaging.inputParams ?? [])],
    outputParams: [...(toolConfig.fileStaging.outputParams ?? [])],
  };
};

export const dispatchStagedToolCall = async (
  serverInfo: ServerInfo,
  toolParams: any,
  invoke: (params: any) => Promise<any>,
  username: string | undefined,
): Promise<any> => {
  const staged = await resolveStagedCall(serverInfo, toolParams?.name);
  const args =
    toolParams?.arguments && typeof toolParams.arguments === 'object'
      ? toolParams.arguments
      : {};
  if (!staged) {
    // A staging reference is only honored in a declared parameter of a staging
    // tool; never forward an unrewritten ref to the child.
    if (containsStagingRef(args)) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'File staging reference is not allowed for this tool' }],
      };
    }
    return invoke(toolParams);
  }

  const plan = planRewrite(args, staged.inputParams, staged.outputParams);
  if (plan.inputRefs.length === 0 && plan.outputRefs.length === 0) return invoke(toolParams);

  const settings = await getFileStagingSettings();
  const store = await getStagingStateStore();
  const principal = await resolveStagingPrincipal(username);
  const leaseId = randomUUID();
  const paths = new Map<string, string>();
  const pinned: string[] = [];

  try {
    for (const ref of plan.inputRefs) {
      const record = await store.getOwnedRef(ref, principal.ownerHash);
      // A ref created for another server is not a capability for this one.
      if (record.serverId !== staged.serverId) {
        throw new StagingError('not-found', 'Staging reference not found');
      }
      if (record.state !== 'ready') {
        throw new StagingError('not-ready', 'The staged input is not ready');
      }
      await store.pinReadyRef(ref, principal.ownerHash);
      pinned.push(ref);
      paths.set(ref, await store.contentPathFor(ref, principal.ownerHash));
    }
    if (plan.outputRefs.length > 0) {
      for (const ref of plan.outputRefs) {
        const record = await store.getOwnedRef(ref, principal.ownerHash);
        if (record.serverId !== staged.serverId) {
          throw new StagingError('not-found', 'Staging reference not found');
        }
      }
      const grants = await store.acquireOutputLeases(
        principal.ownerHash,
        plan.outputRefs.map((ref) => ({ ref, leaseId, toolName: staged.toolName })),
        settings,
      );
      for (const grant of grants) paths.set(grant.ref, grant.contentPath);
    }

    let result: any;
    try {
      result = await invoke({ ...toolParams, arguments: applyRewrite(args, paths) });
    } catch (error) {
      await store.failOutputs(leaseId, plan.outputRefs).catch(() => undefined);
      throw error;
    }
    if (result?.isError) {
      await store.failOutputs(leaseId, plan.outputRefs).catch(() => undefined);
      return result;
    }
    if (plan.outputRefs.length > 0) {
      try {
        await store.finalizeOutputs(leaseId, plan.outputRefs, settings);
      } catch (error) {
        // A finalize failure means the tool ran but produced an unusable
        // output; fail the ref so the lease and its reserved quota are freed.
        await store.failOutputs(leaseId, plan.outputRefs).catch(() => undefined);
        return { isError: true, content: [{ type: 'text', text: errorText(error) }] };
      }
    }
    return result;
  } catch (error) {
    if (plan.outputRefs.length > 0) {
      await store.releaseLeases(leaseId, plan.outputRefs).catch(() => undefined);
    }
    return { isError: true, content: [{ type: 'text', text: errorText(error) }] };
  } finally {
    for (const ref of pinned) {
      await store.unpinRef(ref).catch(() => undefined);
    }
  }
};
