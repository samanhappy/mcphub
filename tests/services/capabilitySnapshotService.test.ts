import type { CapabilitySnapshot, ServerConfig, ServerInfo } from '../../src/types/index.js';
const mockRows = new Map<string, CapabilitySnapshot>();
// Stands in for the process environment a trusted server inherits.
const mockInherited: Record<string, string> = {};
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCapabilitySnapshotDao: () => ({
    get: async (name: string, principal: string) =>
      mockRows.get(JSON.stringify([name, principal])) ?? null,
    save: async (row: CapabilitySnapshot) => {
      mockRows.set(JSON.stringify([row.serverName, row.principal]), structuredClone(row));
    },
  }),
}));
jest.mock('../../src/services/serverConfigEnvironment.js', () => ({
  getServerEnvironment: async (config: ServerConfig) => ({ ...mockInherited, ...config.env }),
  resolveStdioPath: () => mockInherited.PATH ?? '',
}));
import {
  prepareCapabilitySnapshot,
  recordCapabilitySnapshot,
  flushCapabilitySnapshot,
} from '../../src/services/capabilitySnapshotService.js';
const config: ServerConfig = {
  type: 'stdio',
  command: 'node',
  args: ['server.js'],
  startOnDemand: true,
  env: { KEY: 'secret' },
};
const tool = { name: 'ping', inputSchema: { type: 'object' as const }, _meta: { custom: 'kept' } };
const info = (): ServerInfo => ({
  name: 'demo',
  status: 'disconnected',
  tools: [],
  prompts: [],
  resources: [],
  error: null,
  createTime: Date.now(),
});
beforeEach(() => {
  mockRows.clear();
  for (const key of Object.keys(mockInherited)) delete mockInherited[key];
  Object.assign(mockInherited, { PATH: '/bin', HOSTNAME: 'container-a' });
});

test.each([{ discovered: [tool] }, { discovered: [] }])(
  'restores successful raw discovery including empty tools: $discovered',
  async ({ discovered }) => {
    const first = info();
    expect(await prepareCapabilitySnapshot(first, config)).toBeUndefined();
    expect(first.capabilityCache?.state).toBe('missing');
    recordCapabilitySnapshot(first, discovered);
    await flushCapabilitySnapshot(first);
    const restarted = info();
    expect(await prepareCapabilitySnapshot(restarted, config)).toEqual(discovered);
    expect(restarted.capabilityCache).toEqual({ state: 'fresh', capturedAt: expect.any(String) });
    expect(JSON.stringify([...mockRows.values()])).not.toContain('secret');
  },
);

test('invalidates changed launch configuration but reapplies projection without invalidation', async () => {
  const first = info();
  await prepareCapabilitySnapshot(first, config);
  recordCapabilitySnapshot(first, [tool]);
  await flushCapabilitySnapshot(first);
  expect(
    await prepareCapabilitySnapshot(info(), {
      ...config,
      tools: { ping: { enabled: false } },
      description: 'new',
      visibility: 'private',
    }),
  ).toEqual([tool]);
  for (const changed of [
    { args: ['other.js'] },
    { env: { KEY: 'rotated' } },
    { command: 'other' },
  ]) {
    const next = info();
    expect(await prepareCapabilitySnapshot(next, { ...config, ...changed })).toBeUndefined();
    expect(next.capabilityCache?.state).toBe('stale');
  }
});

test('isolates credential principals, binding revisions, and shared discovery', async () => {
  const first = info();
  const alice = { username: 'alice', revision: 'one' };
  await prepareCapabilitySnapshot(first, config, alice);
  recordCapabilitySnapshot(first, [tool]);
  await flushCapabilitySnapshot(first);
  expect(await prepareCapabilitySnapshot(info(), config, alice)).toEqual([tool]);
  expect(await prepareCapabilitySnapshot(info(), config)).toBeUndefined();
  expect(
    await prepareCapabilitySnapshot(info(), config, { username: 'bob', revision: 'one' }),
  ).toBeUndefined();
  const rotated = info();
  expect(
    await prepareCapabilitySnapshot(rotated, config, { ...alice, revision: 'two' }),
  ).toBeUndefined();
  expect(rotated.capabilityCache?.state).toBe('stale');
});

test('refresh replaces removed tools and rejects malformed snapshots without publishing them', async () => {
  const first = info();
  await prepareCapabilitySnapshot(first, config);
  recordCapabilitySnapshot(first, [tool]);
  recordCapabilitySnapshot(first, []);
  await flushCapabilitySnapshot(first);
  expect(await prepareCapabilitySnapshot(info(), config)).toEqual([]);
  mockRows.get('["demo",""]')!.tools = [{ name: 'invalid' } as never];
  expect(await prepareCapabilitySnapshot(info(), config)).toBeUndefined();
});

const snapshotThenRecreate = async (server: ServerConfig, hostname = 'container-b') => {
  const first = info();
  await prepareCapabilitySnapshot(first, server);
  recordCapabilitySnapshot(first, [tool]);
  await flushCapabilitySnapshot(first);
  mockInherited.HOSTNAME = hostname;
  const recreated = info();
  return { tools: await prepareCapabilitySnapshot(recreated, server), recreated };
};

test('ignores the inherited HOSTNAME that changes on every container recreate', async () => {
  const { tools, recreated } = await snapshotThenRecreate(config);
  expect(tools).toEqual([tool]);
  expect(recreated.capabilityCache?.state).toBe('fresh');
});

test('still invalidates on other inherited environment changes', async () => {
  const first = info();
  await prepareCapabilitySnapshot(first, config);
  recordCapabilitySnapshot(first, [tool]);
  await flushCapabilitySnapshot(first);
  mockInherited.PATH = '/usr/bin';
  const next = info();
  expect(await prepareCapabilitySnapshot(next, config)).toBeUndefined();
  expect(next.capabilityCache?.state).toBe('stale');
});

test.each([
  ['an unexpanded ${HOSTNAME} reference', { args: ['server.js', '--host=${HOSTNAME}'] }],
  ['an unexpanded $HOSTNAME reference', { env: { ...config.env, NODE_NAME: '$HOSTNAME' } }],
  ['a $HOSTNAME reference followed by lowercase', { args: ['--id=$HOSTNAMEsuffix'] }],
])('keeps HOSTNAME in the fingerprint for %s', async (_label, changed) => {
  const { tools, recreated } = await snapshotThenRecreate({ ...config, ...changed });
  expect(tools).toBeUndefined();
  expect(recreated.capabilityCache?.state).toBe('stale');
});

test('an explicit env.HOSTNAME survives a recreate but invalidates when it changes', async () => {
  const pinned = { ...config, env: { ...config.env, HOSTNAME: 'pinned' } };
  expect((await snapshotThenRecreate(pinned)).tools).toEqual([tool]);
  const next = info();
  expect(
    await prepareCapabilitySnapshot(next, { ...config, env: { ...config.env, HOSTNAME: 'moved' } }),
  ).toBeUndefined();
  expect(next.capabilityCache?.state).toBe('stale');
});

test('does not treat a longer variable name as a HOSTNAME reference', async () => {
  const { tools } = await snapshotThenRecreate({
    ...config,
    args: ['--a=${HOSTNAME_ALIAS}', '--b=$HOSTNAME_ALIAS'],
  });
  expect(tools).toEqual([tool]);
});

test('invalidates when an expanded HOSTNAME reference changes the launch configuration', async () => {
  const first = info();
  await prepareCapabilitySnapshot(first, { ...config, args: ['--host=container-a'] });
  recordCapabilitySnapshot(first, [tool]);
  await flushCapabilitySnapshot(first);
  mockInherited.HOSTNAME = 'container-b';
  const recreated = info();
  expect(
    await prepareCapabilitySnapshot(recreated, { ...config, args: ['--host=container-b'] }),
  ).toBeUndefined();
  expect(recreated.capabilityCache?.state).toBe('stale');
});
