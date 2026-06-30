import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { deleteMcpServer, getMcpServer } from './mcpService.js';
import config from '../config/index.js';
import {
  getBearerKeyDao,
  getGroupDao,
  getServerDao,
  getSystemConfigDao,
  getUserDao,
} from '../dao/index.js';
import { UserContextService } from './userContextService.js';
import { RequestContextService } from './requestContextService.js';
import { IUser, BearerKey, BearerKeyKind } from '../types/index.js';
import { resolveOAuthUserFromToken } from '../utils/oauthBearer.js';
import { safeCompare } from '../utils/safeCompare.js';
import { getBearerAuthHeaderValue, getBearerTokenFromHeaders } from '../utils/bearerAuth.js';
import {
  HostedAuthUnavailableError,
  isHostedApiKey,
  validateHostedBearer,
} from './hostedAuthService.js';
import type { HostedAuthContext } from './hostedAuthService.js';
import { isHostedModeEnabled } from './hostedMode.js';

export interface SessionContext {
  transport: Transport;
  group: string;
  needsInitialization?: boolean;
  keyId?: string;
  keyName?: string;
  hostedAuth?: HostedAuthContext;
}

export const transports: {
  [sessionId: string]: SessionContext;
} = {};

const SESSION_NOT_FOUND_CODE = -32001;
const SESSION_NOT_FOUND_MESSAGE = 'Session not found. Please reinitialize the session.';

/**
 * Label recorded in the activity log's API key field when a request was
 * authenticated via an OAuth bearer token (no static API key was presented).
 * OAuth requests have no keyId/keyName of their own, so this surfaces the
 * authentication method instead of leaving the field blank.
 */
const OAUTH_AUTH_METHOD_LABEL = 'OAuth';

type RehydratableWebStandardTransport = {
  sessionId?: string;
  _initialized?: boolean;
};

// Session creation locks to prevent concurrent session creation conflicts
const sessionCreationLocks: { [sessionId: string]: Promise<StreamableHTTPServerTransport> } = {};

export const getGroup = (sessionId: string): string => {
  return transports[sessionId]?.group || '';
};

export const getSessionContext = (
  sessionId: string,
): { group: string; keyId?: string; keyName?: string } => {
  const session = transports[sessionId];
  return {
    group: session?.group || '',
    keyId: session?.keyId,
    keyName: session?.keyName,
  };
};

const cleanupSessionState = (sessionId: string): void => {
  const session = transports[sessionId];
  if (session?.transport && typeof session.transport.close === 'function') {
    session.transport.close().catch((err) => {
      console.error('[SESSION] Error closing transport during cleanup for %s:', sessionId, err);
    });
  }
  delete transports[sessionId];
  deleteMcpServer(sessionId);
};

const sendSessionNotFoundJsonRpc = (res: Response): void => {
  res.status(404).json({
    jsonrpc: '2.0',
    error: {
      code: SESSION_NOT_FOUND_CODE,
      message: SESSION_NOT_FOUND_MESSAGE,
    },
    id: null,
  });
};

const sendSessionNotFoundText = (res: Response): void => {
  res.status(404).send(SESSION_NOT_FOUND_MESSAGE);
};

const rehydrateRebuiltTransport = (
  transport: StreamableHTTPServerTransport,
  sessionId: string,
): boolean => {
  const transportRecord = transport as unknown as Record<string, unknown>;
  const internalTransport = transportRecord._webStandardTransport as
    | RehydratableWebStandardTransport
    | undefined;

  if (!internalTransport) {
    return false;
  }

  internalTransport.sessionId = sessionId;
  internalTransport._initialized = true;

  return true;
};

type BearerAuthResult =
  | {
      valid: true;
      user?: IUser;
      keyId?: string;
      keyName?: string;
      kind?: BearerKeyKind;
      hostedAuth?: HostedAuthContext;
    }
  | {
      valid: false;
      reason: 'missing' | 'invalid' | 'forbidden' | 'unavailable';
    };

/**
 * Check if a string is a valid UUID v4 format
 */
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

const normalizeBearerScopeParam = (groupParam?: string): string | undefined => {
  if (!groupParam) {
    return undefined;
  }

  if (groupParam.startsWith('$smart/')) {
    const targetGroup = groupParam.substring(7).trim();
    return targetGroup || undefined;
  }

  if (groupParam === '$smart') {
    return undefined;
  }

  return groupParam;
};

const isBearerKeyAllowedForRequest = async (req: Request, key: BearerKey): Promise<boolean> => {
  if (key.kind === 'user') {
    return true;
  }

  const paramValue = normalizeBearerScopeParam((req.params as any)?.group as string | undefined);

  // accessType 'all' allows all requests
  if (key.accessType === 'all') {
    return true;
  }

  // No parameter value means global route
  if (!paramValue) {
    // Only accessType 'all' allows global routes
    return false;
  }

  try {
    const groupDao = getGroupDao();
    const serverDao = getServerDao();

    // Step 1: Try to match as a group (by name or id), since group has higher priority
    let matchedGroup = await groupDao.findByName(paramValue);
    if (!matchedGroup && isValidUUID(paramValue)) {
      // Only try findById if the parameter is a valid UUID
      matchedGroup = await groupDao.findById(paramValue);
    }

    if (matchedGroup) {
      // Matched as a group
      if (key.accessType === 'groups') {
        // For group-scoped keys, check if the matched group is in allowedGroups
        const allowedGroups = key.allowedGroups || [];
        return allowedGroups.includes(matchedGroup.name) || allowedGroups.includes(matchedGroup.id);
      }

      if (key.accessType === 'servers') {
        // For server-scoped keys, check if any server in the group is allowed
        const allowedServers = key.allowedServers || [];
        if (allowedServers.length === 0) {
          return false;
        }

        if (!Array.isArray(matchedGroup.servers)) {
          return false;
        }

        const groupServerNames = matchedGroup.servers.map((server) =>
          typeof server === 'string' ? server : server.name,
        );
        return groupServerNames.some((name) => allowedServers.includes(name));
      }

      if (key.accessType === 'custom') {
        // For custom-scoped keys, check if the group is allowed OR if any server in the group is allowed
        const allowedGroups = key.allowedGroups || [];
        const allowedServers = key.allowedServers || [];

        // Check if the group itself is allowed
        const groupAllowed =
          allowedGroups.includes(matchedGroup.name) || allowedGroups.includes(matchedGroup.id);
        if (groupAllowed) {
          return true;
        }

        // Check if any server in the group is allowed
        if (allowedServers.length > 0 && Array.isArray(matchedGroup.servers)) {
          const groupServerNames = matchedGroup.servers.map((server) =>
            typeof server === 'string' ? server : server.name,
          );
          return groupServerNames.some((name) => allowedServers.includes(name));
        }

        return false;
      }

      // Unknown accessType with matched group
      return false;
    }

    // Step 2: Not a group, try to match as a server name
    const matchedServer = await serverDao.findById(paramValue);

    if (matchedServer) {
      // Matched as a server
      if (key.accessType === 'groups') {
        // For group-scoped keys, server access is not allowed
        return false;
      }

      if (key.accessType === 'servers' || key.accessType === 'custom') {
        // For server-scoped or custom-scoped keys, check if the server is in allowedServers
        const allowedServers = key.allowedServers || [];
        return allowedServers.includes(matchedServer.name);
      }

      // Unknown accessType with matched server
      return false;
    }

    // Step 3: Not a valid group or server, deny access
    console.warn(
      `Bearer key access denied: parameter '${paramValue}' does not match any group or server`,
    );
    return false;
  } catch (error) {
    console.error('Error checking bearer key request access:', error);
    return false;
  }
};

const resolveUserLevelKeyUser = async (
  req: Request,
  key: BearerKey,
): Promise<BearerAuthResult> => {
  if (key.kind !== 'user') {
    return { valid: true, keyId: key.id, keyName: key.name, kind: key.kind || 'system' };
  }

  if (!key.owner) {
    return { valid: false, reason: 'invalid' };
  }

  const user = await getUserDao().findByUsername(key.owner);
  if (!user) {
    return { valid: false, reason: 'invalid' };
  }

  const requestedUsername = req.params.user;
  if (requestedUsername && requestedUsername !== user.username) {
    return { valid: false, reason: 'forbidden' };
  }

  return { valid: true, user, keyId: key.id, keyName: key.name, kind: 'user' };
};

const validateBearerAuth = async (req: Request): Promise<BearerAuthResult> => {
  const systemConfigDao = getSystemConfigDao();
  const systemConfig = await systemConfigDao.get();
  const enableBearerAuth = systemConfig?.routing?.enableBearerAuth ?? true;

  const bearerKeyDao = getBearerKeyDao();
  const enabledKeys = await bearerKeyDao.findEnabled();

  const authHeader = getBearerAuthHeaderValue(req.headers, systemConfig);
  const hasBearerHeader = !!authHeader && authHeader.startsWith('Bearer ');
  const standardAuthHeader = getBearerAuthHeaderValue(req.headers, null);
  const hostedAuthHeader =
    standardAuthHeader && standardAuthHeader.startsWith('Bearer ')
      ? standardAuthHeader
      : authHeader;
  const presentedToken = hasBearerHeader
    ? getBearerTokenFromHeaders(req.headers, systemConfig)
    : null;

  if (isHostedModeEnabled()) {
    const hostedToken =
      hostedAuthHeader && hostedAuthHeader.startsWith('Bearer ')
        ? hostedAuthHeader.substring(7).trim()
        : null;

    if (!hostedToken) {
      return { valid: false, reason: 'missing' };
    }
    if (!isHostedApiKey(hostedToken)) {
      return { valid: false, reason: 'invalid' };
    }

    try {
      const hostedAuth = await validateHostedBearer(hostedToken);
      if (!hostedAuth) {
        return { valid: false, reason: 'invalid' };
      }

      return {
        valid: true,
        user: { username: hostedAuth.userId, password: '', isAdmin: true },
        keyId: hostedAuth.apiKeyId,
        keyName: hostedAuth.apiKeyPrefix,
        kind: 'system',
        hostedAuth,
      };
    } catch (error) {
      if (error instanceof HostedAuthUnavailableError) {
        return { valid: false, reason: 'unavailable' };
      }
      throw error;
    }
  }

  if (!enableBearerAuth) {
    if (!hasBearerHeader) {
      return { valid: true };
    }

    const token = presentedToken;
    if (!token) {
      return { valid: true };
    }

    const matchingKey = enabledKeys.find((key) => safeCompare(key.token, token));
    if (matchingKey) {
      const userKeyResult = await resolveUserLevelKeyUser(req, matchingKey);
      if (!userKeyResult.valid) {
        return { valid: true };
      }
      const allowed = await isBearerKeyAllowedForRequest(req, matchingKey);
      if (allowed) {
        console.log(
          `Bearer key recognized (auth disabled): id=${matchingKey.id}, name=${matchingKey.name}, accessType=${matchingKey.accessType}`,
        );
        return userKeyResult;
      }

      console.warn(
        `Bearer key matched but rejected due to scope restrictions (auth disabled): id=${matchingKey.id}, name=${matchingKey.name}, accessType=${matchingKey.accessType}`,
      );
      return { valid: true };
    }

    const oauthUser = await resolveOAuthUserFromToken(token);
    if (oauthUser) {
      console.log('Recognized OAuth bearer token (auth disabled)');
      return { valid: true, user: oauthUser, keyName: OAUTH_AUTH_METHOD_LABEL };
    }

    return { valid: true };
  }

  if (!hasBearerHeader) {
    return { valid: false, reason: 'missing' };
  }

  const token = presentedToken;
  if (!token) {
    return { valid: false, reason: 'missing' };
  }

  if (enabledKeys.length === 0) {
    const oauthUser = await resolveOAuthUserFromToken(token);
    if (oauthUser) {
      console.log('Authenticated request using OAuth bearer token without configured keys');
      return { valid: true, user: oauthUser, keyName: OAUTH_AUTH_METHOD_LABEL };
    }

    console.warn(
      'Bearer authentication failed: no configured keys and token is not a valid OAuth token',
    );
    return { valid: false, reason: 'invalid' };
  }

  const matchingKey = enabledKeys.find((key) => safeCompare(key.token, token));
  if (matchingKey) {
    const userKeyResult = await resolveUserLevelKeyUser(req, matchingKey);
    if (!userKeyResult.valid) {
      return userKeyResult;
    }
    const allowed = await isBearerKeyAllowedForRequest(req, matchingKey);
    if (!allowed) {
      console.warn(
        `Bearer key rejected due to scope restrictions: id=${matchingKey.id}, name=${matchingKey.name}, accessType=${matchingKey.accessType}`,
      );
      return { valid: false, reason: 'invalid' };
    }

    console.log(
      `Bearer key authenticated: id=${matchingKey.id}, name=${matchingKey.name}, accessType=${matchingKey.accessType}`,
    );
    return userKeyResult;
  }

  const oauthUser = await resolveOAuthUserFromToken(token);
  if (oauthUser) {
    console.log('Authenticated request using OAuth bearer token (no matching static key)');
    return { valid: true, user: oauthUser, keyName: OAUTH_AUTH_METHOD_LABEL };
  }

  console.warn('Bearer authentication failed: token did not match any key or OAuth user');
  return { valid: false, reason: 'invalid' };
};

const attachUserContextFromBearer = (result: BearerAuthResult, res: Response): void => {
  if (!result.valid || !result.user) {
    return;
  }

  const userContextService = UserContextService.getInstance();
  if (userContextService.hasUser()) {
    return;
  }

  userContextService.setCurrentUser(result.user);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    userContextService.clearCurrentUser();
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);
};

const escapeHeaderValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

const buildResourceMetadataUrl = (req: Request): string | undefined => {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const protocol = forwardedProto || req.protocol || 'http';

  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const host =
    forwardedHost ||
    (req.headers.host as string | undefined) ||
    (req.headers[':authority'] as string | undefined);

  if (!host) {
    return undefined;
  }

  const origin = `${protocol}://${host}`;
  const basePath = config.basePath || '';

  if (!basePath || basePath === '/') {
    return `${origin}/.well-known/oauth-protected-resource`;
  }

  const normalizedBasePath = `${basePath.startsWith('/') ? '' : '/'}${basePath}`.replace(
    /\/+$/,
    '',
  );

  return `${origin}/.well-known/oauth-protected-resource${normalizedBasePath}`;
};

const sendBearerAuthError = (
  req: Request,
  res: Response,
  reason: 'missing' | 'invalid' | 'forbidden' | 'unavailable',
): void => {
  if (reason === 'forbidden') {
    res.status(403).json({
      error: 'forbidden',
      error_description: 'Bearer key owner does not match the requested user',
    });
    return;
  }

  if (reason === 'unavailable') {
    res.setHeader('Retry-After', '30');
    res.status(503).json({
      error: 'temporarily_unavailable',
      error_description: 'Hosted control plane is unavailable',
    });
    return;
  }

  const errorDescription =
    reason === 'missing' ? 'No authorization provided' : 'Invalid bearer token';

  const resourceMetadataUrl = buildResourceMetadataUrl(req);
  const headerParts = [
    'error="invalid_token"',
    `error_description="${escapeHeaderValue(errorDescription)}"`,
  ];

  if (resourceMetadataUrl) {
    headerParts.push(`resource_metadata="${escapeHeaderValue(resourceMetadataUrl)}"`);
  }

  console.warn(
    reason === 'missing'
      ? 'Bearer authentication required but no authorization header was provided'
      : 'Bearer authentication failed due to invalid bearer token',
  );

  res.setHeader('WWW-Authenticate', `Bearer ${headerParts.join(', ')}`);

  const responseBody: {
    error: string;
    error_description: string;
    resource_metadata?: string;
  } = {
    error: 'invalid_token',
    error_description: errorDescription,
  };

  if (resourceMetadataUrl) {
    responseBody.resource_metadata = resourceMetadataUrl;
  }

  res.status(401).json(responseBody);
};

export const handleSseConnection = async (req: Request, res: Response): Promise<void> => {
  // User context is now set by sseUserContextMiddleware
  const userContextService = UserContextService.getInstance();

  // Check bearer auth using filtered settings
  const bearerAuthResult = await validateBearerAuth(req);
  if (!bearerAuthResult.valid) {
    sendBearerAuthError(req, res, bearerAuthResult.reason);
    return;
  }

  attachUserContextFromBearer(bearerAuthResult, res);

  const currentUser = userContextService.getCurrentUser();
  const username = currentUser?.username;

  const systemConfigDao = getSystemConfigDao();
  const systemConfig = await systemConfigDao.get();
  const routingConfig = systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    enableBearerAuth: true,
    bearerAuthKey: '',
  };
  const group = req.params.group;

  // Check if this is a global route (no group) and if it's allowed
  if (!group && !routingConfig.enableGlobalRoute) {
    console.warn('Global routes are disabled, group ID is required');
    res.status(403).send('Global routes are disabled. Please specify a group ID.');
    return;
  }

  // For user-scoped routes, validate that the user has access to the requested group
  if (username && group) {
    // Additional validation can be added here to check if user has access to the group
    console.log(`User ${username} accessing group: ${group}`);
  }

  // Construct the appropriate messages path based on user context
  const messagesPath = username
    ? `${config.basePath}/${username}/messages`
    : `${config.basePath}/messages`;

  console.log(`Creating SSE transport with messages path: ${messagesPath}`);

  const transport = new SSEServerTransport(messagesPath, res);
  transports[transport.sessionId] = {
    transport,
    group: group,
    keyId: bearerAuthResult.keyId,
    keyName: bearerAuthResult.keyName,
    hostedAuth: bearerAuthResult.hostedAuth,
  };

  res.on('close', () => {
    delete transports[transport.sessionId];
    deleteMcpServer(transport.sessionId);
    console.log(`SSE connection closed: ${transport.sessionId}`);
  });

  console.log(
    `New SSE connection established: ${transport.sessionId} with group: ${group || 'global'}${username ? ` for user: ${username}` : ''}`,
  );
  const server = await getMcpServer(transport.sessionId, group);
  await server.connect(transport);
};

export const handleSseMessage = async (req: Request, res: Response): Promise<void> => {
  // User context is now set by sseUserContextMiddleware
  const userContextService = UserContextService.getInstance();

  // Pre-populate group from session context BEFORE auth validation.
  // When a group-scoped bearer key is used to connect via /sse/:group, the session
  // stores the group. Subsequent /messages requests arrive on the global route
  // (no :group param), so isBearerKeyAllowedForRequest would see an empty paramValue
  // and reject the key with 401. Injecting the group here lets the validator use
  // the correct scope from the already-authenticated session.
  const preSessionId = req.query.sessionId as string;
  if (preSessionId && transports[preSessionId] && !req.params.group) {
    const sessionGroup = transports[preSessionId].group;
    if (sessionGroup) {
      req.params.group = sessionGroup;
    }
  }

  // Check bearer auth using filtered settings
  const bearerAuthResult = await validateBearerAuth(req);
  if (!bearerAuthResult.valid) {
    sendBearerAuthError(req, res, bearerAuthResult.reason);
    return;
  }

  attachUserContextFromBearer(bearerAuthResult, res);

  const currentUser = userContextService.getCurrentUser();
  const username = currentUser?.username;

  const sessionId = req.query.sessionId as string;

  // Validate sessionId
  if (!sessionId) {
    console.error('Missing sessionId in query parameters');
    res.status(400).send('Missing sessionId parameter');
    return;
  }

  // Check if transport exists before destructuring
  const transportData = transports[sessionId];
  if (!transportData) {
    console.warn(`No transport found for sessionId: ${sessionId}`);
    res.status(404).send('No transport found for sessionId');
    return;
  }

  const { transport, group, keyId, keyName } = transportData;
  req.params.group = group;
  req.query.group = group;
  console.log(
    `Received message for sessionId: ${sessionId} in group: ${group}${username ? ` for user: ${username}` : ''}`,
  );

  const requestContextService = RequestContextService.getInstance();
  const currentKeyId = bearerAuthResult.keyId || keyId;
  const currentKeyName = bearerAuthResult.keyName || keyName;
  const currentHostedAuth = bearerAuthResult.hostedAuth || transportData.hostedAuth;

  await requestContextService.runWithRequestContext(req, async () => {
    // Set bearer key and group context for activity logging (from session or current request)
    requestContextService.setBearerKeyContext(currentKeyId, currentKeyName);
    requestContextService.setGroupContext(group);
    requestContextService.setUsernameContext(username);
    requestContextService.setHostedAuthContext(currentHostedAuth);
    requestContextService.setKeyKindContext(bearerAuthResult.kind);

    await (transport as SSEServerTransport).handlePostMessage(req, res);
  });
};

// Helper function to create a session with a specific sessionId
async function createSessionWithId(
  sessionId: string,
  group: string,
  username?: string,
  hostedAuth?: HostedAuthContext,
): Promise<StreamableHTTPServerTransport> {
  console.log(
    `[SESSION REBUILD] Starting session rebuild for ID: ${sessionId}${username ? ` for user: ${username}` : ''}`,
  );

  // Create a new server instance to ensure clean state
  const server = await getMcpServer(sessionId, group);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId, // Use the specified sessionId
    onsessioninitialized: (initializedSessionId) => {
      console.log(
        `[SESSION REBUILD] onsessioninitialized triggered for ID: ${initializedSessionId}`,
      ); // New log
      if (initializedSessionId === sessionId) {
        transports[sessionId] = { transport, group, hostedAuth };
        console.log(
          `[SESSION REBUILD] Session ${sessionId} initialized successfully${username ? ` for user: ${username}` : ''}`,
        );
      } else {
        console.warn(
          `[SESSION REBUILD] Session ID mismatch: expected ${sessionId}, got ${initializedSessionId}`,
        );
      }
    },
  });

  transport.onclose = () => {
    console.log(`[SESSION REBUILD] Transport closed: ${sessionId}`);
    delete transports[sessionId];
    deleteMcpServer(sessionId);
  };

  // Connect to MCP server
  await server.connect(transport);

  if (!rehydrateRebuiltTransport(transport, sessionId)) {
    console.error(
      `[SESSION REBUILD] Failed to rehydrate transport state for session ${sessionId}`,
    );
    await transport.close();
    throw new Error('Failed to rebuild session transport state');
  }

  transports[sessionId] = { transport, group, hostedAuth };

  console.log(
    `[SESSION REBUILD] Rehydrated session ${sessionId} for immediate request handling.`,
  );

  console.log(`[SESSION REBUILD] Successfully rebuilt session ${sessionId} in group: ${group}`);
  return transport;
}
// Helper function to create a completely new session
async function createNewSession(
  group: string,
  username?: string,
  hostedAuth?: HostedAuthContext,
): Promise<StreamableHTTPServerTransport> {
  const newSessionId = randomUUID();
  console.log(
    `[SESSION NEW] Creating new session with ID: ${newSessionId}${username ? ` for user: ${username}` : ''}`,
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
    onsessioninitialized: (sessionId) => {
      transports[sessionId] = { transport, group, hostedAuth };
      console.log(
        `[SESSION NEW] New session ${sessionId} initialized successfully${username ? ` for user: ${username}` : ''}`,
      );
    },
  });

  transport.onclose = () => {
    console.log(`[SESSION NEW] Transport closed: ${newSessionId}`);
    delete transports[newSessionId];
    deleteMcpServer(newSessionId);
  };

  const mcpServer = await getMcpServer(newSessionId, group);
  await mcpServer.connect(transport);
  console.log(`[SESSION NEW] Successfully created new session ${newSessionId} in group: ${group}`);
  return transport;
}

export const handleMcpPostRequest = async (req: Request, res: Response): Promise<void> => {
  // User context is now set by sseUserContextMiddleware
  const userContextService = UserContextService.getInstance();

  // Check bearer auth using filtered settings
  const bearerAuthResult = await validateBearerAuth(req);
  if (!bearerAuthResult.valid) {
    sendBearerAuthError(req, res, bearerAuthResult.reason);
    return;
  }

  attachUserContextFromBearer(bearerAuthResult, res);

  const currentUser = userContextService.getCurrentUser();
  const username = currentUser?.username;

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const group = req.params.group;
  const body = req.body;
  console.log(
    `Handling MCP post request for sessionId: ${sessionId} and group: ${group}${username ? ` for user: ${username}` : ''} with body: ${JSON.stringify(body)}`,
  );

  // Get filtered settings based on user context (after setting user context)
  const systemConfigDao = getSystemConfigDao();
  const systemConfig = await systemConfigDao.get();
  const routingConfig = {
    enableGlobalRoute: systemConfig?.routing?.enableGlobalRoute ?? true,
    enableGroupNameRoute: systemConfig?.routing?.enableGroupNameRoute ?? true,
  };
  if (!group && !routingConfig.enableGlobalRoute) {
    res.status(403).send('Global routes are disabled. Please specify a group ID.');
    return;
  }

  let transport: StreamableHTTPServerTransport;
  let transportInfo: (typeof transports)[string] | undefined;

  if (sessionId) {
    transportInfo = transports[sessionId];
  }

  if (sessionId && transportInfo) {
    // Case 1: Session exists and is valid, reuse it
    console.log(
      `[SESSION REUSE] Reusing existing session: ${sessionId}${username ? ` for user: ${username}` : ''}`,
    );
    transport = transportInfo.transport as StreamableHTTPServerTransport;
  } else if (sessionId) {
    // Case 2: SessionId exists but transport is missing (server restart), check if session rebuild is enabled
    const enableSessionRebuild = systemConfig?.enableSessionRebuild || false;

    if (enableSessionRebuild) {
      console.log(
        `[SESSION AUTO-REBUILD] Session ${sessionId} not found, initiating transparent rebuild${username ? ` for user: ${username}` : ''}`,
      );
      const ownsSessionCreationLock = sessionCreationLocks[sessionId] === undefined;

      if (ownsSessionCreationLock) {
        sessionCreationLocks[sessionId] = createSessionWithId(
          sessionId,
          group,
          username,
          bearerAuthResult.hostedAuth,
        );
      } else {
        console.log(
          `[SESSION AUTO-REBUILD] Session creation in progress for ${sessionId}, waiting...`,
        );
      }

      try {
        transport = await sessionCreationLocks[sessionId];

        if (ownsSessionCreationLock) {
          console.log(
            `[SESSION AUTO-REBUILD] Successfully transparently rebuilt session: ${sessionId}`,
          );
        }
      } catch (error) {
        console.error('[SESSION AUTO-REBUILD] Failed to rebuild session', {
          sessionId,
          error,
        });
        cleanupSessionState(sessionId);
        sendSessionNotFoundJsonRpc(res);
        return;
      } finally {
        if (ownsSessionCreationLock) {
          delete sessionCreationLocks[sessionId];
        }
      }

      // Get the updated transport info after rebuild
      if (sessionId) {
        transportInfo = transports[sessionId];
      }
    } else {
      // Session rebuild is disabled, return error
      console.warn(
        `[SESSION ERROR] Session ${sessionId} not found and session rebuild is disabled${username ? ` for user: ${username}` : ''}`,
      );
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }
  } else if (isInitializeRequest(req.body)) {
    // Case 3: No sessionId and this is an initialize request, create new session
    console.log(
      `[SESSION CREATE] No session ID provided for initialize request, creating new session${username ? ` for user: ${username}` : ''}`,
    );
    transport = await createNewSession(group, username, bearerAuthResult.hostedAuth);
  } else if (
    req.body &&
    typeof req.body.method === 'string' &&
    req.body.method.startsWith('notifications/')
  ) {
    // Case 4: Session-less notification requests should be acknowledged and ignored
    console.log(
      `[SESSION SKIP] Ignoring session-less notification request (method: ${req.body.method})${username ? ` for user: ${username}` : ''}`,
    );
    res.status(200).end();
    return;
  } else {
    // Case 5: No sessionId and not an initialize/notification request, return error
    console.warn(
      `[SESSION ERROR] No session ID provided for non-initialize request (method: ${req.body?.method})${username ? ` for user: ${username}` : ''}`,
    );
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided',
      },
      id: null,
    });
    return;
  }

  console.log(`Handling request using transport with type ${transport.constructor.name}`);

  const requestContextService = RequestContextService.getInstance();
  await requestContextService.runWithRequestContext(req, async () => {
    // Set bearer key and group context for activity logging
    requestContextService.setBearerKeyContext(bearerAuthResult.keyId, bearerAuthResult.keyName);
    requestContextService.setGroupContext(group);
    requestContextService.setUsernameContext(username);
    requestContextService.setKeyKindContext(bearerAuthResult.kind);
    requestContextService.setHostedAuthContext(
      bearerAuthResult.hostedAuth || transportInfo?.hostedAuth,
    );

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
      if (sessionId && error?.message?.includes('Server not initialized')) {
        console.warn(
          `[SESSION AUTO-REBUILD] Rebuilt session ${sessionId} is not initialized. Returning explicit session-not-found response.`,
        );
        cleanupSessionState(sessionId);
        if (!res.headersSent) {
          sendSessionNotFoundJsonRpc(res);
        }
        return;
      } else {
        // If it's a different error, just re-throw it
        throw error;
      }
    }
  });
};

export const handleMcpOtherRequest = async (req: Request, res: Response) => {
  // User context is now set by sseUserContextMiddleware
  const userContextService = UserContextService.getInstance();

  // Check bearer auth using filtered settings
  const bearerAuthResult = await validateBearerAuth(req);
  if (!bearerAuthResult.valid) {
    sendBearerAuthError(req, res, bearerAuthResult.reason);
    return;
  }

  attachUserContextFromBearer(bearerAuthResult, res);

  const currentUser = userContextService.getCurrentUser();
  const username = currentUser?.username;

  console.log(`Handling MCP other request${username ? ` for user: ${username}` : ''}`);

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  let transportEntry = transports[sessionId];

  // If session doesn't exist, attempt transparent rebuild if enabled
  if (!transportEntry) {
    const systemConfigDao = getSystemConfigDao();
    const systemConfig = await systemConfigDao.get();
    const enableSessionRebuild = systemConfig?.enableSessionRebuild || false;

    if (enableSessionRebuild) {
      console.log(
        `[SESSION AUTO-REBUILD] Session ${sessionId} not found in handleMcpOtherRequest, initiating transparent rebuild`,
      );

      try {
        // Check if user context exists
        if (!currentUser) {
          res.status(401).send('User context not found');
          return;
        }

        // Create session with same ID using existing function
        const group = req.params.group;
        const rebuiltSession = await createSessionWithId(
          sessionId,
          group,
          currentUser.username,
          bearerAuthResult.hostedAuth,
        );
        if (rebuiltSession) {
          console.log(
            `[SESSION AUTO-REBUILD] Successfully transparently rebuilt session: ${sessionId}`,
          );
          transportEntry = transports[sessionId];
        }
      } catch (error) {
        console.error('[SESSION AUTO-REBUILD] Failed to rebuild session', {
          sessionId,
          error,
        });
        cleanupSessionState(sessionId);
        sendSessionNotFoundText(res);
        return;
      }
    } else {
      console.warn(
        `[SESSION ERROR] Session ${sessionId} not found and session rebuild is disabled in handleMcpOtherRequest`,
      );
      res.status(400).send('Invalid or missing session ID');
      return;
    }
  }

  if (!transportEntry) {
    sendSessionNotFoundText(res);
    return;
  }

  const { transport } = transportEntry;

  try {
    await (transport as StreamableHTTPServerTransport).handleRequest(req, res);
  } catch (error: any) {
    if (error?.message?.includes('Server not initialized')) {
      console.warn(
        `[SESSION AUTO-REBUILD] Rebuilt session ${sessionId} is not initialized for auxiliary request. Returning explicit session-not-found response.`,
      );
      cleanupSessionState(sessionId);
      if (!res.headersSent) {
        sendSessionNotFoundText(res);
      }
      return;
    }

    throw error;
  }
};

export const getConnectionCount = (): number => {
  return Object.keys(transports).length;
};
