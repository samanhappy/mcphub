jest.mock('openid-client', () => ({}));
jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  removeToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: () => ({ logToolCall: jest.fn() }),
}));
jest.mock('../../src/services/toolResultCompressionService.js', () => ({
  maybeCompressToolResult: (result: unknown) => result,
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernTransport,
} from '@modelcontextprotocol/client';
import { Client } from '@modelcontextprotocol/sdk-v1/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk-v1/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk-v1/client/sse.js';
import {
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
} from '@modelcontextprotocol/sdk-v1/types.js';
import type { ClientCapabilities, ElicitResult } from '@modelcontextprotocol/sdk-v1/types.js';
import { clearSettingsCache, getNameSeparator } from '../../src/config/index.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import { mcpConnectionRateLimiter } from '../../src/utils/rateLimit.js';
import {
  cleanupAllServers,
  getServerByName,
  initializeClientsFromSettings,
} from '../../src/services/mcpService.js';
import {
  handleMcpOtherRequest,
  handleMcpPostRequest,
  handleSseConnection,
  handleSseMessage,
  transports,
} from '../../src/services/sseService.js';
import type { McpSettings } from '../../src/types/index.js';

const clients: { close(): Promise<void> }[] = [];
let server: HttpServer;
let baseUrl: string;
let directory: string;
const originalPath = process.env.MCPHUB_SETTING_PATH;
const originalDb = process.env.USE_DB;

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-elicitation-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  const upstream = {
    type: 'stdio' as const,
    command: process.execPath,
    args: [path.resolve('tests/fixtures/elicitation-server.mjs')],
    owner: 'admin',
    visibility: 'public' as const,
    options: { timeout: 1500 },
  };
  const settings: McpSettings = {
    mcpServers: { isolated: { ...upstream, perSessionClient: true }, shared: upstream },
    bearerKeys: [
      {
        id: 'test',
        name: 'test',
        token: 'elicitation-test',
        kind: 'system',
        enabled: true,
        accessType: 'all',
        createdAt: new Date().toISOString(),
      },
    ],
    systemConfig: {
      routing: { enableGlobalRoute: true, enableGroupNameRoute: true, enableBearerAuth: true },
      oauthServer: { enabled: false },
    },
  };
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH, JSON.stringify(settings));
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
  await initializeClientsFromSettings(true);
  const deadline = Date.now() + 10000;
  while (
    ['isolated', 'shared'].some((name) => getServerByName(name)?.tools.length !== 2) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(getServerByName('isolated')?.tools).toHaveLength(2);
  expect(getServerByName('shared')?.tools).toHaveLength(2);
  const app = express();
  app.use('/mcp', express.json());
  const routes = ['/mcp', '/mcp/:group'];
  app.post(routes, mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpPostRequest);
  app.get(routes, mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpOtherRequest);
  app.delete(routes, mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpOtherRequest);
  app.get('/sse', mcpConnectionRateLimiter, sseUserContextMiddleware, handleSseConnection);
  app.post('/messages', mcpConnectionRateLimiter, sseUserContextMiddleware, handleSseMessage);
  server = await new Promise<HttpServer>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 15000);

afterAll(async () => {
  for (const client of clients) await client.close();
  for (const entry of Object.values(transports)) await entry.transport.close();
  cleanupAllServers();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
  else process.env.MCPHUB_SETTING_PATH = originalPath;
  if (originalDb === undefined) delete process.env.USE_DB;
  else process.env.USE_DB = originalDb;
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

const connect = async (elicitation?: ClientCapabilities['elicitation'], route = '') => {
  const client = new Client(
    { name: 'elicitation-e2e', version: '1' },
    { capabilities: elicitation ? { elicitation } : {} },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp${route}`), {
      requestInit: { headers: { Authorization: 'Bearer elicitation-test' } },
    }),
  );
  return client;
};

const call = (
  client: Client,
  name = 'ask',
  args: Record<string, unknown> = {},
  serverName = 'isolated',
) => client.callTool({ name: `${serverName}${getNameSeparator()}${name}`, arguments: args });
const read = (result: Awaited<ReturnType<typeof call>>) => {
  const content = result.content as { type: string; text: string }[];
  expect(result.isError).not.toBe(true);
  return JSON.parse(content[0].text);
};

test.each(['accept', 'decline', 'cancel'] as const)(
  'forwards form response %s unchanged',
  async (action) => {
    const client = await connect({});
    const response: ElicitResult =
      action === 'accept' ? { action, content: { choice: 'yes' } } : { action };
    const handler = jest.fn(async () => response);
    client.setRequestHandler(ElicitRequestSchema, handler);
    expect(read(await call(client))).toEqual(response);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ message: 'Your choice' }) }),
      expect.anything(),
    );
  },
);

test('negotiates only the session client modes and keeps shared upstreams unadvertised', async () => {
  const none = await connect();
  const form = await connect({});
  const url = await connect({ url: {} });
  expect(read(await call(none, 'capabilities')).elicitation).toBeUndefined();
  expect(read(await call(form, 'capabilities')).elicitation).toEqual({ form: {} });
  expect(read(await call(url, 'capabilities')).elicitation).toEqual({ url: {} });
  expect(read(await call(form, 'capabilities', {}, 'shared')).elicitation).toBeUndefined();
  const handler = jest.fn();
  form.setRequestHandler(ElicitRequestSchema, handler);
  expect((await call(form, 'ask', { mode: 'url' })).isError).toBe(true);
  expect(handler).not.toHaveBeenCalled();
});

test('isolates simultaneous clients and serializes calls within one session', async () => {
  const alice = await connect({ form: {} });
  const bob = await connect({ form: {} });
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const aliceMessages: string[] = [];
  alice.setRequestHandler(ElicitRequestSchema, async (request) => {
    aliceMessages.push(request.params.message);
    if (request.params.message === 'first') {
      started();
      await waiting;
    }
    return { action: 'accept', content: { choice: `alice:${request.params.message}` } };
  });
  bob.setRequestHandler(ElicitRequestSchema, async (request) => ({
    action: 'accept',
    content: { choice: `bob:${request.params.message}` },
  }));
  const first = call(alice, 'ask', { message: 'first' });
  await ready;
  const second = call(alice, 'ask', { message: 'second' });
  expect(read(await call(bob, 'ask', { message: 'bob' })).content.choice).toBe('bob:bob');
  expect(aliceMessages).toEqual(['first']);
  release();
  expect(read(await first).content.choice).toBe('alice:first');
  expect(read(await second).content.choice).toBe('alice:second');
});

test('forwards URL requests and completion only to the owning session', async () => {
  const owner = await connect({ url: {} });
  const other = await connect({ url: {} });
  const foreignNotification = jest.fn();
  other.setNotificationHandler(ElicitationCompleteNotificationSchema, foreignNotification);
  let completed!: (value: string) => void;
  const completion = new Promise<string>((resolve) => {
    completed = resolve;
  });
  owner.setNotificationHandler(ElicitationCompleteNotificationSchema, (notification) =>
    completed(notification.params.elicitationId),
  );
  owner.setRequestHandler(ElicitRequestSchema, async (request) => {
    expect(request.params).toMatchObject({ mode: 'url', url: 'https://example.com/authorize' });
    return { action: 'accept' };
  });
  expect(read(await call(owner, 'ask', { mode: 'url', message: 'url-flow' }))).toEqual({
    action: 'accept',
  });
  expect(await completion).toBe('url-flow');
  expect(foreignNotification).not.toHaveBeenCalled();
});

test('replaces a timed-out upstream instead of routing its late elicitation to the next call', async () => {
  const client = await connect({ form: {} });
  client.setRequestHandler(
    ElicitRequestSchema,
    (_request, extra) =>
      new Promise((_resolve, reject) => {
        extra.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        });
      }),
  );
  expect((await call(client)).isError).toBe(true);
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'decline' }));
  expect(read(await call(client))).toEqual({ action: 'decline' });
});

test('forwards through the smart call_tool path', async () => {
  const client = await connect({ form: {} }, '/$smart');
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'cancel' }));
  expect(
    read(
      await client.callTool({
        name: 'call_tool',
        arguments: { toolName: `isolated${getNameSeparator()}ask`, arguments: {} },
      }),
    ),
  ).toEqual({ action: 'cancel' });
});

test('does not advertise elicitation to upstreams for modern stateless clients', async () => {
  const client = new ModernClient(
    { name: 'modern-elicitation', version: '1' },
    { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: 'auto' } },
  );
  clients.push(client);
  await client.connect(
    new ModernTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: { Authorization: 'Bearer elicitation-test', 'X-MCPHub-State-Id': randomUUID() },
      },
    }),
  );
  const result = await client.callTool({ name: `isolated${getNameSeparator()}capabilities` });
  expect(JSON.parse((result.content as { text: string }[])[0].text).elicitation).toBeUndefined();
});

test('cancels a pending elicitation when the initiating call is cancelled', async () => {
  const client = await connect({ form: {} });
  const wire = client.transport!;
  const receive = wire.onmessage!;
  let elicitationId: string | number | undefined;
  let cancelled!: (id: string | number) => void;
  const cancellation = new Promise<string | number>((resolve) => {
    cancelled = resolve;
  });
  wire.onmessage = (message, extra) => {
    if ('method' in message && message.method === 'elicitation/create' && 'id' in message)
      elicitationId = message.id;
    if ('method' in message && message.method === 'notifications/cancelled')
      cancelled(message.params!.requestId as string | number);
    receive(message, extra);
  };
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish!: (response: ElicitResult) => void;
  client.setRequestHandler(
    ElicitRequestSchema,
    () =>
      new Promise((resolve) => {
        finish = resolve;
        started();
      }),
  );
  const abort = new AbortController();
  const pending = client.callTool({ name: `isolated${getNameSeparator()}ask` }, undefined, {
    signal: abort.signal,
  });
  const rejection = expect(pending).rejects.toThrow();
  await ready;
  abort.abort();
  await rejection;
  expect(await cancellation).toBe(elicitationId);
  // The independent v1 client ignores request ID 0 cancellation; settle its UI
  // handler explicitly after asserting the actual cancellation on the wire.
  finish({ action: 'cancel' });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'cancel' }));
  expect(read(await call(client))).toEqual({ action: 'cancel' });
});

test('cleans up a pending elicitation when the downstream session is terminated', async () => {
  const client = await connect({ form: {} });
  let started!: () => void;
  let cancelled!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cancellation = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  client.setRequestHandler(
    ElicitRequestSchema,
    (_request, extra) =>
      new Promise((_resolve, reject) => {
        extra.signal.addEventListener(
          'abort',
          () => {
            cancelled();
            reject(new Error('session closed'));
          },
          { once: true },
        );
        started();
      }),
  );
  const pending = call(client).catch(() => undefined);
  await ready;
  const transport = client.transport as StreamableHTTPClientTransport;
  const sessionId = transport.sessionId!;
  await transport.terminateSession();
  await client.close();
  await pending;
  await cancellation;
  expect(transports[sessionId]).toBeUndefined();
});

test('does not log elicitation response bodies', async () => {
  const client = await connect({ form: {} });
  const logs = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    client.setRequestHandler(ElicitRequestSchema, async () => ({
      action: 'accept',
      content: { choice: 'private-elicitation-answer' },
    }));
    expect(read(await call(client)).content.choice).toBe('private-elicitation-answer');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private-elicitation-answer');
  } finally {
    logs.mockRestore();
  }
});

test('forwards over the legacy SSE transport', async () => {
  const client = new Client(
    { name: 'sse-elicitation', version: '1' },
    { capabilities: { elicitation: {} } },
  );
  clients.push(client);
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'decline' }));
  await client.connect(
    new SSEClientTransport(new URL(`${baseUrl}/sse`), {
      requestInit: { headers: { Authorization: 'Bearer elicitation-test' } },
      eventSourceInit: {
        fetch: (input, init) =>
          fetch(input, { ...init, headers: { Authorization: 'Bearer elicitation-test' } }),
      },
    }),
  );
  expect(read(await call(client))).toEqual({ action: 'decline' });
});
