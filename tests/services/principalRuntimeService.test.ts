import { PrincipalRuntimeService } from '../../src/services/principalRuntimeService.js';
import { credentialBindingEvents } from '../../src/services/credentialBindingService.js';
import type { ServerInfo, ServerConfigWithName } from '../../src/types/index.js';

const mockDefinition: ServerConfigWithName = {
  name: 'shared',
  type: 'stdio',
  owner: 'admin',
  visibility: 'public',
  credentialTemplate: [{ target: 'env', name: 'KEY' }],
};
let mockRevision = 'first';
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: () => ({ findById: async () => mockDefinition }),
}));
jest.mock('../../src/services/credentialBindingService.js', () => ({
  credentialBindingEvents: new (jest.requireActual('node:events').EventEmitter)(),
  resolveCredentialBinding: async () => ({ config: mockDefinition, revision: mockRevision }),
}));

const info = (): ServerInfo => ({
  name: 'shared',
  status: 'connected',
  tools: [],
  prompts: [],
  resources: [],
  error: null,
  createTime: Date.now(),
});
const alice = { username: 'alice@example.com' };
beforeEach(() => {
  mockRevision = 'first';
  mockDefinition.args = [];
});
afterEach(() => {
  credentialBindingEvents.removeAllListeners();
});

test('coalesces simultaneous creation and closes a pending child when a binding is changed', async () => {
  let connected!: (value: ServerInfo) => void;
  const connect = jest.fn(
    () =>
      new Promise<ServerInfo>((resolve) => {
        connected = resolve;
      }),
  );
  const close = jest.fn();
  const pool = new PrincipalRuntimeService(connect, close);
  const first = pool.acquire('shared', alice);
  const second = pool.acquire('shared', alice);
  const settled = Promise.allSettled([first, second]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(connect).toHaveBeenCalledTimes(1);
  mockRevision = 'rotated';
  credentialBindingEvents.emit('invalidate', { serverName: 'shared', username: alice.username });
  const child = info();
  connected(child);
  expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
  expect(close).toHaveBeenCalledWith(child);
  expect(close).toHaveBeenCalledTimes(1);
});

test('rechecks persistence after startup, including a change made by another process', async () => {
  const child = info();
  const close = jest.fn();
  const pool = new PrincipalRuntimeService(async () => {
    mockRevision = 'external-rotation';
    return child;
  }, close);
  await expect(pool.acquire('shared', alice)).rejects.toThrow('changed');
  expect(close).toHaveBeenCalledWith(child);
});

test('isolates users and never reuses a disconnected runtime', async () => {
  const connect = jest.fn(async () => info());
  const close = jest.fn();
  const pool = new PrincipalRuntimeService(connect, close);
  const [a, b] = await Promise.all([
    pool.acquire('shared', alice),
    pool.acquire('shared', { username: 'bob' }),
  ]);
  expect(a.info).not.toBe(b.info);
  a.info.status = 'disconnected';
  a.release();
  b.release();
  const next = await pool.acquire('shared', alice);
  expect(next.info).not.toBe(a.info);
  next.release();
  pool.invalidate();
});

test('reuses an unchanged runtime and replaces it after config or persisted binding changes', async () => {
  const connect = jest.fn(async () => info());
  const close = jest.fn();
  const pool = new PrincipalRuntimeService(connect, close);
  const first = await pool.acquire('shared', alice);
  first.release();
  const same = await pool.acquire('shared', alice);
  expect(same.info).toBe(first.info);
  same.release();

  mockDefinition.args!.push('--updated');
  const changedConfig = await pool.acquire('shared', alice);
  expect(changedConfig.info).not.toBe(first.info);
  expect(close).toHaveBeenCalledWith(first.info);
  changedConfig.release();

  mockRevision = 'external-rotation';
  const changedBinding = await pool.acquire('shared', alice);
  expect(changedBinding.info).not.toBe(changedConfig.info);
  expect(close).toHaveBeenCalledWith(changedConfig.info);
  expect(connect).toHaveBeenCalledTimes(3);
  changedBinding.release();
  pool.invalidate();
});

test('rejects a config mutated during startup against the original snapshot', async () => {
  const child = info();
  const close = jest.fn();
  const pool = new PrincipalRuntimeService(async () => {
    mockDefinition.args!.push('--changed-during-connect');
    return child;
  }, close);
  await expect(pool.acquire('shared', alice)).rejects.toThrow('changed');
  expect(close).toHaveBeenCalledWith(child);
  pool.invalidate();
});
