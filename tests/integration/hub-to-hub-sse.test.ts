import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net, { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk-v1/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk-v1/client/sse.js';

const repoRoot = path.resolve(__dirname, '../..');
const fixture = path.join(repoRoot, 'tests/fixtures/hub-to-hub-upstream.mjs');

type HubProcess = {
  child: ChildProcess;
  port: number;
  dir: string;
  logs: () => string;
};

const settings = (servers: Record<string, unknown>, dir: string) => ({
  mcpServers: servers,
  users: [],
  groups: [],
  systemConfig: {
    nameSeparator: '::',
    routing: {
      enableGlobalRoute: true,
      enableGroupNameRoute: false,
      enableBearerAuth: false,
      skipAuth: true,
    },
    network: { allowedCidrs: ['127.0.0.1/32'] },
  },
  dataDir: dir,
});

const freePort = async (): Promise<number> => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

const startHub = async (name: string, settingsValue: object): Promise<HubProcess> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mcphub-${name}-`));
  const settingsPath = path.join(dir, 'mcp_settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settingsValue, null, 2));
  const port = await freePort();
  const output: string[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MCPHUB_SETTING_PATH: settingsPath,
      DISABLE_WEB: 'true',
      USE_DB: 'false',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk) => output.push(chunk.toString()));

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`hub ${name} exited early:\n${output.join('')}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (Date.now() >= deadline) {
    child.kill('SIGTERM');
    throw new Error(`hub ${name} did not become healthy:\n${output.join('')}`);
  }
  return { child, port, dir, logs: () => output.join('') };
};

const stopHub = async (hub: HubProcess | undefined) => {
  if (!hub) return;
  if (hub.child.exitCode === null) {
    hub.child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => hub.child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (hub.child.exitCode === null) hub.child.kill('SIGKILL');
  }
  fs.rmSync(hub.dir, { recursive: true, force: true });
};

const connectSse = async (port: number): Promise<Client> => {
  const client = new Client({ name: 'hub-to-hub-test', version: '1.0.0' });
  await client.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`)));
  return client;
};

const waitFor = async <T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  deadlineMs = 15000,
) => {
  const deadline = Date.now() + deadlineMs;
  let value: T;
  do {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`condition not met; last value: ${JSON.stringify(value!)}`);
};

const toolNames = async (client: Client) =>
  (await client.listTools()).tools.map((tool) => tool.name);

describe('real MCPHub SSE chaining', () => {
  let hubs: HubProcess[] = [];
  let clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients) await client.close().catch(() => undefined);
    clients = [];
    for (const hub of hubs) await stopHub(hub);
    hubs = [];
  });

  it('keeps a legitimate peer update across two real MCPHub processes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-hub-peer-'));
    const toolTrigger = path.join(dir, 'add-tool');
    const resourceTrigger = path.join(dir, 'add-resource');
    const b = await startHub(
      'peer-b',
      settings(
        {
          bridge: {
            type: 'stdio',
            command: process.execPath,
            args: [fixture, toolTrigger, resourceTrigger],
            enabled: true,
          },
        },
        dir,
      ),
    );
    hubs.push(b);
    const bClient = await connectSse(b.port);
    clients.push(bClient);
    await waitFor(
      () => toolNames(bClient),
      (names) => names.includes('bridge::search'),
    );

    const a = await startHub(
      'peer-a',
      settings(
        {
          bridge: {
            type: 'sse',
            url: `http://127.0.0.1:${b.port}/sse`,
            enabled: true,
          },
        },
        path.join(dir, 'a'),
      ),
    );
    hubs.push(a);
    const aClient = await connectSse(a.port);
    clients.push(aClient);
    await waitFor(
      () => toolNames(aClient),
      (names) => names.includes('bridge::bridge::search'),
    );

    fs.writeFileSync(toolTrigger, 'add');
    const names = await waitFor(
      () => toolNames(aClient),
      (current) => current.includes('bridge::bridge::new'),
    );
    expect(names).toEqual(
      expect.arrayContaining(['bridge::bridge::search', 'bridge::bridge::new']),
    );
    expect(a.logs()).not.toContain("self-connection 'bridge'");
  }, 60000);

  it('stops a real self-loop resource cache and notification storm', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-self-loop-'));
    const toolTrigger = path.join(dir, 'add-tool');
    const resourceTrigger = path.join(dir, 'add-resource');
    const hub = await startHub(
      'self-loop',
      settings(
        {
          upstream: {
            type: 'stdio',
            command: process.execPath,
            args: [fixture, toolTrigger, resourceTrigger],
            enabled: true,
          },
        },
        dir,
      ),
    );
    hubs.push(hub);
    const client = await connectSse(hub.port);
    clients.push(client);
    await waitFor(
      async () => (await client.listResources()).resources.map((resource) => resource.uri),
      (uris) => uris.includes('test://Report'),
    );

    const add = await fetch(`http://127.0.0.1:${hub.port}/api/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'self-loop',
        config: {
          type: 'sse',
          url: `http://127.0.0.1:${hub.port}/sse`,
          enabled: true,
        },
      }),
    });
    expect(add.status).toBe(200);
    await waitFor(
      async () => hub.logs(),
      (logs) => logs.includes("Ignoring capabilities from self-connection 'self-loop'"),
    );

    fs.writeFileSync(resourceTrigger, 'add');
    const uris = await waitFor(
      async () => (await client.listResources()).resources.map((resource) => resource.uri),
      (current) => current.includes('test://Report2'),
    );
    expect(uris).toEqual(expect.arrayContaining(['test://Report', 'test://Report2']));

    // Sample long enough for the old feedback loop to append multiple cache
    // copies and hit the rate limiter. The fixed hub must stay at the two real
    // resources exposed by the stdio upstream.
    for (let sample = 0; sample < 10; sample += 1) {
      const current = (await client.listResources()).resources.map((resource) => resource.uri);
      expect(current).toHaveLength(2);
      expect(new Set(current).size).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(hub.logs()).not.toMatch(/Too Many Requests|status(?:Code)?[^\n]{0,30}429/i);
    expect(hub.logs()).not.toContain('Failed to send resource list changed notification');

    // resources/templates/list used to be the remaining live path back into
    // the self-connection: the cached resource lists were empty, but this
    // handler still asked the self-loop client, which routed the request back
    // through the same hub until the request budget was exhausted (472 handled
    // requests in the maintainer's reproduction). One downstream request must
    // be handled exactly once and return immediately.
    const templateRequestCount = () =>
      hub
        .logs()
        .split('\n')
        .filter((line) => line.includes('Handling ListResourceTemplatesRequest')).length;
    const beforeTemplateList = templateRequestCount();
    const startedAt = Date.now();
    const templates = await client.listResourceTemplates();
    const elapsed = Date.now() - startedAt;
    const handled = templateRequestCount() - beforeTemplateList;

    expect(templates.resourceTemplates).toEqual([]);
    expect(handled).toBe(1);
    expect(elapsed).toBeLessThan(5000);
  }, 60000);
});
