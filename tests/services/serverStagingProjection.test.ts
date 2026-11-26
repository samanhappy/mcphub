import { describe, expect, it } from '@jest/globals';
import { presentServerInfoForPrincipal } from '../../src/services/serverConfigPresenter.js';

describe('server staging projection in ServerInfo', () => {
  const sampleServerInfo = {
    name: 'ssh',
    owner: 'alice',
    visibility: 'public',
    status: 'connected',
    config: {
      type: 'stdio',
      command: 'npx',
      staging: { adapter: 'ssh', shared: true },
    },
  };

  it('preserves config.staging for the server owner and admins', () => {
    const ownerView = presentServerInfoForPrincipal(sampleServerInfo, {
      username: 'alice',
      isAdmin: false,
    });
    expect(ownerView.config.staging).toEqual({ adapter: 'ssh', shared: true });

    const adminView = presentServerInfoForPrincipal(sampleServerInfo, {
      username: 'admin',
      isAdmin: true,
    });
    expect(adminView.config.staging).toEqual({ adapter: 'ssh', shared: true });
  });

  it('strips config.staging from non-owner shared users', () => {
    const sharedUserView = presentServerInfoForPrincipal(sampleServerInfo, {
      username: 'bob',
      isAdmin: false,
    });
    expect((sharedUserView.config as Record<string, unknown>).staging).toBeUndefined();
    expect((sharedUserView.config as Record<string, unknown>).configRestricted).toBe(true);
  });
});
