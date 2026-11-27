import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/embeddingSyncScheduler.js', () => ({
  enqueueServerCleanup: jest.fn().mockResolvedValue(undefined),
  enqueueServerSync: jest.fn(),
  enqueueSingleToolSync: jest.fn(),
  enqueueToolRemoval: jest.fn(),
}));

jest.mock('../../src/services/credentialBindingService.js', () => {
  const actual = jest.requireActual('../../src/services/credentialBindingService.js');
  return {
    ...actual,
    deleteCredentialBindings: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn(),
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

const mockServerDao = {
  findById: jest.fn(),
  delete: jest.fn().mockResolvedValue(true),
};

const mockUserDao = {
  findByUsername: jest.fn().mockResolvedValue(null),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn().mockResolvedValue({}) })),
  getUserDao: jest.fn(() => mockUserDao),
  getBuiltinPromptDao: jest.fn(() => ({ findEnabled: jest.fn(), findByName: jest.fn() })),
  getBuiltinResourceDao: jest.fn(() => ({ findEnabled: jest.fn() })),
}));

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((val: string) => val),
  replaceEnvVars: jest.fn((val: any) => val),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import { closeServerRuntime } from '../../src/services/mcpConnectionLifecycle.js';
import {
  cleanupAllProxychainsConfigs,
  cleanupAllServers,
  cleanupProxychainsConfigPath,
  connectClientWithDiagnostics,
  createTransportFromConfig,
  deleteMcpServer,
  generateProxychainsConfig,
  setIsolatedClientForTest,
} from '../../src/services/mcpService.js';

const createProxychainsStubOnPath = (): { dir: string; restorePath: () => void } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-proxychains-bin-'));
  const binPath = path.join(dir, 'proxychains4');
  fs.writeFileSync(binPath, '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = previousPath ? `${dir}${path.delimiter}${previousPath}` : dir;
  return {
    dir,
    restorePath: () => {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
};

const getGeneratedConfigPathFromTransport = (transport: unknown): string => {
  const args = (transport as { _serverParams?: { args?: string[] } })?._serverParams?.args;
  if (!Array.isArray(args) || args[0] !== '-f' || typeof args[1] !== 'string') {
    throw new Error(`Expected proxychains -f <configPath> args, got: ${JSON.stringify(args)}`);
  }
  return args[1];
};

const baseProxyServerConfig = {
  type: 'stdio' as const,
  command: 'node',
  args: ['-e', 'setTimeout(() => {}, 1000)'],
  proxy: {
    enabled: true,
    type: 'socks5' as const,
    host: '203.0.113.10',
    port: 1080,
    username: 'proxy_user',
    password: 'proxy_pass',
  },
};

describe('mcpService proxychains temporary config lifecycle', () => {
  const cleanupCallbacks: Array<() => void> = [];
  const customDirs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.delete.mockResolvedValue(true);
    mockUserDao.findByUsername.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const restore of cleanupCallbacks.splice(0)) {
      restore();
    }
    cleanupAllProxychainsConfigs();
    for (const dir of customDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes generated proxychains config into a 0o700 dir with 0o600 permissions and unpredictable names', () => {
    const firstPath = generateProxychainsConfig('proxy-server', {
      enabled: true,
      type: 'socks5',
      host: '203.0.113.10',
      port: 1080,
      username: 'proxy_user',
      password: 'proxy_pass',
    });
    const secondPath = generateProxychainsConfig('proxy-server', {
      enabled: true,
      type: 'socks5',
      host: '203.0.113.10',
      port: 1080,
      username: 'proxy_user',
      password: 'proxy_pass',
    });

    expect(firstPath).not.toBeNull();
    expect(secondPath).not.toBeNull();
    expect(firstPath).not.toBe(secondPath);

    const dir = path.dirname(firstPath!);
    expect(path.dirname(dir)).toBe(os.tmpdir());
    expect(path.basename(dir)).toMatch(/^mcphub-proxychains-/);
    expect(dir).not.toBe(path.join(os.tmpdir(), 'mcphub-proxychains'));

    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(firstPath!).mode & 0o777).toBe(0o600);
    expect(fs.statSync(secondPath!).mode & 0o777).toBe(0o600);

    const content = fs.readFileSync(firstPath!, 'utf-8');
    expect(content).toContain('socks5 203.0.113.10 1080 proxy_user proxy_pass');
  });

  it('isolates concurrent transports for the same server and cleans up only the closed or failed transport config', async () => {
    const stub = createProxychainsStubOnPath();
    cleanupCallbacks.push(stub.restorePath);

    const transport1 = await createTransportFromConfig('shared-server', baseProxyServerConfig);
    const transport2 = await createTransportFromConfig('shared-server', baseProxyServerConfig);

    const path1 = getGeneratedConfigPathFromTransport(transport1);
    const path2 = getGeneratedConfigPathFromTransport(transport2);
    expect(path1).not.toBe(path2);
    expect(fs.existsSync(path1)).toBe(true);
    expect(fs.existsSync(path2)).toBe(true);

    const dir = path.dirname(path1);
    const beforeFailFiles = new Set(fs.readdirSync(dir));

    await expect(
      createTransportFromConfig('shared-server', {
        ...baseProxyServerConfig,
        options: { maxBufferSize: -1 },
      }),
    ).rejects.toThrow();

    // Failed transport creation must clean up its own file while keeping sibling transports intact.
    expect(fs.readdirSync(dir).sort()).toEqual([...beforeFailFiles].sort());
    expect(fs.existsSync(path1)).toBe(true);
    expect(fs.existsSync(path2)).toBe(true);

    await transport1.close();
    expect(fs.existsSync(path1)).toBe(false);
    expect(fs.existsSync(path2)).toBe(true);

    await transport2.close();
    expect(fs.existsSync(path2)).toBe(false);
  });

  it('cleans up generated config during closeServerRuntime (on-demand shutdown / runtime eviction)', async () => {
    const stub = createProxychainsStubOnPath();
    cleanupCallbacks.push(stub.restorePath);

    const transport = await createTransportFromConfig('ondemand-server', baseProxyServerConfig);
    const configPath = getGeneratedConfigPathFromTransport(transport);
    expect(fs.existsSync(configPath)).toBe(true);

    const serverInfo: any = {
      name: 'ondemand-server',
      status: 'connected',
      tools: [],
      prompts: [],
      resources: [],
      createTime: Date.now(),
      enabled: true,
      transport,
      client: { close: jest.fn() },
    };

    closeServerRuntime(serverInfo);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('cleans up generated config during isolated session teardown', async () => {
    const stub = createProxychainsStubOnPath();
    cleanupCallbacks.push(stub.restorePath);

    const transport = await createTransportFromConfig('isolated-server', baseProxyServerConfig);
    const configPath = getGeneratedConfigPathFromTransport(transport);
    expect(fs.existsSync(configPath)).toBe(true);

    setIsolatedClientForTest('session-1', 'isolated-server', {
      client: { close: jest.fn() } as any,
      transport,
    });
    deleteMcpServer('session-1');

    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('cleans up generated config on failed handshake without affecting sibling concurrent transports', async () => {
    const stub = createProxychainsStubOnPath();
    cleanupCallbacks.push(stub.restorePath);

    const healthyTransport = await createTransportFromConfig('concurrent-server', baseProxyServerConfig);
    const failingTransport = await createTransportFromConfig('concurrent-server', baseProxyServerConfig);

    const healthyPath = getGeneratedConfigPathFromTransport(healthyTransport);
    const failingPath = getGeneratedConfigPathFromTransport(failingTransport);
    expect(fs.existsSync(healthyPath)).toBe(true);
    expect(fs.existsSync(failingPath)).toBe(true);

    const mockClient = {
      connect: jest.fn().mockRejectedValue(new Error('handshake failed')),
    } as any;

    await expect(connectClientWithDiagnostics(mockClient, failingTransport)).rejects.toThrow(
      'handshake failed',
    );

    expect(fs.existsSync(failingPath)).toBe(false);
    expect(fs.existsSync(healthyPath)).toBe(true);

    await healthyTransport.close();
    expect(fs.existsSync(healthyPath)).toBe(false);
  });

  it('makes cleanup idempotent and retains failed deletions for retry', async () => {
    const stub = createProxychainsStubOnPath();
    cleanupCallbacks.push(stub.restorePath);

    const transport = await createTransportFromConfig('retry-server', baseProxyServerConfig);
    const configPath = getGeneratedConfigPathFromTransport(transport);
    const tempDir = path.dirname(configPath);
    expect(fs.existsSync(configPath)).toBe(true);

    const originalUnlinkSync = fs.unlinkSync.bind(fs);
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      const err = new Error('resource busy') as NodeJS.ErrnoException;
      err.code = 'EBUSY';
      throw err;
    });

    await transport.close();
    expect(unlinkSpy).toHaveBeenCalled();
    expect(fs.existsSync(configPath)).toBe(true);

    unlinkSpy.mockImplementation(originalUnlinkSync);

    // Retry via cleanupProxychainsConfigPath succeeds and repeated calls stay idempotent.
    expect(cleanupProxychainsConfigPath(configPath)).toBe(true);
    expect(fs.existsSync(configPath)).toBe(false);

    await expect(transport.close()).resolves.toBeUndefined();
    expect(cleanupProxychainsConfigPath(configPath)).toBe(true);

    cleanupAllServers();
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('removes generated config files and temp directory on cleanupAllServers', () => {
    const configPath = generateProxychainsConfig('server-b', {
      enabled: true,
      type: 'http',
      host: '203.0.113.11',
      port: 8080,
    });

    expect(configPath).not.toBeNull();
    const tempDir = path.dirname(configPath!);
    expect(fs.existsSync(configPath!)).toBe(true);
    expect(fs.existsSync(tempDir)).toBe(true);

    cleanupAllServers();
    expect(fs.existsSync(configPath!)).toBe(false);
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('preserves user-supplied custom configPath without deleting it during cleanup', () => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-custom-proxy-'));
    customDirs.push(customDir);
    const customPath = path.join(customDir, 'custom.conf');
    fs.writeFileSync(customPath, '[ProxyList]\nsocks5 127.0.0.1 9050\n', 'utf-8');

    const returnedPath = generateProxychainsConfig('custom-server', {
      enabled: true,
      configPath: customPath,
    });

    expect(returnedPath).toBe(customPath);

    expect(cleanupProxychainsConfigPath(customPath)).toBe(true);
    cleanupAllServers();

    expect(fs.existsSync(customPath)).toBe(true);
  });
});
