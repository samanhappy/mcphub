import { betterAuth, BetterAuthOptions } from 'better-auth';
import { PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import defaultConfig from './config/index.js';
import {
  betterAuthRuntimeConfig,
  getBetterAuthRuntimeConfig,
} from './services/betterAuthConfig.js';

const runtimeConfig = getBetterAuthRuntimeConfig();
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
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

const baseURL = resolveBaseURL(
  process.env.BETTER_AUTH_URL || `http://localhost:${defaultConfig.port}${defaultConfig.basePath}`,
  runtimeConfig.basePath,
);

const databaseUrl = process.env.DB_URL;
if (!databaseUrl) {
  throw new Error('DB_URL is required for Better Auth PostgreSQL storage.');
}

const database = new PostgresDialect({
  pool: new Pool({
    connectionString: databaseUrl,
  }),
});

const authOptions: BetterAuthOptions = {
  baseURL,
  database,
  emailAndPassword: {
    enabled: false,
  },
  socialProviders,
  logger: {
    disabled: false,
    disableColors: false,
    level: 'info',
    log: (level, message, ...args) => {
      console.log(`[better-auth] [${level}] ${message}`, ...args);
    },
  },
};

export const auth = betterAuth(authOptions);

export const ensureBetterAuthSchema = async (): Promise<void> => {
  if (!getBetterAuthRuntimeConfig().enabled) {
    return;
  }

  const { getMigrations } = await import('better-auth/db');
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions);

  if (toBeCreated.length || toBeAdded.length) {
    await runMigrations();
  }
};
export { betterAuthRuntimeConfig };
