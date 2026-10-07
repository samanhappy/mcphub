import { canServeToolRequests } from '../../src/utils/serverAvailability.js';

const server = (fields: Record<string, unknown>) => ({ name: 's', tools: [], ...fields }) as any;

describe('canServeToolRequests', () => {
  it('accepts a connected server and an idle on-demand one', () => {
    expect(canServeToolRequests(server({ status: 'connected' }))).toBe(true);
    expect(
      canServeToolRequests(server({ status: 'disconnected', config: { startOnDemand: true } })),
    ).toBe(true);
  });

  it('rejects a disconnected server that cannot be woken, and any disabled server', () => {
    expect(canServeToolRequests(server({ status: 'disconnected', config: {} }))).toBe(false);
    expect(canServeToolRequests(server({ status: 'oauth_required' }))).toBe(false);
    expect(canServeToolRequests(server({ status: 'connected', enabled: false }))).toBe(false);
    expect(
      canServeToolRequests(
        server({ status: 'disconnected', enabled: false, config: { startOnDemand: true } }),
      ),
    ).toBe(false);
  });
});
