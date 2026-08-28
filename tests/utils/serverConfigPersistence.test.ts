import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';

describe('normalizeServerConfigForPersistence', () => {
  it('keeps remote keep-alive checks disabled by default', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    });

    expect(normalized).toMatchObject({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: false,
    });
    expect(normalized).toHaveProperty('keepAliveInterval', undefined);
  });

  it('preserves explicitly enabled remote keep-alive checks', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: true,
    });

    expect(normalized).toMatchObject({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      enableKeepAlive: true,
      keepAliveInterval: 60000,
    });
  });

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

  it('preserves an explicitly enabled per-session client', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      perSessionClient: true,
    });

    expect(normalized).toHaveProperty('perSessionClient', true);
  });

  it('keeps per-session client present (not merely absent) so unchecking it clears the stored value', () => {
    // The dashboard drops the key from the JSON payload when unchecked, so the
    // incoming config has no `perSessionClient`. Normalization must still emit an
    // explicit key — otherwise the DAO update treats it as "unchanged" and a
    // previously-enabled server can never be turned off.
    const normalized = normalizeServerConfigForPersistence({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
    });

    expect(Object.prototype.hasOwnProperty.call(normalized, 'perSessionClient')).toBe(true);
    expect(normalized).toHaveProperty('perSessionClient', undefined);
  });

  it('preserves an explicitly enabled start on demand', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      startOnDemand: true,
    });

    expect(normalized).toHaveProperty('startOnDemand', true);
  });

  it('normalizes explicit user sharing for group visibility', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      visibility: 'group',
      sharedWithUsers: [' alice ', 'bob', 'alice', ''],
    });

    expect(normalized.sharedWithUsers).toEqual(['alice', 'bob']);
  });

  it('clears explicit user sharing outside group visibility', () => {
    const normalized = normalizeServerConfigForPersistence({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      visibility: 'private',
      sharedWithUsers: ['alice'],
    });

    expect(normalized).toHaveProperty('sharedWithUsers', undefined);
  });

  it('keeps start on demand present (not merely absent) so unchecking it clears the stored value', () => {
    // The dashboard drops the key from the JSON payload when unchecked
    // (JSON.stringify strips `undefined`), so the incoming config has no
    // `startOnDemand`. Normalization must still emit an explicit key - otherwise
    // the DAO update's shallow merge ({...existing, ...updates}) treats it as
    // "unchanged" and a previously-enabled on-demand server can never be turned
    // off: the toggle would keep reading enabled after save. See #1032.
    const normalized = normalizeServerConfigForPersistence({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
    });

    expect(Object.prototype.hasOwnProperty.call(normalized, 'startOnDemand')).toBe(true);
    expect(normalized).toHaveProperty('startOnDemand', undefined);
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

  it('keeps the specSecurity credential slot through openapi normalization (#1079)', () => {
    const specSecurity = {
      type: 'http' as const,
      http: { scheme: 'basic' as const, credentials: 'admin:s3cret' },
    };
    const normalized = normalizeServerConfigForPersistence({
      type: 'openapi',
      openapi: {
        url: 'https://example.com/v3/api-docs',
        security: { type: 'http', http: { scheme: 'bearer', credentials: 'api-token' } },
        specSecurity,
      },
    });

    expect(normalized.openapi?.specSecurity).toEqual(specSecurity);
  });
});
