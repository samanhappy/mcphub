import {
  canAccessAdminPages,
  canViewSystemLogs,
} from '../../frontend/src/utils/navigationPermissions';

describe('canAccessAdminPages', () => {
  it('allows authenticated administrators', () => {
    expect(canAccessAdminPages({ username: 'admin', isAdmin: true })).toBe(true);
  });

  it('denies non-admin skipAuth guests', () => {
    expect(canAccessAdminPages({ username: 'guest', isAdmin: false })).toBe(false);
  });

  it('denies access when no user is signed in', () => {
    expect(canAccessAdminPages(null)).toBe(false);
  });
});

describe('canViewSystemLogs', () => {
  it('allows admins to access the system logs menu', () => {
    expect(
      canViewSystemLogs({
        username: 'admin',
        isAdmin: true,
      }),
    ).toBe(true);
  });

  it('hides the system logs menu from ordinary users', () => {
    expect(
      canViewSystemLogs({
        username: 'user',
        isAdmin: false,
      }),
    ).toBe(false);
  });

  it('hides the system logs menu when no user is signed in', () => {
    expect(canViewSystemLogs(null)).toBe(false);
  });
});
