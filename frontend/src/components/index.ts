// Permission components unified export
export { PermissionChecker, usePermissionCheck, usePermissionCheckAll } from './PermissionChecker';
import { PERMISSIONS } from '../constants/permissions';
export { PERMISSIONS };

// Convenient permission check Hook
export { useAuth } from '../contexts/AuthContext';

// Permission utility functions
export const hasPermission = (
  userPermissions: string[] = [],
  requiredPermissions: string | string[],
): boolean => {
  if (
    requiredPermissions === PERMISSIONS.USERS_MANAGE &&
    !userPermissions.includes(PERMISSIONS.USERS_MANAGE)
  ) {
    return false;
  }

  // If user has '*' permission, it means they have all permissions
  if (userPermissions.includes('*')) {
    return true;
  }

  // Normalize required permissions to array
  const permissionsToCheck = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  // Check if user has any of the required permissions
  return permissionsToCheck.some((permission) => userPermissions.includes(permission));
};

export const hasAllPermissions = (
  userPermissions: string[] = [],
  requiredPermissions: string[],
): boolean => {
  // If user has '*' permission, it means they have all permissions
  if (userPermissions.includes('*')) {
    return true;
  }

  // Check if user has all required permissions
  return requiredPermissions.every((permission) => userPermissions.includes(permission));
};
