import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router-dom';
import {
  Activity,
  Blocks,
  FileText,
  LayoutGrid,
  MessageSquare,
  Route as RouteIcon,
  ScrollText,
  Server as ServerIcon,
  Settings as SettingsIcon,
  Store,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import { useBranding } from '@/contexts/BrandingContext';
import { useAuth } from '@/contexts/AuthContext';
import { useServerContext } from '@/contexts/ServerContext';
import { useGroupData } from '@/hooks/useGroupData';
import { canViewActivity } from '@/utils/navigationPermissions';
import {
  getVisibleSidebarSections,
  type NavIconId,
  type NavItemMeta,
} from '@/utils/navigationRegistry';
import UserProfileMenu from '@/components/ui/UserProfileMenu';
import { checkActivityAvailable } from '@/services/activityService';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const SIDEBAR_ICON_MAP: Partial<Record<NavIconId, React.ReactNode>> = {
  dashboard: <LayoutGrid className="h-4 w-4" aria-hidden="true" />,
  servers: <ServerIcon className="h-4 w-4" aria-hidden="true" />,
  groups: <RouteIcon className="h-4 w-4" aria-hidden="true" />,
  market: <Store className="h-4 w-4" aria-hidden="true" />,
  prompts: <MessageSquare className="h-4 w-4" aria-hidden="true" />,
  resources: <FileText className="h-4 w-4" aria-hidden="true" />,
  skills: <Blocks className="h-4 w-4" aria-hidden="true" />,
  users: <UsersIcon className="h-4 w-4" aria-hidden="true" />,
  activity: <Activity className="h-4 w-4" aria-hidden="true" />,
  logs: <ScrollText className="h-4 w-4" aria-hidden="true" />,
  settings: <SettingsIcon className="h-4 w-4" aria-hidden="true" />,
};

const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const { t } = useTranslation();
  const { dashboardTitle } = useBranding();
  const { auth } = useAuth();
  const { allServers } = useServerContext();
  const { groups } = useGroupData();
  const [activityAvailable, setActivityAvailable] = useState(false);

  const appVersion = import.meta.env.PACKAGE_VERSION as string;
  const userCanViewActivity = canViewActivity(auth.user);

  useEffect(() => {
    if (!userCanViewActivity) {
      setActivityAvailable(false);
      return;
    }

    let active = true;
    checkActivityAvailable()
      .then((available) => {
        if (active) {
          setActivityAvailable(available);
        }
      })
      .catch(() => {
        if (active) {
          setActivityAvailable(false);
        }
      });

    return () => {
      active = false;
    };
  }, [userCanViewActivity]);

  const sections = useMemo(
    () =>
      getVisibleSidebarSections({
        user: auth.user,
        activityAvailable,
      }),
    [auth.user, activityAvailable],
  );

  // Mobile drawer is always rendered in expanded mode so labels remain readable.
  const isCompact = collapsed && !mobileOpen;

  const getBadgeValue = (item: NavItemMeta): number | undefined => {
    if (item.badgeKey === 'servers') {
      return allServers.length || undefined;
    }
    if (item.badgeKey === 'groups') {
      return groups.length || undefined;
    }
    return undefined;
  };

  const renderItem = (item: NavItemMeta) => {
    const label = t(item.labelKey);
    const badge = getBadgeValue(item);
    const tooltip = badge != null ? `${label} (${badge})` : label;

    return (
      <NavLink
        key={item.id}
        to={item.path}
        end={item.end}
        onClick={onCloseMobile}
        title={isCompact ? tooltip : undefined}
        aria-label={isCompact ? tooltip : undefined}
        className={({ isActive }) =>
          [
            'group flex items-center gap-2.5 rounded-md text-[13.5px] transition-colors',
            isCompact ? 'justify-center px-2 py-2' : 'px-2.5 py-1.5',
            isActive
              ? 'bg-[var(--hub-surface)] font-medium text-[var(--hub-ink)] ring-1 ring-inset ring-[var(--hub-line)]'
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
              {SIDEBAR_ICON_MAP[item.icon]}
            </span>
            {!isCompact && (
              <>
                <span className="truncate">{label}</span>
                {badge != null && (
                  <span className="ml-auto hub-mono hub-num text-[11px] text-[var(--hub-ink-3)]">
                    {badge}
                  </span>
                )}
              </>
            )}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/35 backdrop-blur-[1px] md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label={t('nav.workspace')}
        className={[
          'flex flex-col h-full shrink-0 transition-[width,translate] duration-200 ease-out',
          'bg-[var(--hub-bg-2)] border-r border-[var(--hub-line)]',
          'fixed inset-y-0 left-0 z-40 w-[248px] shadow-xl md:static md:z-auto md:shadow-none',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
          collapsed ? 'md:w-14' : 'md:w-[232px]',
        ].join(' ')}
      >
        {/* Brand */}
        <div
          className={
            'flex items-center gap-2 ' +
            (isCompact ? 'px-2 py-3 justify-center' : 'px-3.5 py-3 justify-between')
          }
        >
          <Link
            to="/"
            onClick={onCloseMobile}
            title={isCompact ? dashboardTitle : undefined}
            aria-label={dashboardTitle}
            className="flex items-center gap-2.5 min-w-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-accent)]"
          >
            <div
              className="grid shrink-0 h-7 w-7 place-items-center rounded-md text-white hub-mono text-[12px] font-semibold"
              style={{
                background: 'linear-gradient(135deg, var(--hub-accent), oklch(0.62 0.18 285))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)',
              }}
            >
              <span>M</span>
            </div>
            {!isCompact && (
              <div className="flex flex-wrap items-baseline gap-x-1.5 min-w-0">
                <span className="font-semibold tracking-tight text-[var(--hub-ink)] break-words min-w-0 max-w-full">
                  {dashboardTitle}
                </span>
                {appVersion && (
                  <span className="hub-mono text-[10.5px] text-[var(--hub-ink-3)] flex-shrink-0">
                    {appVersion === 'dev' ? appVersion : `v${appVersion}`}
                  </span>
                )}
              </div>
            )}
          </Link>

          {mobileOpen && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="hub-icon-btn sm md:hidden shrink-0"
              aria-label={t('app.closeButton')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Navigation sections */}
        <div className="flex-1 overflow-y-auto pb-2">
          {sections.map((section, sectionIndex) => (
            <div key={section.id}>
              {isCompact ? (
                sectionIndex > 0 && (
                  <div
                    className="mx-2.5 my-2 border-t border-[var(--hub-line)]"
                    aria-hidden="true"
                  />
                )
              ) : (
                <div
                  className={
                    'hub-sect px-3 pb-1.5 ' + (sectionIndex === 0 ? 'pt-2' : 'pt-3.5')
                  }
                >
                  {t(section.labelKey)}
                </div>
              )}
              <nav
                aria-label={t(section.labelKey)}
                className={'flex flex-col gap-0.5 ' + (isCompact ? 'px-1.5' : 'px-2')}
              >
                {section.items.map(renderItem)}
              </nav>
            </div>
          ))}
        </div>

        {/* User profile & account menu */}
        <div className="p-2 border-t border-[var(--hub-line)]">
          <UserProfileMenu
            collapsed={isCompact}
            version={appVersion}
            onNavigate={onCloseMobile}
          />
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
