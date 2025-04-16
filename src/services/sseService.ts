import { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { getMcpServer } from './mcpService.js';

const transports: { [sessionId: string]: { transport: SSEServerTransport; groupId: string } } = {};

export const getGroupId = (sessionId: string): string => {
  return transports[sessionId]?.groupId || '';
};

export const handleSseConnection = async (req: Request, res: Response): Promise<void> => {
  const transport = new SSEServerTransport('/messages', res);
  const groupId = req.params.groupId;
  transports[transport.sessionId] = { transport, groupId };

  res.on('close', () => {
    delete transports[transport.sessionId];
    console.log(`SSE connection closed: ${transport.sessionId}`);
  });

  console.log(`New SSE connection established: ${transport.sessionId}`);
  await getMcpServer().connect(transport);
};

export const handleSseMessage = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.sessionId as string;
  const { transport, groupId } = transports[sessionId];
  req.params.groupId = groupId;
  req.query.groupId = groupId;
  console.log(`Received message for sessionId: ${sessionId} in groupId: ${groupId}`);
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
