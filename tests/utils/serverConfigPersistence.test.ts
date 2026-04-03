import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';

describe('normalizeServerConfigForPersistence', () => {
  it('clears empty remote collections while preserving explicit field presence for DB/JSON persistence', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'sse',
      description: '',
      url: ' https://example.com/sse ',
      env: {},
      headers: {},
      passthroughHeaders: [],
      oauth: {},
      options: {},
      enableKeepAlive: false,
      keepAliveInterval: 60000,
    });

    expect(normalized).toMatchObject({
      type: 'sse',
      url: 'https://example.com/sse',
      enableKeepAlive: false,
    });
    expect(normalized).toHaveProperty('description', undefined);
    expect(normalized).toHaveProperty('env', undefined);
    expect(normalized).toHaveProperty('headers', undefined);
    expect(normalized).toHaveProperty('passthroughHeaders', undefined);
    expect(normalized).toHaveProperty('oauth', undefined);
    expect(normalized).toHaveProperty('options', undefined);
    expect(normalized).toHaveProperty('keepAliveInterval', undefined);
  });

  it('clears stale remote fields when switching to stdio', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'stdio',
      description: ' local ',
      url: 'https://example.com/sse',
      command: ' npx ',
      args: ['-y', 'demo-server'],
      env: {},
      headers: {
        Authorization: 'Bearer token',
      },
      passthroughHeaders: ['Authorization'],
      oauth: {
        clientId: 'client-id',
      },
      openapi: {
        version: '3.1.0',
        url: 'https://example.com/openapi.json',
      },
      enableKeepAlive: true,
      keepAliveInterval: 15000,
    });

    expect(normalized).toMatchObject({
      type: 'stdio',
      description: 'local',
      command: 'npx',
      args: ['-y', 'demo-server'],
    });
    expect(normalized).toHaveProperty('url', undefined);
    expect(normalized).toHaveProperty('headers', undefined);
    expect(normalized).toHaveProperty('passthroughHeaders', undefined);
    expect(normalized).toHaveProperty('oauth', undefined);
    expect(normalized).toHaveProperty('openapi', undefined);
    expect(normalized).toHaveProperty('enableKeepAlive', undefined);
    expect(normalized).toHaveProperty('keepAliveInterval', undefined);
  });

  it('normalizes openapi payloads and trims empty values', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'openapi',
      headers: {},
      url: 'https://example.com/old-sse',
      openapi: {
        version: ' 3.1.0 ',
        url: ' ',
        passthroughHeaders: [],
      },
      command: 'npx',
      args: ['-y'],
      env: {
        ' API_KEY ': 'value',
      },
    });

    expect(normalized.type).toBe('openapi');
    expect(normalized).toHaveProperty('url', undefined);
    expect(normalized).toHaveProperty('command', undefined);
    expect(normalized).toHaveProperty('args', undefined);
    expect(normalized).toHaveProperty('env', undefined);
    expect(normalized).toHaveProperty('headers', undefined);
    expect(normalized.openapi).toEqual({
      version: '3.1.0',
    });
  });
});