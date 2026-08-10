import { Request, Response } from 'express';
import config from '../config/index.js';
import { getDataService } from '../services/services.js';
import { DataService } from '../services/dataService.js';
import { BetterAuthConfig, IUser, SystemConfig } from '../types/index.js';
import {
  getGroupDao,
  getOAuthClientDao,
  getOAuthTokenDao,
  getServerDao,
  getSystemConfigDao,
  getUserConfigDao,
  getUserDao,
  getBearerKeyDao,
} from '../dao/DaoFactory.js';
import {
  getAppliedBetterAuthRuntimeConfig,
  getBetterAuthRuntimeConfig,
  isBetterAuthRestartRequired,
  resolveBetterAuthRuntimeConfig,
  toBetterAuthPublicConfig,
} from '../services/betterAuthConfig.js';

const dataService: DataService = getDataService();

const requireAdmin = (req: Request, res: Response): boolean => {
  const user = (req as any).user;
  if (!user || !user.isAdmin) {
    res.status(403).json({
      success: false,
      message: 'Admin privileges required',
    });
    return false;
  }
  return true;
};

/**
 * Get runtime configuration for frontend
 */
export const getRuntimeConfig = (req: Request, res: Response): void => {
  try {
    const runtimeConfig = {
      basePath: config.basePath,
      version: config.mcpHubVersion,
      name: config.mcpHubName,
    };

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json({
      success: true,
      data: runtimeConfig,
    });
  } catch (error) {
    console.error('Error getting runtime config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get runtime configuration',
    });
  }
};

/**
 * Get public system configuration (only skipAuth setting)
 * This endpoint doesn't require authentication to allow checking if dashboard login should be skipped
 */
export const getPublicConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const systemConfig = await getSystemConfigDao().get();
    const skipAuth = systemConfig?.routing?.skipAuth || false;
    const appliedBetterAuthConfig =
      getAppliedBetterAuthRuntimeConfig() || resolveBetterAuthRuntimeConfig(null);
    let permissions = {};
    if (skipAuth) {
      const user: IUser = {
        username: 'guest',
        password: '',
        isAdmin: true,
      };
      permissions = dataService.getPermissions(user);
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json({
      success: true,
      data: {
        skipAuth,
        permissions,
        betterAuth: toBetterAuthPublicConfig(appliedBetterAuthConfig),
      },
    });
  } catch (error) {
    console.error('Error getting public config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get public configuration',
    });
  }
};

type OidcTestStatus = 'success' | 'warning' | 'error';

const cloneSystemConfig = (systemConfig: SystemConfig | null): SystemConfig =>
  systemConfig ? (JSON.parse(JSON.stringify(systemConfig)) as SystemConfig) : {};

const applyOidcTestOverrides = (
  systemConfig: SystemConfig | null,
  betterAuthOverrides: Partial<BetterAuthConfig>,
): SystemConfig => {
  const clonedConfig = cloneSystemConfig(systemConfig);
  clonedConfig.auth = clonedConfig.auth || {};
  clonedConfig.auth.betterAuth = {
    ...(clonedConfig.auth.betterAuth || {}),
    ...betterAuthOverrides,
    providers: {
      ...(clonedConfig.auth.betterAuth?.providers || {}),
      ...(betterAuthOverrides.providers || {}),
      oidc: {
        ...(clonedConfig.auth.betterAuth?.providers?.oidc || {}),
        ...(betterAuthOverrides.providers?.oidc || {}),
      },
    },
  };
  return clonedConfig;
};

const normalizeOptional = (value?: string): string => (value || '').trim();

const compareOidcConfigValues = (
  desiredConfig: Awaited<ReturnType<typeof getBetterAuthRuntimeConfig>>,
  appliedConfig: Awaited<ReturnType<typeof getBetterAuthRuntimeConfig>>,
): string[] => {
  const mismatches: string[] = [];
  const desiredOidc = desiredConfig.providers.oidc;
  const appliedOidc = appliedConfig.providers.oidc;

  if (desiredOidc.enabled !== appliedOidc.enabled) mismatches.push('enabled');
  if (desiredOidc.configViaUi !== appliedOidc.configViaUi) mismatches.push('config mode');
  if (normalizeOptional(desiredOidc.providerId) !== normalizeOptional(appliedOidc.providerId))
    mismatches.push('provider ID');
  if (normalizeOptional(desiredOidc.discoveryUrl) !== normalizeOptional(appliedOidc.discoveryUrl))
    mismatches.push('discovery URL');
  if (normalizeOptional(desiredOidc.clientId) !== normalizeOptional(appliedOidc.clientId))
    mismatches.push('client ID');
  if (normalizeOptional(desiredOidc.clientSecret) !== normalizeOptional(appliedOidc.clientSecret))
    mismatches.push('client secret');
  if (desiredOidc.pkce !== appliedOidc.pkce) mismatches.push('PKCE');
  if (normalizeOptional(desiredOidc.prompt) !== normalizeOptional(appliedOidc.prompt))
    mismatches.push('prompt');
  if ((desiredOidc.scopes || []).join('|') !== (appliedOidc.scopes || []).join('|'))
    mismatches.push('scopes');

  return mismatches;
};

export const testBetterAuthOidcConnection = async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  try {
    const systemConfig = await getSystemConfigDao().get();
    const betterAuthOverrides = (req.body?.auth?.betterAuth || {}) as Partial<BetterAuthConfig>;
    const desiredConfig = await getBetterAuthRuntimeConfig(
      applyOidcTestOverrides(systemConfig, betterAuthOverrides),
    );
    const appliedConfig =
      getAppliedBetterAuthRuntimeConfig() || resolveBetterAuthRuntimeConfig(systemConfig);
    const messages: string[] = [];
    let status: OidcTestStatus = 'success';

    const desiredOidc = desiredConfig.providers.oidc;
    if (!desiredOidc.enabled) {
      res.json({
        success: true,
        data: {
          status: 'error',
          messages: [
            'OIDC is not active with the current settings. Check the enabled toggle, discovery URL, client ID, and client secret.',
          ],
        },
      });
      return;
    }

    if (!process.env.BETTER_AUTH_SECRET && !process.env.JWT_SECRET) {
      status = 'error';
      messages.push(
        'BETTER_AUTH_SECRET is missing on the server. Social and OIDC sign-in requests will fail until a persistent secret is configured.',
      );
    }

    const restartRequired = isBetterAuthRestartRequired(desiredConfig, appliedConfig);
    const mismatchFields = compareOidcConfigValues(desiredConfig, appliedConfig);
    if (restartRequired) {
      if (status !== 'error') status = 'warning';
      messages.push(
        `Saved OIDC settings differ from the active runtime (${mismatchFields.join(', ') || 'configuration mismatch'}). Use Restart System before testing the login page.`,
      );
    } else {
      messages.push('Saved OIDC settings match the active runtime configuration.');
    }

    const discoveryUrl = desiredOidc.discoveryUrl;
    if (!discoveryUrl) {
      status = 'error';
      messages.push('OIDC discovery URL is missing.');
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const discoveryResponse = await fetch(discoveryUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!discoveryResponse.ok) {
          status = 'error';
          messages.push(
            `Discovery request failed with HTTP ${discoveryResponse.status} ${discoveryResponse.statusText}.`,
          );
        } else {
          const discoveryDocument = (await discoveryResponse.json()) as Record<string, unknown>;
          const requiredFields = [
            'issuer',
            'authorization_endpoint',
            'token_endpoint',
            'jwks_uri',
          ].filter((field) => typeof discoveryDocument[field] !== 'string');

          if (requiredFields.length > 0) {
            status = 'error';
            messages.push(
              `Discovery document is missing required fields: ${requiredFields.join(', ')}.`,
            );
          } else {
            messages.push(
              `Discovery document loaded successfully for issuer ${String(discoveryDocument.issuer)}.`,
            );
          }
        }
      } catch (error) {
        clearTimeout(timeout);
        status = 'error';
        const message = error instanceof Error ? error.message : 'Unknown network error';
        messages.push(`Discovery request failed: ${message}.`);
      }
    }

    if (!desiredOidc.clientId || !desiredOidc.clientSecret) {
      status = 'error';
      messages.push('Client ID and client secret must both be configured.');
    } else {
      messages.push('Client credentials are present.');
    }

    res.json({
      success: true,
      data: {
        status,
        restartRequired,
        messages,
      },
    });
  } catch (error) {
    console.error('Error testing OIDC connection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test OIDC connection',
    });
  }
};

export const restartApplication = async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  res.status(202).json({
    success: true,
    message: 'Application restart requested',
  });

  setTimeout(() => {
    process.kill(process.pid, 'SIGTERM');
  }, 250);
};

/**
 * Recursively remove null values from an object
 */
const omitSensitiveFields = <T extends Record<string, any>, K extends keyof T & string>(
  items: T[],
  fields: readonly K[],
): Omit<T, K>[] =>
  items.map((item) => {
    const sanitized = { ...item };
    for (const field of fields) {
      delete sanitized[field];
    }
    return sanitized;
  });

const removeNullValues = <T>(obj: T): T => {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => removeNullValues(item)) as T;
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null) {
        result[key] = removeNullValues(value);
      }
    }
    return result as T;
  }
  return obj;
};

/**
 * Get MCP settings in JSON format for export/copy
 * Supports both full settings and individual server configuration
 */
export const getMcpSettingsJson = async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  try {
    const { serverName } = req.query;
    if (serverName && typeof serverName === 'string') {
      // Return individual server configuration using DAO
      const serverDao = getServerDao();
      const serverConfig = await serverDao.findById(serverName);
      if (!serverConfig) {
        res.status(404).json({
          success: false,
          message: `Server '${serverName}' not found`,
        });
        return;
      }

      // Remove the 'name' field from config as it's used as the key
      const { name, ...configWithoutName } = serverConfig;
      // Remove null values from the config
      const cleanedConfig = removeNullValues(configWithoutName);
      res.json({
        success: true,
        data: {
          mcpServers: {
            [name]: cleanedConfig,
          },
        },
      });
    } else {
      // Return full settings via DAO layer (supports both file and database modes)
      const [
        servers,
        users,
        groups,
        systemConfig,
        userConfigs,
        oauthClients,
        oauthTokens,
        bearerKeys,
      ] = await Promise.all([
        getServerDao().findAll(),
        getUserDao().findAll(),
        getGroupDao().findAll(),
        getSystemConfigDao().get(),
        getUserConfigDao().getAll(),
        getOAuthClientDao().findAll(),
        getOAuthTokenDao().findAll(),
        getBearerKeyDao().findAll(),
      ]);

      const mcpServers: Record<string, any> = {};
      for (const { name: serverConfigName, ...config } of servers) {
        mcpServers[serverConfigName] = removeNullValues(config);
      }

      const settings = {
        mcpServers,
        users: omitSensitiveFields(users, ['password']),
        groups,
        systemConfig,
        userConfigs,
        oauthClients: omitSensitiveFields(oauthClients, ['clientSecret']),
        oauthTokens: omitSensitiveFields(oauthTokens, ['accessToken', 'refreshToken']),
        bearerKeys: omitSensitiveFields(bearerKeys, ['token']),
      };

      res.json({
        success: true,
        data: settings,
      });
    }
  } catch (error) {
    console.error('Error getting MCP settings JSON:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get MCP settings',
    });
  }
};
