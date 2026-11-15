import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const toolTrigger = process.argv[2];
const resourceTrigger = process.argv[3];
let toolAdded = false;
let resourceAdded = false;
const tools = [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }];
const resources = [{ uri: 'test://Report', name: 'Report' }];

const server = new Server(
  { name: 'hub-to-hub-upstream', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true }, resources: { listChanged: true } } },
);

server.setRequestHandler('tools/list', async () => ({ tools }));
server.setRequestHandler('resources/list', async () => ({ resources }));
server.setRequestHandler('resources/read', async (request) => ({
  contents: [{ uri: request.params.uri, text: `contents for ${request.params.uri}` }],
}));

const poll = setInterval(() => {
  if (!toolAdded && toolTrigger && fs.existsSync(toolTrigger)) {
    toolAdded = true;
    tools.push({ name: 'new', description: 'New', inputSchema: { type: 'object' } });
    void server.sendToolListChanged();
  }
  if (!resourceAdded && resourceTrigger && fs.existsSync(resourceTrigger)) {
    resourceAdded = true;
    resources.push({ uri: 'test://Report2', name: 'Report2' });
    void server.sendResourceListChanged();
  }
}, 10);

await server.connect(new StdioServerTransport());

const close = async () => {
  clearInterval(poll);
  await server.close();
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
