import { isPrivilegedServerConfig } from '../../src/utils/serverConfigValidation.js';
import {
  canManageServer,
  getServerConfigPermissionError,
} from '../../frontend/src/utils/serverPermissions';

describe('canManageServer', () => {
  const server = {
    name: 'shared-public',
    owner: 'alice',
    visibility: 'public' as const,
  };

  it('allows admins to manage any visible server', () => {
    expect(
      canManageServer(server, {
        username: 'admin',
        isAdmin: true,
      }),
    ).toBe(true);
  });

  it('allows the owner to manage their server', () => {
    expect(
      canManageServer(server, {
        username: 'alice',
        isAdmin: false,
      }),
    ).toBe(true);
  });

  it('treats other authenticated users as read-only even for public servers', () => {
    expect(
      canManageServer(server, {
        username: 'bob',
        isAdmin: false,
      }),
    ).toBe(false);
  });

  it('treats unauthenticated viewers as read-only', () => {
    expect(canManageServer(server, null)).toBe(false);
  });
});

describe('server configuration installation permissions', () => {
  const restricted = [
    { type: 'stdio' as const },
    { command: 'npx', args: ['example'] },
    { url: 'https://example.com/mcp', command: 'npx' },
    { url: 'https://example.com/mcp', args: ['example'] },
    {},
    {
      type: 'streamable-http' as const,
      url: 'https://example.com/mcp',
      oauth: { allowInsecureTokenEndpoint: true },
    },
  ];
  const remote = [
    { type: 'sse' as const, url: 'https://example.com/sse' },
    { type: 'streamable-http' as const, url: 'https://example.com/mcp', args: [] },
    { type: 'openapi' as const, openapi: { url: 'https://example.com/openapi.json' } },
    { type: 'openapi' as const, openapi: { schema: { openapi: '3.1.0' } } },
  ];

  it.each(restricted)('explains restricted configurations before submission: %p', (config) => {
    expect(getServerConfigPermissionError(config, false)).toBeTruthy();
    expect(getServerConfigPermissionError(config)).toBeTruthy();
    expect(getServerConfigPermissionError(config, true)).toBeNull();
  });

  it.each(remote)('keeps remote configurations installable: %p', (config) => {
    expect(getServerConfigPermissionError(config, false)).toBeNull();
  });

  it.each([...restricted, ...remote])('matches backend authorization: %p', (config) => {
    expect(Boolean(getServerConfigPermissionError(config, false))).toBe(
      isPrivilegedServerConfig(config),
    );
  });
});
