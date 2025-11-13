import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { deleteMcpServer, getMcpServer } from './mcpService.js';
import { loadSettings } from '../config/index.js';
import config from '../config/index.js';
import { UserContextService } from './userContextService.js';
import { RequestContextService } from './requestContextService.js';
import { IUser } from '../types/index.js';
import { resolveOAuthUserFromToken } from '../utils/oauthBearer.js';

const transports: { [sessionId: string]: { transport: Transport; group: string } } = {};

export const getGroup = (sessionId: string): string => {
  return transports[sessionId]?.group || '';
};

type BearerAuthResult =
  | { valid: true; user?: IUser }
  | {
      valid: false;
      reason: 'missing' | 'invalid';
    };

const validateBearerAuth = (req: Request): BearerAuthResult => {
  const settings = loadSettings();
  const routingConfig = settings.systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    enableBearerAuth: false,
    bearerAuthKey: '',
  };

  if (routingConfig.enableBearerAuth) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { valid: false, reason: 'missing' };
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    if (token.trim().length === 0) {
      return { valid: false, reason: 'missing' };
    }

    if (token === routingConfig.bearerAuthKey) {
      return { valid: true };
    }

    const oauthUser = resolveOAuthUserFromToken(token);
    if (oauthUser) {
      return { valid: true, user: oauthUser };
    }

    return { valid: false, reason: 'invalid' };
  }

  return { valid: true };
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

const sendBearerAuthError = (req: Request, res: Response, reason: 'missing' | 'invalid'): void => {
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
  const bearerAuthResult = validateBearerAuth(req);
  if (!bearerAuthResult.valid) {
    sendBearerAuthError(req, res, bearerAuthResult.reason);
    return;
  }

  attachUserContextFromBearer(bearerAuthResult, res);

  const currentUser = userContextService.getCurrentUser();
  const username = currentUser?.username;

  const settings = loadSettings();
  const routingConfig = settings.systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    enableBearerAuth: false,
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
  transports[transport.sessionId] = { transport, group: group };

  res.on('close', () => {
    delete transports[transport.sessionId];
    deleteMcpServer(transport.sessionId);
    console.log(`SSE connection closed: ${transport.sessionId}`);
  });

  console.log(
    `New SSE connection established: ${transport.sessionId} with group: ${group || 'global'}${username ? ` for user: ${username}` : ''}`,
  );
  await getMcpServer(transport.sessionId, group).connect(transport);
};

export const handleSseMessage = async (req: Request, res: Response): Promise<void> => {
  // User context is now set by sseUserContextMiddleware
  const userContextService = UserContextService.getInstance();

  // Check bearer auth using filtered settings
  const bearerAuthResult = validateBearerAuth(req);
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

  const { transport, group } = transportData;
  req.params.group = group;
  req.query.group = group;
  console.log(
    `Received message for sessionId: ${sessionId} in group: ${group}${username ? ` for user: ${username}` : ''}`,
  );

  // Set request context for MCP handlers to access HTTP headers
  const requestContextService = RequestContextService.getInstance();
  requestContextService.setRequestContext(req);

  try {
    await (transport as SSEServerTransport).handlePostMessage(req, res);
  } finally {
    // Clean up request context after handling
    requestContextService.clearRequestContext();
  }
};

export const handleMcpPostRequest = async (req: Request, res: Response): Promise<void> => {
  // User context is now set by sseUserContextMiddleware
  const userContextService = UserContextService.getInstance();

  // Check bearer auth using filtered settings
  const bearerAuthResult = validateBearerAuth(req);
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
  const settings = loadSettings();
  const routingConfig = settings.systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
  };
  if (!group && !routingConfig.enableGlobalRoute) {
    res.status(403).send('Global routes are disabled. Please specify a group ID.');
    return;
  }

  let transport: StreamableHTTPServerTransport;
  if (sessionId && transports[sessionId]) {
    console.log(`Reusing existing transport for sessionId: ${sessionId}`);
    transport = transports[sessionId].transport as StreamableHTTPServerTransport;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transports[sessionId] = { transport, group };
      },
    });

    transport.onclose = () => {
      console.log(`Transport closed: ${transport.sessionId}`);
      if (transport.sessionId) {
        delete transports[transport.sessionId];
        deleteMcpServer(transport.sessionId);
        console.log(`MCP connection closed: ${transport.sessionId}`);
      }
    };

    console.log(
      `MCP connection established: ${transport.sessionId}${username ? ` for user: ${username}` : ''}`,
    );
    await getMcpServer(transport.sessionId, group).connect(transport);
  } else {
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

  // Set request context for MCP handlers to access HTTP headers
  const requestContextService = RequestContextService.getInstance();
  requestContextService.setRequestContext(req);

  try {
    await transport.handleRequest(req, res, req.body);
  } finally {
    // Clean up request context after handling
    requestContextService.clearRequestContext();
  }
};

export const handleMcpOtherRequest = async (req: Request, res: Response) => {
  // User context is now set by sseUserContextMiddleware
  const userContextService = UserContextService.getInstance();

  // Check bearer auth using filtered settings
  const bearerAuthResult = validateBearerAuth(req);
  if (!bearerAuthResult.valid) {
    sendBearerAuthError(req, res, bearerAuthResult.reason);
    return;
  }

  attachUserContextFromBearer(bearerAuthResult, res);

  const currentUser = userContextService.getCurrentUser();
  const username = currentUser?.username;

  console.log(`Handling MCP other request${username ? ` for user: ${username}` : ''}`);

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const { transport } = transports[sessionId];
  await (transport as StreamableHTTPServerTransport).handleRequest(req, res);
};

export const getConnectionCount = (): number => {
  return Object.keys(transports).length;
};
