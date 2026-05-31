import { canViewSystemLogs } from '../../frontend/src/utils/navigationPermissions';

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
