import { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { getMcpServer } from './mcpService.js';

const transports: { [sessionId: string]: { transport: SSEServerTransport; group: string } } = {};

export const getGroup = (sessionId: string): string => {
  return transports[sessionId]?.group || '';
};

export const handleSseConnection = async (req: Request, res: Response): Promise<void> => {
  const transport = new SSEServerTransport('/messages', res);
  const group = req.params.group;
  transports[transport.sessionId] = { transport, group };

  res.on('close', () => {
    delete transports[transport.sessionId];
    console.log(`SSE connection closed: ${transport.sessionId}`);
  });

  console.log(`New SSE connection established: ${transport.sessionId}`);
  await getMcpServer().connect(transport);
};

export const handleSseMessage = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.sessionId as string;
  const { transport, group } = transports[sessionId];
  req.params.group = group;
  req.query.group = group;
  console.log(`Received message for sessionId: ${sessionId} in group: ${group}`);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    console.error(`No transport found for sessionId: ${sessionId}`);
    res.status(400).send('No transport found for sessionId');
  }
};

export const getConnectionCount = (): number => {
  return Object.keys(transports).length;
};
