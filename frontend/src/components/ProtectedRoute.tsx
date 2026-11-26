import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { NavigationUser } from '../utils/navigationPermissions';
import AppLoading from './ui/AppLoading';

interface ProtectedRouteProps {
  redirectPath?: string;
  canAccess?: (user: NavigationUser) => boolean;
  unauthorizedRedirectPath?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  redirectPath = '/login',
  canAccess,
  unauthorizedRedirectPath = '/',
}) => {
  const { auth } = useAuth();

  if (auth.loading) {
    return <AppLoading fullScreen />;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to={redirectPath} replace />;
  }

  if (canAccess && !canAccess(auth.user)) {
    return <Navigate to={unauthorizedRedirectPath} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
