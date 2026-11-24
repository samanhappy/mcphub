import { PERMISSIONS } from '../constants/permissions';

export type NavigationUser =
  | {
      isAdmin?: boolean;
      permissions?: string[];
    }
  | null
  | undefined;

export const canViewSystemLogs = (user: NavigationUser): boolean => Boolean(user?.isAdmin);

export const canViewActivity = (user: NavigationUser): boolean => Boolean(user?.isAdmin);

export const canManageSkills = (user: NavigationUser): boolean => Boolean(user?.isAdmin);

export const canManageUsers = (user: NavigationUser): boolean =>
  Boolean(user?.isAdmin && (user.permissions || []).includes(PERMISSIONS.USERS_MANAGE));
