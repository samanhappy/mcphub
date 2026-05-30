import { applyServerListPatch } from '../../frontend/src/utils/serverListState';

describe('applyServerListPatch', () => {
  it('updates enabled state on the matching server and mirrors it into config', () => {
    const servers = [
      {
        name: 'alpha',
        status: 'connected' as const,
        enabled: true,
        config: {
          type: 'stdio' as const,
          enabled: true,
        },
      },
      {
        name: 'beta',
        status: 'disconnected' as const,
        enabled: true,
      },
    ];

    expect(applyServerListPatch(servers, 'alpha', { enabled: false })).toEqual([
      {
        name: 'alpha',
        status: 'connected',
        enabled: false,
        config: {
          type: 'stdio',
          enabled: false,
        },
      },
      {
        name: 'beta',
        status: 'disconnected',
        enabled: true,
      },
    ]);
  });

  it('updates visibility without creating config objects for entries that do not have one', () => {
    const servers = [
      {
        name: 'alpha',
        status: 'connected' as const,
        visibility: 'private' as const,
      },
      {
        name: 'beta',
        status: 'connected' as const,
        visibility: 'private' as const,
        config: {
          type: 'stdio' as const,
          visibility: 'private' as const,
        },
      },
    ];

    expect(applyServerListPatch(servers, 'beta', { visibility: 'public' })).toEqual([
      {
        name: 'alpha',
        status: 'connected',
        visibility: 'private',
      },
      {
        name: 'beta',
        status: 'connected',
        visibility: 'public',
        config: {
          type: 'stdio',
          visibility: 'public',
        },
      },
    ]);
  });
});