import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { deleteMcpServer, getMcpServer } from './mcpService.js';
import { loadSettings } from '../config/index.js';

const transports: { [sessionId: string]: { transport: Transport; group: string } } = {};

export const getGroup = (sessionId: string): string => {
  return transports[sessionId]?.group || '';
};

export const handleSseConnection = async (req: Request, res: Response): Promise<void> => {
  const settings = loadSettings();
  const routingConfig = settings.systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
  };
  const group = req.params.group;

  // Check if this is a global route (no group) and if it's allowed
  if (!group && !routingConfig.enableGlobalRoute) {
    res.status(403).send('Global routes are disabled. Please specify a group ID.');
    return;
  }

  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = { transport, group: group };

  res.on('close', () => {
    delete transports[transport.sessionId];
    deleteMcpServer(transport.sessionId);
    console.log(`SSE connection closed: ${transport.sessionId}`);
  });

  console.log(
    `New SSE connection established: ${transport.sessionId} with group: ${group || 'global'}`,
  );
  await getMcpServer(transport.sessionId).connect(transport);
};

export const handleSseMessage = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.sessionId as string;
  const { transport, group } = transports[sessionId];
  req.params.group = group;
  req.query.group = group;
  console.log(`Received message for sessionId: ${sessionId} in group: ${group}`);
  if (transport) {
    await (transport as SSEServerTransport).handlePostMessage(req, res);
  } else {
    console.error(`No transport found for sessionId: ${sessionId}`);
    res.status(400).send('No transport found for sessionId');
  }
};

export const handleMcpPostRequest = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const group = req.params.group;
  console.log(`Handling MCP post request for sessionId: ${sessionId} and group: ${group}`);
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
      if (transport.sessionId) {
        delete transports[transport.sessionId];
        deleteMcpServer(transport.sessionId);
        console.log(`MCP connection closed: ${transport.sessionId}`);
      }
    };

    console.log(`MCP connection established: ${transport.sessionId}`);
    await getMcpServer(transport.sessionId || 'mcp').connect(transport);
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
  await transport.handleRequest(req, res, req.body);
};

export const handleMcpOtherRequest = async (req: Request, res: Response) => {
  console.log('Handling MCP other request');
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
