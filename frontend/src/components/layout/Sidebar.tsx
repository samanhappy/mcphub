import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  Server as ServerIcon,
  Users as UsersIcon,
  Store,
  Route as RouteIcon,
  Settings as SettingsIcon,
  FileText,
  MessageSquare,
  Activity,
  ScrollText,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useServerContext } from '@/contexts/ServerContext';
import { useGroupData } from '@/hooks/useGroupData';
import { usePermissionCheck } from '../PermissionChecker';
import UserProfileMenu from '@/components/ui/UserProfileMenu';
import { checkActivityAvailable } from '@/services/activityService';

interface SidebarProps {
  collapsed: boolean;
}

interface MenuItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  end?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed }) => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const { allServers } = useServerContext();
  const { groups } = useGroupData();
  const [activityAvailable, setActivityAvailable] = useState(false);

  const appVersion = import.meta.env.PACKAGE_VERSION as string;

  useEffect(() => {
    checkActivityAvailable()
      .then(setActivityAvailable)
      .catch(() => setActivityAvailable(false));
  }, []);

  const userCanManageUsers = auth.user?.isAdmin && usePermissionCheck('x');

  const workspaceItems: MenuItem[] = [
    { path: '/', label: t('nav.dashboard'), icon: <LayoutGrid className="h-4 w-4" />, end: true },
    {
      path: '/servers',
      label: t('nav.servers'),
      icon: <ServerIcon className="h-4 w-4" />,
      badge: allServers.length || undefined,
    },
    {
      path: '/groups',
      label: t('nav.groups'),
      icon: <RouteIcon className="h-4 w-4" />,
      badge: groups.length || undefined,
    },
    { path: '/prompts', label: t('nav.prompts'), icon: <MessageSquare className="h-4 w-4" /> },
    { path: '/resources', label: t('nav.resources'), icon: <FileText className="h-4 w-4" /> },
    { path: '/market', label: t('nav.market'), icon: <Store className="h-4 w-4" /> },
  ];

  const systemItems: MenuItem[] = [
    ...(userCanManageUsers
      ? [{ path: '/users', label: t('nav.users'), icon: <UsersIcon className="h-4 w-4" /> }]
      : []),
    ...(activityAvailable && auth.user?.isAdmin
      ? [{ path: '/activity', label: t('nav.activity'), icon: <Activity className="h-4 w-4" /> }]
      : []),
    { path: '/logs', label: t('nav.logs'), icon: <ScrollText className="h-4 w-4" /> },
    { path: '/settings', label: t('nav.settings'), icon: <SettingsIcon className="h-4 w-4" /> },
  ];

  const renderItem = (item: MenuItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.end}
      className={({ isActive }) =>
        [
          'group flex items-center gap-2.5 rounded-md text-[13.5px] transition-colors',
          collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-1.5',
          isActive
            ? 'bg-[var(--hub-surface)] text-[var(--hub-ink)] ring-1 ring-inset ring-[var(--hub-line)]'
            : 'text-[var(--hub-ink-2)] hover:bg-[var(--hub-surface-hover)] hover:text-[var(--hub-ink)]',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={
              isActive
                ? 'text-[var(--hub-ink)] flex-shrink-0'
                : 'text-[var(--hub-ink-3)] group-hover:text-[var(--hub-ink-2)] flex-shrink-0'
            }
          >
            {item.icon}
          </span>
          {!collapsed && (
            <>
              <span className="truncate">{item.label}</span>
              {item.badge != null && (
                <span className="ml-auto hub-mono hub-num text-[11px] text-[var(--hub-ink-3)]">
                  {item.badge}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );

  return (
    <aside
      className={
        'flex flex-col h-full relative shrink-0 transition-[width] duration-200 ease-out ' +
        'bg-[var(--hub-bg-2)] border-r border-[var(--hub-line)] ' +
        (collapsed ? 'w-14' : 'w-[232px]')
      }
    >
      {/* Brand */}
      <div className={'flex items-center gap-2.5 ' + (collapsed ? 'px-2 py-3 justify-center' : 'px-4 py-3')}>
        <div className="relative w-7 h-7 rounded-md bg-[var(--hub-ink)] grid place-items-center text-white hub-mono font-semibold text-[12px]">
          <span>M</span>
          <span
            className="absolute -right-0.5 -bottom-0.5 w-[6px] h-[6px] rounded-full"
            style={{
              background: 'var(--hub-ok)',
              boxShadow: '0 0 0 2px oklch(0.66 0.15 145 / 0.18)',
            }}
          />
        </div>
        {!collapsed && (
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-semibold tracking-tight text-[var(--hub-ink)] truncate">
              {t('app.title')}
            </span>
            {appVersion && (
              <span className="hub-mono text-[10.5px] text-[var(--hub-ink-3)] flex-shrink-0">
                {appVersion === 'dev' ? appVersion : `v${appVersion}`}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {!collapsed && <div className="hub-sect px-3 pt-2 pb-1.5">{t('nav.workspace')}</div>}
        <nav className={'flex flex-col gap-px ' + (collapsed ? 'px-1.5' : 'px-2')}>
          {workspaceItems.map(renderItem)}
        </nav>

        {!collapsed && <div className="hub-sect px-3 pt-3 pb-1.5">{t('nav.system')}</div>}
        <nav className={'flex flex-col gap-px ' + (collapsed ? 'px-1.5 mt-1' : 'px-2')}>
          {systemItems.map(renderItem)}
        </nav>
      </div>

      <div className="p-2.5 border-t border-[var(--hub-line)]">
        <UserProfileMenu collapsed={collapsed} version={appVersion} />
      </div>
    </aside>
  );
};

export default Sidebar;
