import fs from 'node:fs';
import { pbkdf2, randomBytes } from 'node:crypto';
import { promisify, isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { getSettingsPath } from '../config/index.js';
import { getAppDataSource } from '../db/connection.js';
import { Server } from '../db/entities/Server.js';
import { Group } from '../db/entities/Group.js';
import { expandServerConfig } from '../services/serverConfigEnvironment.js';
import { ServerConfig } from '../types/index.js';
import { normalizeServerConfigForPersistence } from './serverConfigPersistence.js';
import { logger } from './logger.js';

const deriveFingerprint = promisify(pbkdf2);

// The declaration may contain client secrets. Salt and stretch it before persistence.
const fingerprintDeclaration = async (declaration: string, previous?: string): Promise<string> => {
  const [previousSalt, previousHash] = previous?.split(':') ?? [];
  const salt =
    /^[a-f0-9]{32}$/.test(previousSalt ?? '') && /^[a-f0-9]{64}$/.test(previousHash ?? '')
      ? previousSalt
      : randomBytes(16).toString('hex');
  const hash = (await deriveFingerprint(declaration, salt, 600_000, 32, 'sha256')).toString('hex');
  return `${salt}:${hash}`;
};

const name = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim());
const selection = z.union([z.literal('all'), z.array(z.string())]);
const declarationSchema = z.object({
  mcpServers: z
    .record(
      name,
      z
        .object({
          type: z.enum(['stdio', 'sse', 'streamable-http', 'openapi']).optional(),
          url: z.string().optional(),
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
          headers: z.record(z.string(), z.string()).optional(),
          description: z.string().optional(),
          owner: z.string().optional(),
          sharedWithUsers: z.array(z.string()).optional(),
          enableKeepAlive: z.boolean().optional(),
          keepAliveInterval: z.number().int().positive().optional(),
          startOnDemand: z.boolean().optional(),
          idleTimeoutMs: z.number().positive().optional(),
          perSessionClient: z.boolean().optional(),
          passthroughHeaders: z.array(z.string()).optional(),
          options: z.record(z.string(), z.unknown()).optional(),
          tools: z
            .record(
              z.string(),
              z.object({ enabled: z.boolean(), description: z.string().optional() }),
            )
            .optional(),
          prompts: z
            .record(
              z.string(),
              z.object({ enabled: z.boolean(), description: z.string().optional() }),
            )
            .optional(),
          resources: z
            .record(
              z.string(),
              z.object({ enabled: z.boolean(), description: z.string().optional() }),
            )
            .optional(),
          enabled: z.boolean().optional(),
          visibility: z.enum(['private', 'group', 'public']).optional(),
          oauth: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    )
    .optional(),
  groups: z
    .array(
      z.object({
        name,
        description: z.string().optional(),
        owner: z.string().optional(),
        visibility: z.enum(['private', 'group', 'public']).optional(),
        sharedWithUsers: z.array(z.string()).optional(),
        servers: z
          .array(
            z.union([
              z.string(),
              z.object({
                name,
                alias: z.string().optional(),
                tools: selection.optional(),
                prompts: selection.optional(),
                resources: selection.optional(),
                pinnedTools: z.array(z.string()).optional(),
              }),
            ]),
          )
          .default([]),
      }),
    )
    .optional(),
});

// Stable object ordering makes a formatting-only Git change harmless to authorization.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

/** Startup-only reconciliation. Never use loadOriginalSettings: it can write defaults. */
export async function syncSettingsToDatabase(): Promise<void> {
  const mode = process.env.MCPHUB_SETTINGS_SYNC;
  if (!mode) return;
  if (mode !== 'upsert') throw new Error(`Unsupported MCPHUB_SETTINGS_SYNC: ${mode}`);

  const declaration = declarationSchema.parse(
    JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')),
  );
  const names = declaration.groups?.map((group) => group.name) ?? [];
  if (new Set(names).size !== names.length) throw new Error('Duplicate group names in settings');

  // Normalize before opening a transaction so invalid declarations cannot partially apply.
  const servers = await Promise.all(
    Object.entries(declaration.mcpServers ?? {}).map(async ([serverName, input]) => {
      const config = normalizeServerConfigForPersistence(input as ServerConfig);
      if (
        !config.type ||
        (config.type === 'stdio' && !config.command) ||
        ((config.type === 'sse' || config.type === 'streamable-http') && !config.url) ||
        (config.type === 'openapi' && !config.openapi?.url && !config.openapi?.schema)
      ) {
        throw new Error(`Server ${serverName} has no connection configuration`);
      }
      const oauth = config.oauth ? { ...config.oauth } : undefined;
      // Tokens and pending authorization are runtime state, never declarations.
      if (oauth) {
        delete oauth.accessToken;
        delete oauth.refreshToken;
        delete oauth.pendingAuthorization;
      }
      config.oauth = oauth;
      const expanded = await expandServerConfig(config);
      const signature = JSON.stringify(
        canonical({
          type: expanded.type,
          url: expanded.url,
          owner: config.owner ?? null,
          oauth: expanded.oauth ?? null,
        }),
      );
      return { serverName, config, signature };
    }),
  );

  const counts = {
    servers: { created: 0, updated: 0, unchanged: 0 },
    groups: { created: 0, updated: 0, unchanged: 0 },
  };

  await getAppDataSource().transaction(async (manager) => {
    const serverRepo = manager.getRepository(Server);
    for (const { serverName, config, signature } of servers) {
      const existing = await serverRepo.findOneBy({ name: serverName });
      const hash = await fingerprintDeclaration(signature, existing?.settingsSyncHash);
      const sameTarget =
        existing &&
        normalizeServerConfigForPersistence(existing as ServerConfig).type === config.type &&
        existing.url === config.url &&
        (existing.owner ?? null) === (config.owner ?? null);
      const declaredOAuthMatches = Object.entries(config.oauth ?? {}).every(([key, value]) =>
        isDeepStrictEqual(value, existing?.oauth?.[key]),
      );
      const sameOAuth = existing?.settingsSyncHash
        ? existing.settingsSyncHash === hash
        : declaredOAuthMatches;
      // Runtime registration may refine scopes/endpoints. Restore declared fields
      // missing after a disconnect, but retain the upstream's existing values.
      const oauth =
        sameTarget && sameOAuth ? { ...config.oauth, ...existing?.oauth } : config.oauth;
      const data: Record<string, unknown> = {
        name: serverName,
        enabled: config.enabled ?? true,
        visibility: config.visibility ?? 'private',
        enableKeepAlive: config.enableKeepAlive ?? false,
        settingsSyncHash: hash,
      };
      // Emit null for every omitted nullable configuration column. TypeORM skips undefined.
      for (const column of serverRepo.metadata.columns) {
        if (column.isNullable && column.propertyName !== 'settingsSyncHash') {
          data[column.propertyName] =
            column.propertyName === 'oauth'
              ? oauth && Object.keys(oauth).length
                ? oauth
                : null
              : (config[column.propertyName as keyof ServerConfig] ?? null);
        }
      }
      const unchanged =
        existing &&
        Object.entries(data).every(([key, value]) =>
          isDeepStrictEqual(existing[key as keyof Server] ?? null, value ?? null),
        );
      counts.servers[!existing ? 'created' : unchanged ? 'unchanged' : 'updated']++;
      if (!unchanged) await serverRepo.save(serverRepo.create({ ...existing, ...data }));
    }
    const groupRepo = manager.getRepository(Group);
    for (const group of declaration.groups ?? []) {
      const existing = await groupRepo.findOneBy({ name: group.name });
      const data = {
        name: group.name,
        servers: group.servers,
        description: group.description ?? null,
        owner: group.owner ?? null,
        visibility: group.visibility ?? null,
        sharedWithUsers: group.sharedWithUsers ?? null,
      };
      const unchanged =
        existing &&
        Object.entries(data).every(([key, value]) =>
          isDeepStrictEqual(existing[key as keyof Group] ?? null, value ?? null),
        );
      counts.groups[!existing ? 'created' : unchanged ? 'unchanged' : 'updated']++;
      if (!unchanged)
        await groupRepo.save(groupRepo.create({ ...existing, ...data } as unknown as Group));
    }
  });
  logger.log(
    `Settings sync completed: servers (${counts.servers.created} created, ${counts.servers.updated} updated, ${counts.servers.unchanged} unchanged); groups (${counts.groups.created} created, ${counts.groups.updated} updated, ${counts.groups.unchanged} unchanged)`,
  );
}
