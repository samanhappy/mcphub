import { serverCostRevision } from '../../frontend/src/utils/costRevision';
import type { Server } from '../../frontend/src/types';

it('ignores polling metadata but detects same-count definition and exposure changes', () => {
  const server: Server = {
    name: 's',
    status: 'connected',
    tools: [{ name: 't', inputSchema: {} }],
  };
  const revision = serverCostRevision([server]);
  expect(serverCostRevision([{ ...server, recovery: { attempts: 2 } }])).toBe(revision);
  expect(serverCostRevision([{ ...server, enabled: false }])).not.toBe(revision);
  expect(
    serverCostRevision([{ ...server, tools: [{ name: 't', inputSchema: { type: 'object' } }] }]),
  ).not.toBe(revision);
  expect(serverCostRevision([{ ...server, status: 'disconnected' }])).not.toBe(revision);
});
