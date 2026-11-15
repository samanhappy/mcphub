import { randomUUID } from 'node:crypto';

import type { ServerConfig, ServerInfo } from '../../types/index.js';
import { getServerDao } from '../../dao/index.js';
import { isStagingRuntimeSupported } from './settings.js';
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

export const containsStagingRef = (value: unknown): boolean => {
  if (typeof value === 'string') return value.startsWith('mcpfile://');
  if (Array.isArray(value)) return value.some(containsStagingRef);
  if (value && typeof value === 'object') return Object.values(value).some(containsStagingRef);
  return false;
};

/**
 * One server-id resolution for both the list projection and the call seam: a
 * server without a persisted id is never staged, and the two paths must not
 * disagree about which id they bind a ref to.
 */
export const resolveStagingServerId = (config: ServerConfig, name: string): string => {
  const id = config.id;
  if (!id || isLegacyServerId(id, name)) {
    throw new StagingError('invalid-ref', 'This server has no stable id; save it once first');
  }
  return id;
};

const errorText = (error: unknown): string => {
  if (error instanceof StagingError) return error.message;
  return 'File staging request failed';
};

/** Resolve the declared JSON-Schema type at a dot path; null means "unknown". */
const schemaTypeAt = (
  properties: Record<string, any>,
  param: string,
): string | null | undefined => {
  let node: any = { type: 'object', properties };
  for (const segment of param.split('.')) {
    if (!node || typeof node !== 'object') return null;
    const next =
      node.properties && typeof node.properties === 'object'
        ? node.properties[segment]
        : undefined;
    if (!next) return undefined;
    node = next;
  }
  return typeof node?.type === 'string' ? node.type : null;
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
  if (!isStagingRuntimeSupported()) return undefined;
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
  // Runtime names may or may not carry the server prefix depending on the
  // caller (direct API vs MCP client), so compare both sides unprefixed.
  const bareName = (name: string): string =>
    name.startsWith(prefix) ? name.slice(prefix.length) : name;
  const wanted = bareName(toolName);
  const toolDefinition = serverInfo.tools.find((tool) => bareName(tool.name) === wanted);
  const properties = toolDefinition?.inputSchema?.properties;
  if (properties && typeof properties === 'object') {
    for (const param of declared) {
      const type = schemaTypeAt(properties as Record<string, any>, param);
      if (type === undefined) {
        throw new StagingError(
          'invalid-ref',
          `Staged parameter "${param}" is not part of the tool input schema`,
        );
      }
      // A ref is a string. A declared number/boolean parameter can never carry
      // one, so the configuration is wrong and the call must not be rewritten.
      if (type !== null && type !== 'string') {
        throw new StagingError(
          'invalid-ref',
          `Staged parameter "${param}" is declared as ${type}, not a string`,
        );
      }
    }
  }
  return {
    serverName: serverInfo.name,
    serverId: resolveStagingServerId(fresh, serverInfo.name),
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
  let staged: StagedCall | undefined;
  try {
    staged = await resolveStagedCall(serverInfo, toolParams?.name);
  } catch (error) {
    // A misdeclared staging config is a tool-level error, not a crash: the
    // caller sees it as a failed call and other tools keep working.
    return { isError: true, content: [{ type: 'text', text: errorText(error) }] };
  }
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
