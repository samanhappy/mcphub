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

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn() })),
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

import {
  cleanupAllProxychainsConfigs,
  cleanupAllServers,
  cleanupProxychainsConfig,
  generateProxychainsConfig,
  removeServer,
} from '../../src/services/mcpService.js';

describe('mcpService proxychains temporary config lifecycle', () => {
  const customDirs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.delete.mockResolvedValue(true);
  });

  afterEach(() => {
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
      username: 'secret_user',
      password: 'secret_password',
    });
    const secondPath = generateProxychainsConfig('proxy-server', {
      enabled: true,
      type: 'socks5',
      host: '203.0.113.10',
      port: 1080,
      username: 'secret_user',
      password: 'secret_password',
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
    expect(content).toContain('socks5 203.0.113.10 1080 secret_user secret_password');
  });

  it('removes generated config files via cleanupProxychainsConfig', () => {
    const configPath = generateProxychainsConfig('server-a', {
      enabled: true,
      type: 'socks5',
      host: '203.0.113.10',
      port: 1080,
      username: 'u',
      password: 'p',
    });

    expect(configPath).not.toBeNull();
    expect(fs.existsSync(configPath!)).toBe(true);

    cleanupProxychainsConfig('server-a');
    expect(fs.existsSync(configPath!)).toBe(false);
  });

  it('removes generated config files when removeServer is called', async () => {
    const configPath = generateProxychainsConfig('proxy-remove-server', {
      enabled: true,
      type: 'socks5',
      host: '203.0.113.10',
      port: 1080,
      username: 'proxy_user',
      password: 'proxy_pass',
    });

    expect(configPath).not.toBeNull();
    expect(fs.existsSync(configPath!)).toBe(true);

    const result = await removeServer('proxy-remove-server');
    expect(result.success).toBe(true);
    expect(fs.existsSync(configPath!)).toBe(false);
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

    cleanupProxychainsConfig('custom-server');
    cleanupAllServers();

    expect(fs.existsSync(customPath)).toBe(true);
  });
});
