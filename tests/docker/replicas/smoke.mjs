import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const composeArgs = ['compose', '-f', 'tests/docker/replicas/compose.yml'];
const compose = async (...args) => (await exec('docker', [...composeArgs, ...args])).stdout.trim();
const endpoint = async (service, port) => `http://${await compose('port', service, String(port))}`;
let a = await endpoint('hub-a', 3000);
let b = await endpoint('hub-b', 3000);
const proxy = await endpoint('proxy', 80);
const upstreamCount = async () =>
  JSON.parse(
    await compose(
      'exec',
      '-T',
      'upstream',
      'node',
      '-e',
      "fetch('http://localhost:4000/count').then(r=>r.text()).then(console.log)",
    ),
  ).executions;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (action, description) => {
  let last;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await wait(250);
  }
  throw new Error(`Timed out: ${description}`, { cause: last });
};
const call = async (base, path, body, token, headers = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token
        ? path.startsWith('/api')
          ? { 'x-auth-token': token }
          : { Authorization: `Bearer ${token}` }
        : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, headers: response.headers, data };
};
const check = async (description, action) => {
  await action();
  console.log(`PASS ${description}`);
};
const login = await call(a, '/api/auth/login', {
  username: 'admin',
  password: 'replica-test-password',
});
assert.equal(login.status, 200, JSON.stringify(login.data));
const jwt = login.data.token;
const key = await call(
  a,
  '/api/auth/keys',
  { name: 'smoke', kind: 'system', accessType: 'all' },
  jwt,
);
assert.equal(key.status, 201, JSON.stringify(key.data));
const token = key.data.data.token;
assert.ok(token);
const mcp = (base, method, name, bearer = token, extraHeaders = {}) =>
  call(
    base,
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...(name ? { name, arguments: {} } : {}),
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'replica-smoke', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
    bearer,
    {
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': method,
      ...(name ? { 'Mcp-Name': name } : {}),
      ...extraHeaders,
    },
  );
const rpc = (response) => {
  if (typeof response.data !== 'string') return response.data;
  const events = response.data.split('\n').filter((line) => line.startsWith('data:'));
  return JSON.parse(events.at(-1).slice(5));
};
const assertToolSuccess = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.ok(rpc(response).result && !rpc(response).result.isError, JSON.stringify(response.data));
};

await check('shared JWT and configuration converge on both nodes', async () => {
  assert.equal((await call(b, '/api/auth/user', undefined, jwt)).status, 200);
  const created = await call(
    a,
    '/api/servers',
    {
      name: 'fixture',
      config: {
        type: 'openapi',
        visibility: 'public',
        openapi: { url: 'http://upstream:4000/schema' },
      },
    },
    jwt,
  );
  assert.equal(created.status, 200, JSON.stringify(created.data));
  for (const node of [a, b])
    await until(async () => {
      const listed = rpc(await mcp(node, 'tools/list'));
      return listed.result?.tools?.some((tool) => tool.name === 'fixture-echo');
    }, 'remote tool discovery');
  assertToolSuccess(await mcp(a, 'tools/call', 'fixture-echo'));
  assertToolSuccess(await mcp(b, 'tools/call', 'fixture-echo'));
  const rest = await fetch(`${b}/api/tools/call/fixture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolName: 'echo', arguments: {} }),
  });
  assert.equal(rest.status, 200, await rest.text());
});

await check('concurrent writes with a stale version return 412', async () => {
  const version = (await call(a, '/api/servers', undefined, jwt)).headers.get(
    'x-mcphub-config-version',
  );
  const update = (node) =>
    fetch(`${node}/api/servers/fixture/toggle`, {
      method: 'POST',
      headers: {
        'x-auth-token': jwt,
        'Content-Type': 'application/json',
        'If-Match': `"${version}"`,
      },
      body: JSON.stringify({ enabled: false }),
    });
  const statuses = await Promise.all([a, b].map(async (node) => (await update(node)).status));
  assert.deepEqual(statuses.sort(), [200, 412]);
  assert.equal((await call(a, '/api/servers/fixture/toggle', { enabled: true }, jwt)).status, 200);
  await until(
    async () =>
      (rpc(await mcp(b, 'tools/list')).result?.tools || []).some(
        (tool) => tool.name === 'fixture-echo',
      ),
    'restore after conflict',
  );
});

await check('disable and key revocation apply on the other node before polling', async () => {
  const before = await upstreamCount();
  assert.equal((await call(a, '/api/servers/fixture/toggle', { enabled: false }, jwt)).status, 200);
  const denied = await mcp(b, 'tools/call', 'fixture-echo');
  assert.ok(rpc(denied).error || rpc(denied).result?.isError);
  assert.equal(await upstreamCount(), before);
  assert.equal((await call(a, '/api/servers/fixture/toggle', { enabled: true }, jwt)).status, 200);
  await until(
    async () =>
      (rpc(await mcp(b, 'tools/list')).result?.tools || []).some(
        (tool) => tool.name === 'fixture-echo',
      ),
    're-enable',
  );
  const other = (
    await call(a, '/api/auth/keys', { name: 'revoked', kind: 'system', accessType: 'all' }, jwt)
  ).data.data;
  assertToolSuccess(await mcp(b, 'tools/call', 'fixture-echo', other.token));
  const response = await fetch(`${a}/api/auth/keys/${other.id}`, {
    method: 'DELETE',
    headers: { 'x-auth-token': jwt },
  });
  assert.equal(response.status, 200);
  assert.equal((await mcp(b, 'tools/call', 'fixture-echo', other.token)).status, 401);
});

await check(
  'OAuth registration on A, management and code exchange on B, one-time redemption',
  async () => {
    const registration = await call(a, '/oauth/register', {
      client_name: 'replica-smoke',
      redirect_uris: ['http://localhost/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    assert.equal(registration.status, 201, JSON.stringify(registration.data));
    const client = registration.data;
    assert.equal(
      (
        await call(
          b,
          `/oauth/register/${client.client_id}`,
          undefined,
          client.registration_access_token,
        )
      ).status,
      200,
    );
    const verifier = 'a'.repeat(64);
    const authorization = await call(a, '/oauth/authorize', {
      allow: 'true',
      client_id: client.client_id,
      redirect_uri: 'http://localhost/callback',
      response_type: 'code',
      scope: 'read',
      token: jwt,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    assert.equal(authorization.status, 302, JSON.stringify(authorization.data));
    const code = new URL(authorization.headers.get('location')).searchParams.get('code');
    const exchange = (node) =>
      fetch(`${node}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: client.client_id,
          redirect_uri: 'http://localhost/callback',
          code,
          code_verifier: verifier,
        }),
      });
    const results = await Promise.all([exchange(b), exchange(a)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  },
);

await check('stateful traffic stays on one node using a stable affinity header', async () => {
  const affinity = randomUUID();
  const nodes = [];
  for (let i = 0; i < 5; i++) {
    const response = await mcp(proxy, 'tools/list', undefined, token, {
      'X-MCPHub-Affinity': affinity,
    });
    assert.equal(response.status, 200);
    nodes.push(response.headers.get('x-mcphub-node-id'));
  }
  assert.equal(new Set(nodes).size, 1);
});

await check('independent processes refresh one rotating credential only once', async () => {
  const created = await call(a, '/api/servers', {
    name: 'refresh-fixture', config: {
      type: 'streamable-http', url: 'http://upstream:4000/unused', enabled: false,
      oauth: { clientId: 'fixture-client', scopes: [], accessToken: 'old-access', refreshToken: 'refresh-0' },
    },
  }, jwt);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  await Promise.all(['hub-a', 'hub-b'].map((node) =>
    compose('exec', '-T', node, 'node', 'tests/docker/replicas/refresh-worker.mjs')));
  const stats = JSON.parse(await compose('exec', '-T', 'upstream', 'node', '-e',
    "fetch('http://localhost:4000/count').then(r=>r.text()).then(console.log)"));
  assert.equal(stats.refreshes, 1);
});

await check(
  'legacy sessions remain local and require reinitialization on another node',
  async () => {
    const headers = {
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
      'X-MCPHub-Affinity': randomUUID(),
    };
    const initialized = await call(
      proxy,
      '/mcp',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'legacy-smoke', version: '1' },
        },
      },
      token,
      headers,
    );
    assert.equal(initialized.status, 200, JSON.stringify(initialized.data));
    const session = initialized.headers.get('mcp-session-id');
    assert.ok(session);
    headers['Mcp-Session-Id'] = session;
    const body = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const listed = await call(proxy, '/mcp', body, token, headers);
    assert.equal(listed.status, 200);
    assert.equal(
      listed.headers.get('x-mcphub-node-id'),
      initialized.headers.get('x-mcphub-node-id'),
    );
    const other = initialized.headers.get('x-mcphub-node-id') === 'a' ? b : a;
    assert.equal((await call(other, '/mcp', body, token, headers)).status, 404);
  },
);

await check('an upstream connection drop executes once without automatic replay', async () => {
  const before = await upstreamCount();
  const response = await mcp(proxy, 'tools/call', 'fixture-drop');
  assert.ok(rpc(response).error || rpc(response).result?.isError);
  assert.equal(await upstreamCount(), before + 1);
});

await check(
  'database loss fails readiness and invocation while liveness stays healthy',
  async () => {
    await compose('stop', 'postgres');
    try {
      for (const node of [a, b]) {
        assert.equal((await call(node, '/livez')).status, 200);
        assert.equal((await call(node, '/readyz')).status, 503);
      }
      const before = await upstreamCount();
      const failed = await mcp(b, 'tools/call', 'fixture-echo');
      assert.ok(failed.status >= 400 || rpc(failed).error || rpc(failed).result?.isError);
      assert.equal(await upstreamCount(), before);
    } finally {
      await compose('start', 'postgres');
    }
    await until(async () => (await call(b, '/readyz')).status === 200, 'database recovery');
  },
);

await check('new requests reach B after A is killed; A can rejoin', async () => {
  await compose('kill', '-s', 'SIGKILL', 'hub-a');
  await until(async () => {
    const response = await mcp(proxy, 'tools/call', 'fixture-echo');
    return (
      response.status === 200 &&
      !rpc(response).result?.isError &&
      response.headers.get('x-mcphub-node-id') === 'b'
    );
  }, 'failover to B');
  await compose('start', 'hub-a');
  a = await endpoint('hub-a', 3000);
  await until(async () => (await call(a, '/readyz')).status === 200, 'A rejoins');
});

await check(
  'shutdown drains an in-flight call before closing its upstream; rolling restart converges',
  async () => {
    const before = await upstreamCount();
    const running = mcp(b, 'tools/call', 'fixture-slow');
    await until(async () => (await upstreamCount()) > before, 'slow tool started');
    const stopping = compose('stop', '--timeout', '15', 'hub-b');
    assertToolSuccess(await running);
    await stopping;
    await compose('start', 'hub-b');
    b = await endpoint('hub-b', 3000);
    await until(async () => (await call(b, '/readyz')).status === 200, 'B rejoins');
    const first = (await call(a, '/api/cluster', undefined, jwt)).data.data;
    const second = (await call(b, '/api/cluster', undefined, jwt)).data.data;
    assert.equal(first.appliedVersion, second.appliedVersion);
  },
);
console.log('All Docker replica checks passed.');
