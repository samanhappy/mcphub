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

export const transports: {
  [sessionId: string]: { transport: Transport; group: string; needsInitialization?: boolean };
} = {};

// Session creation locks to prevent concurrent session creation conflicts
const sessionCreationLocks: { [sessionId: string]: Promise<StreamableHTTPServerTransport> } = {};

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

  // Send keepalive ping every 30 seconds to prevent client from closing connection
  const keepAlive = setInterval(() => {
    try {
      // Send a ping notification to keep the connection alive
      transport.send({ jsonrpc: '2.0', method: 'ping' });
      console.log(`Sent keepalive ping for SSE session: ${transport.sessionId}`);
    } catch (e) {
      // If sending a ping fails, the connection is likely broken.
      // Log the error and clear the interval to prevent further attempts.
      console.warn(
        `Failed to send keepalive ping for SSE session ${transport.sessionId}, cleaning up interval:`,
        e,
      );
      clearInterval(keepAlive);
    }
  }, 30000); // Send ping every 30 seconds

  res.on('close', () => {
    clearInterval(keepAlive);
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

// Helper function to create a session with a specific sessionId
async function createSessionWithId(
  sessionId: string,
  group: string,
  username?: string,
): Promise<StreamableHTTPServerTransport> {
  console.log(
    `[SESSION REBUILD] Starting session rebuild for ID: ${sessionId}${username ? ` for user: ${username}` : ''}`,
  );

  // Create a new server instance to ensure clean state
  const server = getMcpServer(sessionId, group);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId, // Use the specified sessionId
    onsessioninitialized: (initializedSessionId) => {
      console.log(
        `[SESSION REBUILD] onsessioninitialized triggered for ID: ${initializedSessionId}`,
      ); // New log
      if (initializedSessionId === sessionId) {
        transports[sessionId] = { transport, group };
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

  // Send keepalive ping every 30 seconds to prevent client from closing connection
  const keepAlive = setInterval(() => {
    try {
      // Send a ping notification to keep the connection alive
      transport.send({ jsonrpc: '2.0', method: 'ping' });
      console.log(`Sent keepalive ping for StreamableHTTP session: ${sessionId}`);
    } catch (e) {
      // If sending a ping fails, the connection is likely broken.
      // Log the error and clear the interval to prevent further attempts.
      console.warn(
        `Failed to send keepalive ping for StreamableHTTP session ${sessionId}, cleaning up interval:`,
        e,
      );
      clearInterval(keepAlive);
    }
  }, 30000); // Send ping every 30 seconds

  transport.onclose = () => {
    console.log(`[SESSION REBUILD] Transport closed: ${sessionId}`);
    clearInterval(keepAlive);
    delete transports[sessionId];
    deleteMcpServer(sessionId);
  };

  // Connect to MCP server
  await server.connect(transport);

  // Wait for the server to fully initialize
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Ensure the transport is properly initialized
  if (!transports[sessionId]) {
    console.warn(
      `[SESSION REBUILD] Transport not found in transports after initialization, forcing registration`,
    );
    transports[sessionId] = { transport, group, needsInitialization: true };
  } else {
    // Mark the session as needing initialization
    transports[sessionId].needsInitialization = true;
  }

  console.log(
    `[SESSION REBUILD] Session ${sessionId} created but not yet initialized. It will be initialized on first use.`,
  );

  console.log(`[SESSION REBUILD] Successfully rebuilt session ${sessionId} in group: ${group}`);
  return transport;
}
// Helper function to create a completely new session
async function createNewSession(
  group: string,
  username?: string,
): Promise<StreamableHTTPServerTransport> {
  const newSessionId = randomUUID();
  console.log(
    `[SESSION NEW] Creating new session with ID: ${newSessionId}${username ? ` for user: ${username}` : ''}`,
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
    onsessioninitialized: (sessionId) => {
      transports[sessionId] = { transport, group };
      console.log(
        `[SESSION NEW] New session ${sessionId} initialized successfully${username ? ` for user: ${username}` : ''}`,
      );
    },
  });

  // Send keepalive ping every 30 seconds to prevent client from closing connection
  const keepAlive = setInterval(() => {
    try {
      // Send a ping notification to keep the connection alive
      transport.send({ jsonrpc: '2.0', method: 'ping' });
      console.log(`Sent keepalive ping for StreamableHTTP session: ${newSessionId}`);
    } catch (e) {
      // If sending a ping fails, the connection is likely broken.
      // Log the error and clear the interval to prevent further attempts.
      console.warn(
        `Failed to send keepalive ping for StreamableHTTP session ${newSessionId}, cleaning up interval:`,
        e,
      );
      clearInterval(keepAlive);
    }
  }, 30000); // Send ping every 30 seconds

  transport.onclose = () => {
    console.log(`[SESSION NEW] Transport closed: ${newSessionId}`);
    clearInterval(keepAlive);
    delete transports[newSessionId];
    deleteMcpServer(newSessionId);
  };

  await getMcpServer(newSessionId, group).connect(transport);
  console.log(`[SESSION NEW] Successfully created new session ${newSessionId} in group: ${group}`);
  return transport;
}

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
    const settings = loadSettings();
    const enableSessionRebuild = settings.systemConfig?.enableSessionRebuild || false;

    if (enableSessionRebuild) {
      console.log(
        `[SESSION AUTO-REBUILD] Session ${sessionId} not found, initiating transparent rebuild${username ? ` for user: ${username}` : ''}`,
      );
      // Prevent concurrent session creation
      if (sessionCreationLocks[sessionId] !== undefined) {
        console.log(
          `[SESSION AUTO-REBUILD] Session creation in progress for ${sessionId}, waiting...`,
        );
        transport = await sessionCreationLocks[sessionId];
      } else {
        sessionCreationLocks[sessionId] = createSessionWithId(sessionId, group, username);
        try {
          transport = await sessionCreationLocks[sessionId];
          console.log(
            `[SESSION AUTO-REBUILD] Successfully transparently rebuilt session: ${sessionId}`,
          );
        } catch (error) {
          console.error(`[SESSION AUTO-REBUILD] Failed to rebuild session ${sessionId}:`, error);
          throw error;
        } finally {
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
    transport = await createNewSession(group, username);
  } else {
    // Case 4: No sessionId and not an initialize request, return error
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

  // Set request context for MCP handlers to access HTTP headers
  const requestContextService = RequestContextService.getInstance();
  requestContextService.setRequestContext(req);

  // Check if the session needs initialization (for rebuilt sessions)
  if (transportInfo && transportInfo.needsInitialization) {
    console.log(
      `[MCP] Session ${sessionId} needs initialization, performing proactive initialization`,
    );

    try {
      // Create a mock response object that doesn't actually send headers
      const mockRes = {
        writeHead: () => {},
        end: () => {},
        json: () => {},
        status: () => mockRes,
        send: () => {},
        headersSent: false,
      } as any;

      // First, send the initialize request
      const initializeRequest = {
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: {
            name: 'MCPHub-Client',
            version: '1.0.0',
          },
        },
        jsonrpc: '2.0',
        id: `init-${sessionId}-${Date.now()}`,
      };

      console.log(`[MCP] Sending initialize request for session ${sessionId}`);
      // Use mock response to avoid sending actual HTTP response
      await transport.handleRequest(req, mockRes, initializeRequest);

      // Then send the initialized notification
      const initializedNotification = {
        method: 'notifications/initialized',
        jsonrpc: '2.0',
      };

      console.log(`[MCP] Sending initialized notification for session ${sessionId}`);
      await transport.handleRequest(req, mockRes, initializedNotification);

      // Mark the session as initialized
      transportInfo.needsInitialization = false;
      console.log(`[MCP] Session ${sessionId} successfully initialized`);
    } catch (initError) {
      console.error(`[MCP] Failed to initialize session ${sessionId}:`, initError);
      console.error(`[MCP] Initialization error details:`, initError);
      // Don't return here, continue with the original request
    }
  }

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    // Check if this is a "Server not initialized" error for a newly rebuilt session
    if (sessionId && error.message && error.message.includes('Server not initialized')) {
      console.log(
        `[SESSION AUTO-REBUILD] Server not initialized for ${sessionId}. Attempting to initialize with the current request.`,
      );

      // Check if the current request is an 'initialize' request
      if (isInitializeRequest(req.body)) {
        // If it is, we can just retry it. The transport should now be in the transports map.
        console.log(`[SESSION AUTO-REBUILD] Retrying initialize request for ${sessionId}.`);
        await transport.handleRequest(req, res, req.body);
      } else {
        // If not, we need to send an initialize request first.
        // We construct a mock initialize request, but use the REAL req/res objects.
        const initializeRequest = {
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: {
              name: 'MCPHub-Client',
              version: '1.0.0',
            },
          },
          jsonrpc: '2.0',
          id: `init-${sessionId}-${Date.now()}`,
        };

        console.log(
          `[SESSION AUTO-REBUILD] Sending initialize request for ${sessionId} before handling the actual request.`,
        );
        try {
          // Temporarily replace the body to send the initialize request
          const originalBody = req.body;
          req.body = initializeRequest;
          await transport.handleRequest(req, res, req.body);

          // Now, send the notifications/initialized
          const initializedNotification = {
            method: 'notifications/initialized',
            jsonrpc: '2.0',
          };
          req.body = initializedNotification;
          await transport.handleRequest(req, res, req.body);

          // Restore the original body and retry the original request
          req.body = originalBody;
          console.log(
            `[SESSION AUTO-REBUILD] Initialization complete for ${sessionId}. Retrying original request.`,
          );
          await transport.handleRequest(req, res, req.body);
        } catch (initError) {
          console.error(
            `[SESSION AUTO-REBUILD] Failed to initialize session ${sessionId} on-the-fly:`,
            initError,
          );
          // Re-throw the original error if initialization fails
          throw error;
        }
      }
    } else {
      // If it's a different error, just re-throw it
      throw error;
    }
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
  if (!sessionId) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  let transportEntry = transports[sessionId];

  // If session doesn't exist, attempt transparent rebuild if enabled
  if (!transportEntry) {
    const settings = loadSettings();
    const enableSessionRebuild = settings.systemConfig?.enableSessionRebuild || false;

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
        const rebuiltSession = await createSessionWithId(sessionId, group, currentUser.username);
        if (rebuiltSession) {
          console.log(
            `[SESSION AUTO-REBUILD] Successfully transparently rebuilt session: ${sessionId}`,
          );
          transportEntry = transports[sessionId];
        }
      } catch (error) {
        console.error(`[SESSION AUTO-REBUILD] Failed to rebuild session ${sessionId}:`, error);
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
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const { transport } = transportEntry;
  await (transport as StreamableHTTPServerTransport).handleRequest(req, res);
};

export const getConnectionCount = (): number => {
  return Object.keys(transports).length;
};
