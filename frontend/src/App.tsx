import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/Dashboard';
import ServersPage from './pages/ServersPage';
import GroupsPage from './pages/GroupsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import MarketPage from './pages/MarketPage';
import LogsPage from './pages/LogsPage';
import { getBasePath } from './utils/runtime';

function App() {
  const basename = getBasePath();
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Router basename={basename}>
            <Routes>
              {/* 公共路由 */}
              <Route path="/login" element={<LoginPage />} />

              {/* 受保护的路由，使用 MainLayout 作为布局容器 */}
              <Route element={<ProtectedRoute />}>
                <Route element={<MainLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/servers" element={<ServersPage />} />
                  <Route path="/groups" element={<GroupsPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/market" element={<MarketPage />} />
                  <Route path="/market/:serverName" element={<MarketPage />} />
                  <Route path="/logs" element={<LogsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>

              {/* 未匹配的路由重定向到首页 */}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Router>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;