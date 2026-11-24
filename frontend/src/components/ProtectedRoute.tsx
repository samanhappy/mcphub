import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import type { NavigationUser } from '../utils/navigationPermissions';

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
  const { t } = useTranslation();
  const { auth } = useAuth();

  if (auth.loading) {
    return <div className="flex items-center justify-center h-screen">{t('app.loading')}</div>;
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
