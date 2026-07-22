import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { canAccessAdminPages } from '../utils/navigationPermissions';

interface ProtectedRouteProps {
  redirectPath?: string;
  requireAdmin?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  redirectPath = '/login',
  requireAdmin = false,
}) => {
  const { t } = useTranslation();
  const { auth } = useAuth();

  if (auth.loading) {
    return <div className="flex items-center justify-center h-screen">{t('app.loading')}</div>;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to={redirectPath} replace />;
  }

  if (requireAdmin && !canAccessAdminPages(auth.user)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
