import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'credential-stdio-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'verify_credential',
      description: 'Checks the injected credential without returning it.',
      inputSchema: {
        type: 'object',
        properties: { expected: { type: 'string' } },
        required: ['expected'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [
    {
      type: 'text',
      text: process.env.PERSONAL_TOKEN === request.params.arguments?.expected ? 'matched' : 'mismatch',
    },
  ],
}));

await server.connect(new StdioServerTransport());
