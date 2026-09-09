import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

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
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'identity',
      inputSchema: { type: 'object', properties: { delay: { type: 'number' } } },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  await new Promise((resolve) => setTimeout(resolve, request.params.arguments?.delay || 0));
  return { content: [{ type: 'text', text: identity() }] };
});
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{ name: 'identity' }],
}));
server.setRequestHandler(GetPromptRequestSchema, async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: identity() } }],
}));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ name: 'identity', uri: 'personal://identity' }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({
  contents: [{ uri: 'personal://identity', text: identity() }],
}));
await server.connect(new StdioServerTransport());
