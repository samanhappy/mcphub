import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Server } from '@modelcontextprotocol/server';

const server = new Server(
  { name: 'personal-fixture', version: '1.0' },
  { capabilities: { tools: {}, prompts: {}, resources: {} } },
);
const identity = () =>
  JSON.stringify({
    credential: process.env.PERSONAL_KEY,
    pid: process.pid,
    masterKeyInherited: !!process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY,
  });
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'identity',
      inputSchema: { type: 'object', properties: { delay: { type: 'number' } } },
    },
    // A credential with more rights lists more tools, as upstream servers often do
    ...(process.env.PERSONAL_KEY?.startsWith('full-')
      ? [{ name: 'rotate_identity', inputSchema: { type: 'object', properties: {} } }]
      : []),
  ],
}));
server.setRequestHandler('tools/call', async (request) => {
  if (request.params.arguments?.fail)
    throw new Error(`Unsupported input; echoed ${process.env.PERSONAL_KEY}`);
  await new Promise((resolve) => setTimeout(resolve, request.params.arguments?.delay || 0));
  return { content: [{ type: 'text', text: identity() }] };
});
server.setRequestHandler('prompts/list', async () => ({
  prompts: [{ name: 'identity' }],
}));
server.setRequestHandler('prompts/get', async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: identity() } }],
}));
server.setRequestHandler('resources/list', async () => ({
  resources: [{ name: 'identity', uri: 'personal://identity' }],
}));
server.setRequestHandler('resources/read', async () => ({
  contents: [{ uri: 'personal://identity', text: identity() }],
}));
await server.connect(new StdioServerTransport());
