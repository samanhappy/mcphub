import {
  canManageSkills,
  canManageUsers,
  canViewActivity,
  canViewSystemLogs,
} from '../../frontend/src/utils/navigationPermissions';
import { PERMISSIONS } from '../../frontend/src/constants/permissions';

describe('navigationPermissions', () => {
  describe('canViewSystemLogs', () => {
    it('allows admins to access the system logs menu', () => {
      expect(
        canViewSystemLogs({
          isAdmin: true,
        }),
      ).toBe(true);
    });

    it('hides the system logs menu from ordinary users', () => {
      expect(
        canViewSystemLogs({
          isAdmin: false,
        }),
      ).toBe(false);
    });

    it('hides the system logs menu when no user is signed in', () => {
      expect(canViewSystemLogs(null)).toBe(false);
    });
  });

  describe('canManageUsers', () => {
    it('requires both admin role and USERS_MANAGE permission', () => {
      expect(
        canManageUsers({
          isAdmin: true,
          permissions: ['*', PERMISSIONS.USERS_MANAGE],
        }),
      ).toBe(true);

      expect(
        canManageUsers({
          isAdmin: true,
          permissions: ['*'],
        }),
      ).toBe(false);

      expect(
        canManageUsers({
          isAdmin: false,
          permissions: [PERMISSIONS.USERS_MANAGE],
        }),
      ).toBe(false);

      expect(canManageUsers(null)).toBe(false);
    });
  });

  describe('canViewActivity & canManageSkills', () => {
    it('allows only admins', () => {
      expect(canViewActivity({ isAdmin: true })).toBe(true);
      expect(canViewActivity({ isAdmin: false })).toBe(false);
      expect(canViewActivity(null)).toBe(false);

      expect(canManageSkills({ isAdmin: true })).toBe(true);
      expect(canManageSkills({ isAdmin: false })).toBe(false);
      expect(canManageSkills(undefined)).toBe(false);
    });
  });
});
