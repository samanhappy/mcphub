import { Navigate, Route, BrowserRouter as Router, Routes, useParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { ServerProvider } from './contexts/ServerContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import MainLayout from './layouts/MainLayout';
import ActivityPage from './pages/ActivityPage';
import DashboardPage from './pages/Dashboard';
import GroupsPage from './pages/GroupsPage';
import LoginPage from './pages/LoginPage';
import LogsPage from './pages/LogsPage';
import MarketPage from './pages/MarketPage';
import PromptsPage from './pages/PromptsPage';
import ResourcesPage from './pages/ResourcesPage';
import ServersPage from './pages/ServersPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import { getBasePath } from './utils/runtime';

// Helper component to redirect cloud server routes to market
const CloudRedirect = () => {
  const { serverName } = useParams<{ serverName: string }>();
  return <Navigate to={`/market/${serverName}?tab=cloud`} replace />;
};

function App() {
  const basename = getBasePath();
  return (
    <ThemeProvider>
      <AuthProvider>
        <ServerProvider>
          <ToastProvider>
            <SettingsProvider>
              <Router basename={basename}>
                <Routes>
                  {/* Public routes */}
                  <Route path="/login" element={<LoginPage />} />

                  {/* Protected routes using MainLayout as the layout container */}
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

                  {/* Unmatched routes redirect to home */}
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
