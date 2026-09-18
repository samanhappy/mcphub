import type { Server } from '../../frontend/src/types';
import {
  buildDuplicateServerName,
  buildDuplicateSource,
  carryOverCapabilityOverrides,
} from '../../frontend/src/utils/serverDuplicate';

const buildServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'weather',
  status: 'connected',
  config: {
    type: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
    env: { API_KEY: 'secret' },
    credentialTemplate: [{ key: 'API_KEY', label: 'API key', target: 'headers' }],
    visibility: 'group',
    sharedWithUsers: ['alice'],
    startOnDemand: true,
    perSessionClient: true,
    options: { timeout: 120000, resetTimeoutOnProgress: true },
    enableKeepAlive: true,
    keepAliveInterval: 30000,
  },
  ...overrides,
});

describe('buildDuplicateServerName', () => {
  it('suffixes the source name so the create validation can reject collisions', () => {
    expect(buildDuplicateServerName('weather')).toBe('weather-copy');
  });

  it('keeps the name within the length the name field enforces', () => {
    const longName = 'a'.repeat(128);

    const duplicateName = buildDuplicateServerName(longName);

    expect(duplicateName).toHaveLength(128);
    expect(duplicateName.endsWith('-copy')).toBe(true);
  });
});

describe('buildDuplicateSource', () => {
  it('pre-fills the new name and keeps the source configuration', () => {
    const source = buildServer();

    const duplicate = buildDuplicateSource(source);

    expect(duplicate.name).toBe('weather-copy');
    expect(duplicate.status).toBe('disconnected');
    expect(duplicate.config?.url).toBe('https://example.com/mcp');
    expect(duplicate.config?.headers).toEqual({ Authorization: 'Bearer token' });
    expect(duplicate.config?.env).toEqual({ API_KEY: 'secret' });
    expect(duplicate.config?.credentialTemplate).toEqual(source.config?.credentialTemplate);
    expect(duplicate.config?.visibility).toBe('group');
    expect(duplicate.config?.sharedWithUsers).toEqual(['alice']);
    expect(duplicate.config?.startOnDemand).toBe(true);
  });

  it('drops the source OAuth connection state but keeps its client configuration', () => {
    const source = buildServer({
      config: {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        oauth: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          scopes: ['read'],
          authorizationEndpoint: 'https://example.com/authorize',
          tokenEndpoint: 'https://example.com/token',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          pendingAuthorization: {
            authorizationUrl: 'https://example.com/authorize?state=1',
            state: '1',
            codeVerifier: 'verifier',
            createdAt: 1,
          },
        },
      },
    });

    const duplicate = buildDuplicateSource(source);

    expect(duplicate.config?.oauth).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scopes: ['read'],
      authorizationEndpoint: 'https://example.com/authorize',
      tokenEndpoint: 'https://example.com/token',
    });
    expect(duplicate.config?.oauth?.accessToken).toBeUndefined();
    expect(duplicate.config?.oauth?.refreshToken).toBeUndefined();
    expect(duplicate.config?.oauth?.pendingAuthorization).toBeUndefined();
  });

  it('does not mutate the source server', () => {
    const source = buildServer({
      config: {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        oauth: { clientId: 'client-id', accessToken: 'access-token' },
      },
    });

    buildDuplicateSource(source);

    expect(source.name).toBe('weather');
    expect(source.config?.oauth?.accessToken).toBe('access-token');
  });
});

describe('carryOverCapabilityOverrides', () => {
  const payload = { name: 'weather-copy', config: { type: 'streamable-http' as const } };

  it('re-keys prefixed tool and prompt overrides onto the new server name', () => {
    const source = buildServer({
      tools: [
        { name: 'weather-forecast', description: '', inputSchema: {} },
        { name: 'weather-current', description: '', inputSchema: {} },
      ],
      config: {
        type: 'streamable-http',
        tools: {
          'weather-forecast': { enabled: false },
          'weather-current': { enabled: true, description: 'Edited description' },
        },
        prompts: {
          'weather-summary': { enabled: false, description: 'Edited prompt' },
        },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source);

    expect(result.config.tools).toEqual({
      'weather-copy-forecast': { enabled: false },
      'weather-copy-current': { enabled: true, description: 'Edited description' },
    });
    expect(result.config.prompts).toEqual({
      'weather-copy-summary': { enabled: false, description: 'Edited prompt' },
    });
  });

  it('leaves stale prompt keys of a similarly named server alone', () => {
    // Renaming a server rewrites its record but not its override keys, so a
    // server called `db` can still carry `dbx-greet` from a previous `dbx`.
    const source = buildServer({
      name: 'db',
      config: {
        type: 'streamable-http',
        prompts: { 'dbx-greet': { enabled: false } },
      },
    });

    const result = carryOverCapabilityOverrides(
      { name: 'db-copy', config: { type: 'streamable-http' as const } },
      source,
    );

    expect(result.config.prompts).toEqual({ 'dbx-greet': { enabled: false } });
  });

  it('honours a custom name separator when re-keying prompts', () => {
    const source = buildServer({
      name: 'db',
      config: {
        type: 'streamable-http',
        prompts: {
          db_greet: { enabled: false },
          'db-greet': { enabled: true },
        },
      },
    });

    const result = carryOverCapabilityOverrides(
      { name: 'db-copy', config: { type: 'streamable-http' as const } },
      source,
      { nameSeparator: '_' },
    );

    expect(result.config.prompts).toEqual({
      'db-copy_greet': { enabled: false },
      'db-greet': { enabled: true },
    });
  });

  it('leaves bare tool override keys untouched', () => {
    const source = buildServer({
      // No runtime tool names, so `weather-issues` is a bare key rather than a
      // prefixed one even though it starts with the server name.
      tools: [],
      config: {
        type: 'streamable-http',
        tools: { 'weather-issues': { enabled: false } },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source);

    expect(result.config.tools).toEqual({ 'weather-issues': { enabled: false } });
  });

  it('copies resource overrides verbatim because they are keyed by URI', () => {
    const source = buildServer({
      config: {
        type: 'streamable-http',
        resources: { 'file:///readme': { enabled: false, description: 'Edited resource' } },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source);

    expect(result.config.resources).toEqual({
      'file:///readme': { enabled: false, description: 'Edited resource' },
    });
  });

  it('omits capability keys the source does not define', () => {
    const result = carryOverCapabilityOverrides(payload, buildServer());

    expect(result.config).toEqual({ type: 'streamable-http' });
  });
});
