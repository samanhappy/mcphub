import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FileStagingSettings, ServerConfig, ServerInfo } from '../../../types/index.js';
import { FileStagingStateStore } from '../stateStore.js';
import { dispatchStagedToolCall } from '../dispatch.js';

const OWNER = 'a'.repeat(64);
const SERVER_ID = '0f1d3d3c-1111-4111-8111-111111111111';

let store: FileStagingStateStore;
let currentConfig: ServerConfig;

const settings: FileStagingSettings = {
  enabled: true,
  maxFileBytes: 4096,
  inlineMaxBytes: 1024,
  perUserQuotaBytes: 65536,
  globalQuotaBytes: 262144,
  ttlHours: 1,
  downloadTtlSeconds: 300,
  maxFilesPerUser: 10,
  cleanupIntervalMinutes: 15,
};

jest.mock('../../../dao/index.js', () => ({
  getServerDao: () => ({ findById: async () => currentConfig }),
}));

jest.mock('../settings.js', () => ({
  getFileStagingSettings: jest.fn(async () => settings),
  getStagingStateStore: jest.fn(async () => store),
}));

jest.mock('../identity.js', () => ({
  resolveStagingPrincipal: jest.fn(async (username: string) => ({
    username,
    ownerHash: 'a'.repeat(64),
  })),
  resolveOwnerPrincipal: jest.fn(async () => ({ username: 'admin', ownerHash: 'a'.repeat(64) })),
}));

const serverInfo = (): ServerInfo =>
  ({
    name: 'ssh',
    version: '1.11.0',
    status: 'connected',
    tools: [{ name: 'ssh-upload', description: '', inputSchema: {} }],
    prompts: [],
    resources: [],
    createTime: Date.now(),
    error: null,
    config: currentConfig,
  }) as unknown as ServerInfo;

const input = () => ({
  principal: { ownerHash: OWNER },
  serverId: SERVER_ID,
  serverName: 'ssh',
  settings,
  filename: 'f.txt',
});

describe('staging dispatch seam', () => {
  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-dispatch-'));
    store = new FileStagingStateStore({
      rootDir: path.join(base, 'staging'),
      stateDir: path.join(base, 'state'),
      disableLock: true,
    });
    await store.init();
    currentConfig = {
      id: SERVER_ID,
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--host', 'h'],
      visibility: 'private',
      owner: 'admin',
      staging: { adapter: 'ssh' },
      tools: {
        upload: {
          enabled: true,
          fileStaging: {
            enabled: true,
            inputParams: ['localPath'],
            outputParams: ['remotePath'],
          },
        },
      },
    };
  });

  afterEach(async () => {
    const rootDir = (store as unknown as { rootDir: string }).rootDir;
    await fs.rm(path.dirname(rootDir), { recursive: true, force: true });
  });

  it('rewrites a declared input ref to its absolute content path', async () => {
    const ready = await store.createReadyRef(input(), Buffer.from('payload'));
    const invoke = jest.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    const result = await dispatchStagedToolCall(
      serverInfo(),
      { name: 'ssh-upload', arguments: { localPath: ready.ref, remote: '/tmp/a' } },
      invoke,
      'alice',
    );
    expect(result.isError).toBeUndefined();
    const passed = invoke.mock.calls[0][0].arguments;
    expect(passed.localPath).not.toContain('mcpfile://');
    expect(passed.localPath.endsWith('/content')).toBe(true);
    expect(passed.remote).toBe('/tmp/a');
  });

  it('finalizes a declared output after the child writes it', async () => {
    const reserved = await store.createReservedRef(input());
    const invoke = jest.fn(async (params: any) => {
      await fs.writeFile(params.arguments.remotePath, 'written');
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    const result = await dispatchStagedToolCall(
      serverInfo(),
      { name: 'ssh-upload', arguments: { remotePath: reserved.ref } },
      invoke,
      'alice',
    );
    expect(result.isError).toBeUndefined();
    await expect(store.getOwnedRef(reserved.ref, OWNER)).resolves.toMatchObject({
      state: 'ready',
      size: 7,
    });
  });

  it('fails the output and returns a tool error when the child reports failure', async () => {
    const reserved = await store.createReservedRef(input());
    const result = await dispatchStagedToolCall(
      serverInfo(),
      { name: 'ssh-upload', arguments: { remotePath: reserved.ref } },
      async () => ({ isError: true, content: [] }),
      'alice',
    );
    expect(result.isError).toBe(true);
    await expect(store.getOwnedRef(reserved.ref, OWNER)).resolves.toMatchObject({
      state: 'failed',
    });
  });

  it('lets exactly one of two concurrent calls reach upstream for the same output ref', async () => {
    const reserved = await store.createReservedRef(input());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const invoke = jest.fn(async (params: any) => {
      started();
      await gate;
      await fs.writeFile(params.arguments.remotePath, 'first');
      return { content: [{ type: 'text', text: 'ok' }] };
    });

    const first = dispatchStagedToolCall(
      serverInfo(),
      { name: 'ssh-upload', arguments: { remotePath: reserved.ref } },
      invoke,
      'alice',
    );
    await entered;
    const second = await dispatchStagedToolCall(
      serverInfo(),
      { name: 'ssh-upload', arguments: { remotePath: reserved.ref } },
      invoke,
      'alice',
    );
    expect(second.isError).toBe(true);
    expect(second.content[0].text).toBe('Output destination is busy');
    release();
    const firstResult = await first;
    expect(firstResult.isError).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    await expect(store.getOwnedRef(reserved.ref, OWNER)).resolves.toMatchObject({
      state: 'ready',
      version: 1,
    });
  });

  it('rejects a ref to a non-staging tool and a ref from another server', async () => {
    const reserved = await store.createReservedRef(input());
    const otherTool = await dispatchStagedToolCall(
      { ...serverInfo(), tools: [{ name: 'ssh-read', description: '', inputSchema: {} }] } as ServerInfo,
      { name: 'ssh-read', arguments: { localPath: reserved.ref } },
      async () => ({ content: [] }),
      'alice',
    );
    expect(otherTool.isError).toBe(true);
    expect(otherTool.content[0].text).toMatch(/not allowed/i);

    currentConfig = { ...currentConfig, tools: currentConfig.tools };
    const foreign = await store.createReservedRef({ ...input(), serverId: 'another-server' });
    const wrongServer = await dispatchStagedToolCall(
      serverInfo(),
      { name: 'ssh-upload', arguments: { remotePath: foreign.ref } },
      async () => ({ content: [] }),
      'alice',
    );
    expect(wrongServer.isError).toBe(true);
    expect(wrongServer.content[0].text).toBe('Staging reference not found');
  });

  it('refuses a staging reference when staging is globally disabled', async () => {
    const ready = await store.createReadyRef(input(), Buffer.from('x'));
    const settingsModule = await import('../settings.js');
    (settingsModule.getFileStagingSettings as jest.Mock).mockResolvedValueOnce({
      ...settings,
      enabled: false,
    });
    const result = await dispatchStagedToolCall(
      serverInfo(),
      { name: 'ssh-upload', arguments: { localPath: ready.ref } },
      async () => ({ content: [] }),
      'alice',
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not allowed/i);
  });
});
