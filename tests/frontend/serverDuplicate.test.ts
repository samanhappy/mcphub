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

  it('keeps a bare upstream tool name verbatim when it collides with the source prefix', () => {
    // Source `db` / separator `-` / runtime name `db-db-query`: the upstream
    // tool is really called `db-query`, and the execution-time lookup falls
    // back to `config.tools['db-query']`. Keep the bare key verbatim - the
    // copy's lookups only consult `db-copy-db-query` and the bare `db-query`,
    // so renaming it to `db-copy-query` would produce a key nothing reads.
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

    expect(result.config.tools).toEqual({ 'db-query': { enabled: false } });
  });

  it('keeps a bare key verbatim even when prefixing it yields a known runtime name', () => {
    // Regression: source `weather` / runtime `weather-beta` / bare key `beta`.
    // Prefixing `beta` with `weather-` yields the runtime name `weather-beta`,
    // but `beta` does not itself start with the source prefix - renaming it
    // produced the dead key `weather-copy` (`rename('beta')` =
    // `'weather-copy' + 'beta'.slice(7)`). The copy's lookups consult
    // `weather-copy-beta` and the bare `beta`, so `beta` must stay verbatim.
    const source = buildServer({
      tools: [{ name: 'weather-beta', description: '', inputSchema: { type: 'object' } }],
      config: {
        type: 'streamable-http',
        tools: {
          beta: { enabled: false },
        },
      },
    });

    const result = carryOverCapabilityOverrides(payload, source);

    expect(result.config.tools).toEqual({ beta: { enabled: false } });
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
  // Pure-function contract for the B1 guard wired in
  // frontend/src/pages/ServersPage.tsx:104-143: each accepted click tags its
  // request with an id from a monotonically increasing counter that is never
  // reset (`++duplicateRequestId.current`), and the decision is consulted
  // TWICE per response - once before committing the prefill and once in the
  // `finally` that clears the busy indicator. The three cases below pin the
  // invariants that wiring depends on, via a small timeline simulation
  // (clicks auto-increment the id; each response compares its id against the
  // latest). The repo has no jsdom/@testing-library, so the component-layer
  // wiring cannot be unit-tested; the invariants are fixed here as a
  // pure-function contract instead (no new test dependencies introduced).

  const startDuplicateTimeline = () => {
    let latestRequestId = 0; // mirrors duplicateRequestId.current: never reset
    const click = () => ++latestRequestId; // an accepted click tags its request
    // The two consultations ServersPage makes per response: the commit check
    // before `setDuplicateServer` and the busy-clear check in the `finally`.
    const decide = (requestId: number) => ({
      commitCheck: resolveDuplicateResponse(requestId, latestRequestId),
      busyClearCheck: resolveDuplicateResponse(requestId, latestRequestId),
    });
    return { click, decide, latestRequestId: () => latestRequestId };
  };

  it('emits strictly increasing ids and commits the winning request at both checks', () => {
    const timeline = startDuplicateTimeline();
    const first = timeline.click();
    const second = timeline.click(); // supersedes `first`
    const third = timeline.click(); // supersedes `second`; counter never resets

    expect([first, second, third]).toEqual([1, 2, 3]); // monotonic, never reset
    expect(timeline.latestRequestId()).toBe(third);

    const decision = timeline.decide(third);
    expect(decision.commitCheck).toBe('commit'); // prefill committed
    expect(decision.busyClearCheck).toBe('commit'); // busy indicator cleared
  });

  it('marks a superseded request stale at both checks so it touches no state', () => {
    const timeline = startDuplicateTimeline();
    const superseded = timeline.click();
    const winner = timeline.click(); // supersedes `superseded`

    const decision = timeline.decide(superseded);

    expect(decision.commitCheck).toBe('stale'); // no setDuplicateServer
    expect(decision.busyClearCheck).toBe('stale'); // no early setDuplicatingServer(null)
  });

  it('still commits the newest request after repeated supersessions', () => {
    const timeline = startDuplicateTimeline();
    const ids = [timeline.click(), timeline.click(), timeline.click()];

    for (const id of ids.slice(0, -1)) {
      expect(timeline.decide(id).commitCheck).toBe('stale');
      expect(timeline.decide(id).busyClearCheck).toBe('stale');
    }

    const winner = ids[ids.length - 1];
    const decision = timeline.decide(winner);
    expect(decision.commitCheck).toBe('commit');
    expect(decision.busyClearCheck).toBe('commit');
  });
});
