import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useParams } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ServerProvider } from './contexts/ServerContext';
import { GroupProvider } from './contexts/GroupContext';
import { SettingsProvider } from './contexts/SettingsContext';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import EmbeddingSyncAlertListener from './components/EmbeddingSyncAlertListener';
import { getBasePath } from './utils/runtime';
import {
  canManageSkills,
  canManageUsers,
  canViewActivity,
  canViewSystemLogs,
} from './utils/navigationPermissions';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const OAuthConsentPage = lazy(() => import('./pages/OAuthConsentPage'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const CredentialsPage = lazy(() => import('./pages/CredentialsPage'));
const ServersPage = lazy(() => import('./pages/ServersPage'));
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const OAuthApprovalsPage = lazy(() => import('./pages/OAuthApprovalsPage'));
const PasskeysPage = lazy(() => import('./pages/PasskeysPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MarketPage = lazy(() => import('./pages/MarketPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const PromptsPage = lazy(() => import('./pages/PromptsPage'));
const ResourcesPage = lazy(() => import('./pages/ResourcesPage'));
const SkillsPage = lazy(() => import('./pages/SkillsPage'));

// Helper component to redirect legacy cloud server routes to the local market page
const CloudRedirect: React.FC = () => {
  const { serverName } = useParams<{ serverName: string }>();
  return <Navigate to={`/market/${serverName}`} replace />;
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
          <GroupProvider>
            <ToastProvider>
              <SettingsProvider>
                <Router basename={basename}>
                  <EmbeddingSyncAlertListener />
                  <Routes>
                    {/* Public routes */}
                    <Route
                      path="/login"
                      element={
                        <Suspense fallback={<RouteFallback />}>
                          <LoginPage />
                        </Suspense>
                      }
                    />

                    {/* OAuth consent screen: server injects the consent context
                        into the SPA shell served at /oauth/authorize */}
                    <Route
                      path="/oauth/authorize"
                      element={
                        <Suspense fallback={<RouteFallback />}>
                          <OAuthConsentPage />
                        </Suspense>
                      }
                    />

                    {/* Protected routes inside MainLayout */}
                    <Route element={<ProtectedRoute />}>
                      <Route element={<MainLayout />}>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/oauth-applications" element={<OAuthApprovalsPage />} />
                        <Route path="/passkeys" element={<PasskeysPage />} />
                        <Route path="/credentials" element={<CredentialsPage />} />
                        <Route path="/servers" element={<ServersPage />} />
                        <Route path="/groups" element={<GroupsPage />} />
                        <Route path="/prompts" element={<PromptsPage />} />
                        <Route path="/resources" element={<ResourcesPage />} />
                        <Route path="/market" element={<MarketPage />} />
                        <Route path="/market/:serverName" element={<MarketPage />} />
                        {/* Legacy cloud routes redirect to the local market page */}
                        <Route path="/cloud" element={<Navigate to="/market" replace />} />
                        <Route path="/cloud/:serverName" element={<CloudRedirect />} />
                        <Route path="/settings" element={<SettingsPage />} />

                        {/* Admin / permission-gated routes */}
                        <Route element={<ProtectedRoute canAccess={canManageSkills} />}>
                          <Route path="/skills" element={<SkillsPage />} />
                        </Route>
                        <Route element={<ProtectedRoute canAccess={canManageUsers} />}>
                          <Route path="/users" element={<UsersPage />} />
                        </Route>
                        <Route element={<ProtectedRoute canAccess={canViewSystemLogs} />}>
                          <Route path="/logs" element={<LogsPage />} />
                        </Route>
                        <Route element={<ProtectedRoute canAccess={canViewActivity} />}>
                          <Route path="/activity" element={<ActivityPage />} />
                        </Route>
                      </Route>
                    </Route>

                    {/* Fallback redirect */}
                    <Route path="*" element={<Navigate to="/" />} />
                  </Routes>
                </Router>
              </SettingsProvider>
            </ToastProvider>
          </GroupProvider>
        </ServerProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
