import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const server = new Server(
  { name: 'elicitation-fixture', version: '1' },
  { supportedProtocolVersions: ['2025-11-25'], capabilities: { tools: {} } },
);
server.setRequestHandler('tools/list', async () => ({
  tools: [
    { name: 'ask', inputSchema: { type: 'object' } },
    { name: 'capabilities', inputSchema: { type: 'object' } },
  ],
}));
server.setRequestHandler('tools/call', async (request, context) => {
  const capabilities = server.getClientCapabilities();
  if (request.params.name === 'capabilities') {
    return { content: [{ type: 'text', text: JSON.stringify(capabilities) }] };
  }
  const { message = 'Your choice', mode = 'form' } = request.params.arguments ?? {};
  const result = await context.mcpReq.elicitInput(
    mode === 'url'
      ? { mode, message, url: 'https://example.com/authorize', elicitationId: message }
      : {
          message,
          requestedSchema: {
            type: 'object',
            properties: { choice: { type: 'string' } },
            required: ['choice'],
          },
        },
    { signal: context.mcpReq.signal },
  );
  if (mode === 'url' && result.action === 'accept') {
    await server.notification({
      method: 'notifications/elicitation/complete',
      params: { elicitationId: message },
    });
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
await server.connect(new StdioServerTransport());
