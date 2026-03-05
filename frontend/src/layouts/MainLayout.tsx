import { type FC, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Content from '@/components/layout/Content';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';

const MainLayout: FC = () => {
  // Controls the sidebar expand/collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
      {/* Top navigation */}
      <Header onToggleSidebar={toggleSidebar} />

      <div className="flex flex-1 overflow-hidden">
        {/* Side navigation */}
        <Sidebar collapsed={sidebarCollapsed} />

        {/* Main content area */}
        <Content>
          <Outlet />
        </Content>
      </div>
    </div>
  );
};

export default MainLayout;
