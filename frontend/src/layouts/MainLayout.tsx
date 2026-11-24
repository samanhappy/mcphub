import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import Content from '@/components/layout/Content';
import { EmbeddingSyncProvider } from '@/contexts/EmbeddingSyncContext';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'mcphub_sidebar_collapsed';
const DESKTOP_BREAKPOINT_PX = 768;

const readInitialCollapsed = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const PageFallback: React.FC = () => (
  <div
    className="flex h-full min-h-[240px] items-center justify-center text-sm"
    style={{ color: 'var(--hub-ink-3)' }}
  >
    Loading...
  </div>
);

const MainLayout: React.FC = () => {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readInitialCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // Ignore storage failures in restricted browsing contexts.
    }
  }, [sidebarCollapsed]);

  // Close the mobile navigation drawer whenever the active route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen]);

  const toggleSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < DESKTOP_BREAKPOINT_PX) {
      setMobileNavOpen((open) => !open);
      return;
    }
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  return (
    <EmbeddingSyncProvider>
      <div
        className="flex h-screen overflow-hidden"
        style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          mobileOpen={mobileNavOpen}
          onCloseMobile={closeMobileNav}
        />
        <div className="flex flex-1 flex-col min-w-0 min-h-0">
          <Header onToggleSidebar={toggleSidebar} />
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
