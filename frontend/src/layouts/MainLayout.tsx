import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import Content from '@/components/layout/Content';
import { EmbeddingSyncProvider } from '@/contexts/EmbeddingSyncContext';

const PageFallback: React.FC = () => (
  <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
    Loading...
  </div>
);

const MainLayout: React.FC = () => {
  // 控制侧边栏展开/折叠状态
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <EmbeddingSyncProvider>
      <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
        {/* 顶部导航 */}
        <Header onToggleSidebar={toggleSidebar} />

        <div className="flex flex-1 overflow-hidden">
          {/* 侧边导航 */}
          <Sidebar collapsed={sidebarCollapsed} />

          {/* 主内容区域 */}
          <Content>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </Content>
        </div>
      </div>
    </EmbeddingSyncProvider>
  );
};

export default MainLayout;