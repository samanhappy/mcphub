import { canManageServer } from '../../frontend/src/utils/serverPermissions';

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
