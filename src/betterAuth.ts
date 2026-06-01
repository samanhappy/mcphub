import { betterAuth, BetterAuthOptions } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import { PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import defaultConfig, { loadSettings } from './config/index.js';
import {
  resolveBetterAuthRuntimeConfig,
} from './services/betterAuthConfig.js';
import { getCachedSystemConfig, isDatabaseModeEnabled } from './utils/systemConfigCache.js';

const resolveSystemConfig = () => {
  const cachedSystemConfig = getCachedSystemConfig();
  if (cachedSystemConfig) {
    return cachedSystemConfig;
  }

  if (!isDatabaseModeEnabled()) {
    return loadSettings().systemConfig ?? null;
  }

  return null;
};

const systemConfig = resolveSystemConfig();
const runtimeConfig = resolveBetterAuthRuntimeConfig(systemConfig);
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
const plugins: any[] = [];
if (
  runtimeConfig.providers.google.enabled &&
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET
) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}
if (
  runtimeConfig.providers.github.enabled &&
  process.env.GITHUB_CLIENT_ID &&
  process.env.GITHUB_CLIENT_SECRET
) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}
if (
  runtimeConfig.providers.oidc.enabled &&
  runtimeConfig.providers.oidc.discoveryUrl &&
  process.env.OIDC_CLIENT_ID &&
  process.env.OIDC_CLIENT_SECRET
) {
  plugins.push(
    genericOAuth({
      config: [
        {
          providerId: runtimeConfig.providers.oidc.providerId,
          discoveryUrl: runtimeConfig.providers.oidc.discoveryUrl,
          clientId: process.env.OIDC_CLIENT_ID,
          clientSecret: process.env.OIDC_CLIENT_SECRET,
          scopes: runtimeConfig.providers.oidc.scopes,
          pkce: runtimeConfig.providers.oidc.pkce,
          prompt: runtimeConfig.providers.oidc.prompt,
        },
      ],
    }),
  );
}

const resolveBaseURL = (baseUrl: string, basePath: string): string => {
  const normalizedPath = basePath.startsWith('/') ? basePath : `/${basePath}`;
  try {
    const url = new URL(baseUrl);
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = normalizedPath;
      return url.toString();
    }
    if (url.pathname.endsWith(normalizedPath)) {
      return url.toString();
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${normalizedPath}`;
    return url.toString();
  } catch {
    const trimmedBase = baseUrl.replace(/\/+$/, '');
    return `${trimmedBase}${normalizedPath}`;
  }
};

const systemInstallBaseUrl = systemConfig?.install?.baseUrl;
const baseURL = resolveBaseURL(
  process.env.BETTER_AUTH_URL ||
    systemInstallBaseUrl ||
    `http://localhost:${defaultConfig.port}${defaultConfig.basePath}`,
  runtimeConfig.basePath,
);

const databaseUrl = process.env.DB_URL;
if (!databaseUrl) {
  throw new Error('DB_URL is required for Better Auth PostgreSQL storage.');
}

const pool = new Pool({
  connectionString: databaseUrl,
});

const database = new PostgresDialect({
  pool,
});

const authOptions: BetterAuthOptions = {
  baseURL,
  database,
  emailAndPassword: {
    enabled: false,
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [
        ...(runtimeConfig.providers.oidc.enabled && runtimeConfig.providers.oidc.trustEmail
          ? [runtimeConfig.providers.oidc.providerId]
          : []),
      ],
    },
  },
  plugins,
  socialProviders,
  trustedOrigins: runtimeConfig.trustedOrigins,
  logger: {
    disabled: false,
    disableColors: false,
    level: 'info',
    log: (level, message, ...args) => {
      console.log('[better-auth]', { level, message }, ...args);
    },
  },
};

export const auth = betterAuth(authOptions);

const extractMigrationTableName = (entry: unknown): string | null => {
  if (typeof entry === 'string') {
    return entry;
  }
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const candidate = record.tableName ?? record.table ?? record.name;
  return typeof candidate === 'string' ? candidate : null;
};

const resolveCurrentSchema = async (): Promise<string> => {
  try {
    const result = await pool.query<{ schema: string }>('select current_schema() as schema');
    return result.rows[0]?.schema || 'public';
  } catch {
    return 'public';
  }
};

const listExistingTables = async (schema: string, tableNames: string[]): Promise<Set<string>> => {
  if (!tableNames.length) {
    return new Set();
  }
  const result = await pool.query<{ table_name: string }>(
    'select table_name from information_schema.tables where table_schema = $1 and table_name = any($2)',
    [schema, tableNames],
  );
  return new Set(result.rows.map((row) => row.table_name));
};

const isRelationAlreadyExistsError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const message = String((error as { message?: string }).message ?? '');
  return /relation\s+".*"\s+already\s+exists/i.test(message);
};

export const ensureBetterAuthSchema = async (): Promise<void> => {
  if (!runtimeConfig.enabled) {
    return;
  }

  const { getMigrations } = await import('better-auth/db');
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions);

  if (!toBeCreated.length && !toBeAdded.length) {
    return;
  }

  if (toBeCreated.length) {
    const tableNames = toBeCreated
      .map((entry) => extractMigrationTableName(entry))
      .filter((tableName): tableName is string => Boolean(tableName));
    if (tableNames.length === toBeCreated.length) {
      const schema = await resolveCurrentSchema();
      const existingTables = await listExistingTables(schema, tableNames);
      const allTablesExist = tableNames.every((tableName) => existingTables.has(tableName));
      if (allTablesExist && !toBeAdded.length) {
        console.warn(
          `[better-auth] Detected existing tables in schema "${schema}"; skipping migrations.`,
        );
        return;
      }
    }
  }

  try {
    await runMigrations();
  } catch (error) {
    if (isRelationAlreadyExistsError(error)) {
      console.warn('[better-auth] Migration skipped due to existing relations.', error);
      return;
    }
    throw error;
  }
};
export { runtimeConfig as betterAuthRuntimeConfig };
