// Regression tests for #1094: template import must enforce the same
// privileged-config policy as createServer/updateServer so a non-admin
// cannot import a stdio server config (arbitrary command execution).

const mockServerDao = { findAll: jest.fn(), findById: jest.fn() };
const mockGroupDao = { findAll: jest.fn(), findById: jest.fn(), findByName: jest.fn() };

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: () => mockServerDao,
  getGroupDao: () => mockGroupDao,
}));

jest.mock('../../src/services/groupService.js', () => ({
  createGroup: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  addServer: jest.fn(),
}));

import { importTemplate } from '../../src/services/templateService.js';
import { addServer } from '../../src/services/mcpService.js';

const alice = { username: 'alice', password: 'x', isAdmin: false };
const admin = { username: 'admin', password: 'x', isAdmin: true };

const templateWith = (servers: Record<string, unknown>) => ({
  version: '1.0',
  name: 'T',
  createdAt: new Date().toISOString(),
  servers,
  groups: [],
  requiredEnvVars: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockServerDao.findAll.mockResolvedValue([]);
  mockGroupDao.findByName.mockResolvedValue(null);
});

describe('template import privileged-config policy (#1094)', () => {
  it('non-admin import of a stdio server is rejected before persistence', async () => {
    const result = await importTemplate(
      templateWith({ evil: { type: 'stdio', command: 'touch', args: ['/tmp/pwned'] } }),
      'alice',
      alice,
    );

    expect(result.success).toBe(false);
    expect(result.serversCreated).toBe(0);
    expect(result.details).toEqual([
      {
        type: 'server',
        name: 'evil',
        action: 'failed',
        message: 'Only admins can import stdio-based server configurations',
      },
    ]);
    expect(addServer).not.toHaveBeenCalled();
  });

  it('non-admin import of a command-carrying config without stdio type is rejected too', async () => {
    const result = await importTemplate(
      templateWith({ sneaky: { command: 'sh', args: ['-c', 'id'] } }),
      'alice',
      alice,
    );

    expect(result.serversCreated).toBe(0);
    expect(addServer).not.toHaveBeenCalled();
  });

  it('non-admin import of a remote server still succeeds', async () => {
    const result = await importTemplate(
      templateWith({ remote: { type: 'sse', url: 'http://example.com/sse' } }),
      'alice',
      alice,
    );

    expect(result.success).toBe(true);
    expect(result.serversCreated).toBe(1);
    expect(addServer).toHaveBeenCalledWith(
      'remote',
      expect.objectContaining({ type: 'sse', url: 'http://example.com/sse', owner: 'alice' }),
    );
  });

  it('non-admin mixed template rejects only the privileged server', async () => {
    const result = await importTemplate(
      templateWith({
        bad: { type: 'stdio', command: 'touch', args: ['/tmp/pwned'] },
        good: { type: 'sse', url: 'http://example.com/sse' },
      }),
      'alice',
      alice,
    );

    expect(result.serversCreated).toBe(1);
    expect(result.details.find((d) => d.name === 'bad')?.action).toBe('failed');
    expect(result.details.find((d) => d.name === 'good')?.action).toBe('created');
    expect(addServer).toHaveBeenCalledTimes(1);
    expect(addServer).toHaveBeenCalledWith('good', expect.anything());
  });

  it('admin can still import stdio servers', async () => {
    const result = await importTemplate(
      templateWith({ local: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-server'] } }),
      'admin',
      admin,
    );

    expect(result.success).toBe(true);
    expect(addServer).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({ command: 'npx', owner: 'admin' }),
    );
  });

  it('no requestingUser keeps the legacy unrestricted behavior (system callers)', async () => {
    const result = await importTemplate(
      templateWith({ local: { type: 'stdio', command: 'npx' } }),
      'admin',
    );

    expect(result.success).toBe(true);
    expect(addServer).toHaveBeenCalledWith('local', expect.objectContaining({ command: 'npx' }));
  });
});

describe('template import server-name charset validation', () => {
  it('rejects servers whose names do not match the MCP tool-name charset', async () => {
    const result = await importTemplate(
      templateWith({
        'bad server': { type: 'sse', url: 'http://example.com/sse' },
        'io.github.user/weather': { type: 'sse', url: 'http://example.com/sse' },
        good: { type: 'sse', url: 'http://example.com/sse' },
      }),
      'admin',
      admin,
    );

    expect(result.serversCreated).toBe(1);
    expect(result.details.find((d) => d.name === 'bad server')?.action).toBe('failed');
    expect(result.details.find((d) => d.name === 'io.github.user/weather')?.action).toBe('failed');
    expect(result.details.find((d) => d.name === 'good')?.action).toBe('created');
    expect(addServer).toHaveBeenCalledTimes(1);
    expect(addServer).toHaveBeenCalledWith(
      'good',
      expect.objectContaining({ type: 'sse', url: 'http://example.com/sse' }),
    );
  });
});
