import React from 'react';
import { useAuth } from '../contexts/AuthContext';

interface PermissionCheckerProps {
  permissions: string | string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Permission checker component for conditional rendering
 * @param permissions Required permissions, supports single permission string or permission array
 * @param fallback Content to show when permission is denied, defaults to null
 * @param children Content to show when permission is granted
 */
export const PermissionChecker: React.FC<PermissionCheckerProps> = ({
  permissions,
  fallback = null,
  children,
}) => {
  const hasPermission = usePermissionCheck(permissions);

  return hasPermission ? <>{children}</> : <>{fallback}</>;
};

/**
 * Permission check hook
 * @param requiredPermissions Permissions to check
 * @returns Whether user has permission
 */
export const usePermissionCheck = (requiredPermissions: string | string[]): boolean => {
  const { auth } = useAuth();

  if (!auth.isAuthenticated || !auth.user) {
    return false;
  }

  const userPermissions = auth.user.permissions || [];

  if (requiredPermissions === 'x' && !userPermissions.includes('x')) {
    return false;
  }

  // If user has '*' permission, they have all permissions
  if (userPermissions.includes('*')) {
    return true;
  }

  // If user is admin, they have all permissions by default
  if (auth.user.isAdmin) {
    return true;
  }

  // Normalize required permissions to array
  const permissionsToCheck = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  // Check if user has any of the required permissions
  return permissionsToCheck.some(permission =>
    userPermissions.includes(permission)
  );
};

/**
 * Permission check hook - requires all permissions
 * @param requiredPermissions Array of permissions to check
 * @returns Whether user has all permissions
 */
export const usePermissionCheckAll = (requiredPermissions: string[]): boolean => {
  const { auth } = useAuth();

  if (!auth.isAuthenticated || !auth.user) {
    return false;
  }

  const userPermissions = auth.user.permissions || [];

  // If user has '*' permission, they have all permissions
  if (userPermissions.includes('*')) {
    return true;
  }

  // If user is admin, they have all permissions by default
  if (auth.user.isAdmin) {
    return true;
  }

  // Check if user has all required permissions
  return requiredPermissions.every(permission =>
    userPermissions.includes(permission)
  );
};

export default PermissionChecker;
