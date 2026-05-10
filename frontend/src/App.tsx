import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useParams } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ServerProvider } from './contexts/ServerContext';
import { SettingsProvider } from './contexts/SettingsContext';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import EmbeddingSyncAlertListener from './components/EmbeddingSyncAlertListener';
import { getBasePath } from './utils/runtime';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const ServersPage = lazy(() => import('./pages/ServersPage'));
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MarketPage = lazy(() => import('./pages/MarketPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const PromptsPage = lazy(() => import('./pages/PromptsPage'));
const ResourcesPage = lazy(() => import('./pages/ResourcesPage'));

// Helper component to redirect cloud server routes to market
const CloudRedirect: React.FC = () => {
  const { serverName } = useParams<{ serverName: string }>();
  return <Navigate to={`/market/${serverName}?tab=cloud`} replace />;
};

const RouteFallback: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
    Loading...
  </div>
);

function App() {
  const basename = getBasePath();
  return (
    <ThemeProvider>
      <AuthProvider>
        <ServerProvider>
          <ToastProvider>
            <SettingsProvider>
              <Router basename={basename}>
                <EmbeddingSyncAlertListener />
                <Routes>
                  {/* 公共路由 */}
                  <Route
                    path="/login"
                    element={
                      <Suspense fallback={<RouteFallback />}>
                        <LoginPage />
                      </Suspense>
                    }
                  />

                  {/* 受保护的路由，使用 MainLayout 作为布局容器 */}
                  <Route element={<ProtectedRoute />}>
                    <Route element={<MainLayout />}>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/servers" element={<ServersPage />} />
                      <Route path="/groups" element={<GroupsPage />} />
                      <Route path="/prompts" element={<PromptsPage />} />
                      <Route path="/resources" element={<ResourcesPage />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/market" element={<MarketPage />} />
                      <Route path="/market/:serverName" element={<MarketPage />} />
                      {/* Legacy cloud routes redirect to market with cloud tab */}
                      <Route path="/cloud" element={<Navigate to="/market?tab=cloud" replace />} />
                      <Route path="/cloud/:serverName" element={<CloudRedirect />} />
                      <Route path="/logs" element={<LogsPage />} />
                      <Route path="/activity" element={<ActivityPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Route>
                  </Route>

                  {/* 未匹配的路由重定向到首页 */}
                  <Route path="*" element={<Navigate to="/" />} />
                </Routes>
              </Router>
            </SettingsProvider>
          </ToastProvider>
        </ServerProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
