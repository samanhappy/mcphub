import type { ServerInfo } from '../../src/types/index.js';
import {
  createRequestServerProjection,
  getRequestServers,
  withRequestServers,
} from '../../src/services/mcpRequestScope.js';

const server = (name: string): ServerInfo => ({
  name,
  status: 'connected',
  tools: [],
  prompts: [],
  resources: [],
  error: null,
  createTime: 0,
});

it('retains a parent authorization projection when replacing a personal runtime', () => {
  const allowed = server('allowed');
  const revoked = server('revoked');
  const personal = server('personal');
  const projected = { ...allowed, config: { tools: { run: { enabled: false } } } };
  withRequestServers([projected, personal], () => {
    const next = createRequestServerProjection([allowed, revoked, personal]);
    next.set('personal', { ...personal, principalUsername: 'alice' });
    withRequestServers([...next.values()], () => {
      expect(getRequestServers([]).map((info) => info.name)).toEqual(['allowed', 'personal']);
      expect(getRequestServers([])[0].config?.tools?.run.enabled).toBe(false);
      expect(getRequestServers([])[1].principalUsername).toBe('alice');
    });
  });
});

it('prevents nested scopes from reintroducing a removed server, including an empty parent', () => {
  const allowed = server('allowed');
  const revoked = server('revoked');
  for (const parent of [[allowed], []]) {
    withRequestServers(parent, () =>
      withRequestServers([allowed, revoked], () => {
        expect(getRequestServers([revoked])).toEqual(parent);
      }),
    );
  }
});

it('isolates concurrent asynchronous scopes and restores the caller scope', async () => {
  const alice = server('alice');
  const bob = server('bob');
  const fallback = [server('global')];
  await Promise.all(
    [alice, bob].map((info) =>
      withRequestServers([info], async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(getRequestServers(fallback)).toEqual([info]);
      }),
    ),
  );
  expect(getRequestServers(fallback)).toBe(fallback);
});
