import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { getSettingsPath } from '../config/index.js';
import { getAppDataSource } from '../db/connection.js';
import { Server } from '../db/entities/Server.js';
import { Group } from '../db/entities/Group.js';
import { expandServerConfig } from '../services/serverConfigEnvironment.js';
import { ServerConfig } from '../types/index.js';
import { normalizeServerConfigForPersistence } from './serverConfigPersistence.js';
import { logger } from './logger.js';

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
      const hash = createHash('sha256')
        .update(
          JSON.stringify(
            canonical({
              type: expanded.type,
              url: expanded.url,
              owner: config.owner ?? null,
              oauth: expanded.oauth ?? null,
            }),
          ),
        )
        .digest('hex');
      return { serverName, config, hash };
    }),
  );

  await getAppDataSource().transaction(async (manager) => {
    const serverRepo = manager.getRepository(Server);
    for (const { serverName, config, hash } of servers) {
      const existing = await serverRepo.findOneBy({ name: serverName });
      const sameTarget =
        existing &&
        normalizeServerConfigForPersistence(existing as ServerConfig).type === config.type &&
        existing.url === config.url &&
        (existing.owner ?? null) === (config.owner ?? null);
      const declaredOAuthMatches = Object.entries(config.oauth ?? {}).every(([key, value]) =>
        isDeepStrictEqual(value, existing?.oauth?.[key]),
      );
      const sameOAuth =
        declaredOAuthMatches && (!existing?.settingsSyncHash || existing.settingsSyncHash === hash);
      const oauth =
        sameTarget && sameOAuth ? { ...existing?.oauth, ...config.oauth } : config.oauth;
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
      await serverRepo.save(serverRepo.create({ ...existing, ...data }));
    }
    const groupRepo = manager.getRepository(Group);
    for (const group of declaration.groups ?? []) {
      const existing = await groupRepo.findOneBy({ name: group.name });
      await groupRepo.save(
        groupRepo.create({
          ...existing,
          name: group.name,
          servers: group.servers,
          description: group.description ?? null,
          owner: group.owner ?? null,
          visibility: group.visibility ?? null,
          sharedWithUsers: group.sharedWithUsers ?? null,
        } as unknown as Group),
      );
    }
  });
  logger.log(`Settings sync completed: ${servers.length} servers, ${names.length} groups`);
}
