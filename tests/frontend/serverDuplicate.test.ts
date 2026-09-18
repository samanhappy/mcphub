import type { Server } from '../../frontend/src/types';
import {
  buildDuplicateServerName,
  buildDuplicateSource,
  carryOverCapabilityOverrides,
  resolveDuplicateResponse,
} from '../../frontend/src/utils/serverDuplicate';

const buildServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'weather',
  status: 'connected',
  config: {
    type: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
    env: { API_KEY: 'secret' },
    credentialTemplate: [{ target: 'headers', name: 'API_KEY', label: 'API key' }],
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
        { name: 'weather-forecast', description: '', inputSchema: { type: 'object' } },
        { name: 'weather-current', description: '', inputSchema: { type: 'object' } },
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
      // A key that does not carry the `<source><separator>` prefix is a bare
      // key; the execution-time lookup falls back to it, so it stays verbatim.
      tools: [],
      config: {
        type: 'streamable-http',
        tools: { issues: { enabled: false } },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source);

    expect(result.config.tools).toEqual({ issues: { enabled: false } });
  });

  it('keeps and renames a bare upstream name that collides with the source prefix', () => {
    // Source `db` / separator `-` / runtime name `db-db-query`: the upstream
    // tool is really called `db-query`, and the execution-time lookup falls
    // back to `config.tools['db-query']`. The copy must not drop it as stale.
    const source = buildServer({
      name: 'db',
      tools: [{ name: 'db-db-query', description: '', inputSchema: { type: 'object' } }],
      config: {
        type: 'streamable-http',
        tools: {
          'db-query': { enabled: false },
        },
      },
    });

    const result = carryOverCapabilityOverrides(
      { name: 'db-copy', config: { type: 'streamable-http' as const } },
      source,
    );

    expect(result.config.tools).toEqual({ 'db-copy-query': { enabled: false } });
  });

  it('drops a genuinely stale prefixed tool key that matches no runtime name or bare name', () => {
    const source = buildServer({
      name: 'db',
      tools: [{ name: 'db-db-query', description: '', inputSchema: { type: 'object' } }],
      config: {
        type: 'streamable-http',
        tools: {
          'db-stale-x': { enabled: false },
        },
      },
    });

    const result = carryOverCapabilityOverrides(
      { name: 'db-copy', config: { type: 'streamable-http' as const } },
      source,
    );

    expect(result.config.tools).toBeUndefined();
  });

  it('drops stale prefixed tool keys when the source is disconnected but keeps bare keys', () => {
    // A disconnected source has no discovered tools, so `weather-alpha` in
    // `config.tools` cannot match a runtime name; it is a stale prefixed key
    // (e.g. left over from a rename) and would never resolve on the copy.
    const source = buildServer({
      tools: [],
      config: {
        type: 'streamable-http',
        tools: {
          'weather-alpha': { enabled: false },
          beta: { enabled: true, description: 'Bare key' },
        },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source);

    expect(result.config.tools).toEqual({ beta: { enabled: true, description: 'Bare key' } });
    expect(result.config.tools).not.toHaveProperty('weather-copy-alpha');
    expect(result.config.tools).not.toHaveProperty('weather-alpha');
  });

  it('uses the configured separator to decide which stale tool keys to drop', () => {
    const source = buildServer({
      tools: [],
      config: {
        type: 'streamable-http',
        tools: {
          weather_alpha: { enabled: false },
          'weather-alpha': { enabled: true },
        },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source, { nameSeparator: '_' });

    expect(result.config.tools).toEqual({ 'weather-alpha': { enabled: true } });
    expect(result.config.tools).not.toHaveProperty('weather_alpha');
  });

  it('still re-keys known runtime tool names onto the copy when the source is connected', () => {
    const source = buildServer({
      tools: [{ name: 'weather-alpha', description: '', inputSchema: { type: 'object' } }],
      config: {
        type: 'streamable-http',
        tools: {
          'weather-alpha': { enabled: false },
          beta: { enabled: true },
        },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source);

    expect(result.config.tools).toEqual({
      'weather-copy-alpha': { enabled: false },
      beta: { enabled: true },
    });
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

describe('resolveDuplicateResponse', () => {
  // B1 guard for the Duplicate interleave race: each accepted click tags its
  // request with a monotonically increasing id, and the caller keeps the latest
  // id in a counter that is never reset. A response commits only while its id
  // is still the latest; a superseded response is 'stale' and is dropped.

  it('commits a request that is still the latest (single click)', () => {
    // One click -> one request id, which is the latest.
    expect(resolveDuplicateResponse(1, 1)).toBe('commit');
  });

  it('marks a superseded request as stale (dropped)', () => {
    // Click A (id 1), then click B (id 2). A is superseded.
    expect(resolveDuplicateResponse(1, 2)).toBe('stale');
  });

  it('commits the later winning request after a superseded one', () => {
    // After A (id 1) is superseded by B (id 2), B is the latest and commits.
    expect(resolveDuplicateResponse(2, 2)).toBe('commit');
  });

  it('keeps the monotonic latest id stable so the same id yields the same decision twice', () => {
    // The caller checks the SAME (requestId, latestRequestId) pair twice: once
    // to decide whether to commit the prefill, and again in the `finally` to
    // decide whether to clear the busy indicator. Because the latest id is a
    // monotonic counter that is never reset, the winning request sees the same
    // pair in both checks and gets the same 'commit' result, so the busy
    // indicator is always cleared on the winning path.
    const latestRequestId = 3;
    const requestId = 3; // the winning request

    const commitCheck = resolveDuplicateResponse(requestId, latestRequestId);
    const busyClearCheck = resolveDuplicateResponse(requestId, latestRequestId);

    expect(commitCheck).toBe('commit');
    expect(busyClearCheck).toBe('commit');
    expect(commitCheck).toBe(busyClearCheck);
  });

  it('never clears busy early for a superseded request', () => {
    // A (id 1) is superseded by B (id 2). A's busy-clear check must NOT commit,
    // so it cannot erase B's in-flight spinner.
    expect(resolveDuplicateResponse(1, 2)).toBe('stale');
    // B's own busy-clear check still commits.
    expect(resolveDuplicateResponse(2, 2)).toBe('commit');
  });
});
