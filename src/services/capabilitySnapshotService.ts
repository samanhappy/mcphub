import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { specTypeSchemas } from '@modelcontextprotocol/client';
import { getCapabilitySnapshotDao } from '../dao/DaoFactory.js';
import { getServerEnvironment } from './serverConfigEnvironment.js';
import type { CapabilitySnapshot, ServerConfig, ServerInfo } from '../types/index.js';
import type { Tool as McpTool } from '@modelcontextprotocol/client';
import { logger } from '../utils/logger.js';

export interface CapabilityScope {
  username: string;
  revision: string;
}

const derive = promisify(scrypt);
const contexts = new WeakMap<
  ServerInfo,
  { snapshot: CapabilitySnapshot; pending: Promise<void> }
>();
const snapshotSchema = z.object({
  serverName: z.string(),
  principal: z.string(),
  fingerprint: z.string(),
  capturedAt: z.string().datetime(),
  tools: z.array(
    z.custom<McpTool>((value) => !specTypeSchemas.Tool['~standard'].validate(value).issues),
  ),
});
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
};

export const supportsCapabilitySnapshot = (config?: ServerConfig): boolean =>
  config?.startOnDemand === true && (config.type === 'stdio' || (!config.type && !!config.command));

/** Attach a config-bound writer and return only a matching, validated raw snapshot. */
export const prepareCapabilitySnapshot = async (
  info: ServerInfo,
  config: ServerConfig,
  scope?: CapabilityScope,
): Promise<McpTool[] | undefined> => {
  if (!supportsCapabilitySnapshot(config)) return undefined;
  try {
    await contexts.get(info)?.pending;
    const principal = scope?.username ?? '';
    const parsed = snapshotSchema.safeParse(
      await getCapabilitySnapshotDao().get(info.name, principal),
    );
    const previous = parsed.success ? parsed.data : undefined;
    const env = await getServerEnvironment(config);
    delete env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
    // Projection and scheduling fields cannot affect upstream discovery.
    const {
      tools,
      prompts,
      resources,
      description,
      enabled,
      visibility,
      sharedWithUsers,
      startOnDemand,
      idleTimeoutMs,
      ...launch
    } = config;
    void [
      tools,
      prompts,
      resources,
      description,
      enabled,
      visibility,
      sharedWithUsers,
      startOnDemand,
      idleTimeoutMs,
    ];
    const declaration = JSON.stringify(stable([1, launch, env, scope?.revision]));
    const parts = previous?.fingerprint.split(':');
    const salt =
      parts?.length === 3 && parts[0] === 'v1' && /^[a-f0-9]{32}$/.test(parts[1])
        ? parts[1]
        : randomBytes(16).toString('hex');
    // Salt and stretch launch configuration because it may contain low-entropy secrets.
    const hash = (await derive(declaration, salt, 32)) as Buffer;
    const fingerprint = `v1:${salt}:${hash.toString('hex')}`;
    const matches =
      previous?.serverName === info.name &&
      previous.principal === principal &&
      parts?.[2]?.length === 64 &&
      /^[a-f0-9]+$/.test(parts[2]) &&
      timingSafeEqual(hash, Buffer.from(parts[2], 'hex'));
    info.capabilityCache = {
      state: matches ? 'fresh' : previous ? 'stale' : 'missing',
      ...(previous ? { capturedAt: previous.capturedAt } : {}),
    };
    if (contexts.get(info)?.snapshot.fingerprint !== fingerprint) {
      contexts.set(info, {
        snapshot: { serverName: info.name, principal, fingerprint, capturedAt: '', tools: [] },
        pending: Promise.resolve(),
      });
    }
    return matches ? (previous.tools as McpTool[]) : undefined;
  } catch {
    // Cache availability must never prevent a live connection or expose secrets in diagnostics.
    contexts.delete(info);
    info.capabilityCache = { state: 'missing' };
    logger.warn('Unable to restore capability snapshot');
    return undefined;
  }
};

export const recordCapabilitySnapshot = (info: ServerInfo, tools: McpTool[]): void => {
  const context = contexts.get(info);
  if (!context) return;
  const snapshot = {
    ...context.snapshot,
    capturedAt: new Date().toISOString(),
    tools: structuredClone(tools),
  };
  info.capabilityCache = { state: 'fresh', capturedAt: snapshot.capturedAt };
  context.pending = context.pending.then(async () => {
    try {
      await getCapabilitySnapshotDao().save(snapshot);
    } catch {
      logger.warn('Unable to persist capability snapshot');
    }
  });
};

export const flushCapabilitySnapshot = async (info: ServerInfo): Promise<void> => {
  await contexts.get(info)?.pending;
};
