import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router-dom';
import { BookOpen, Menu } from 'lucide-react';
import { useBranding } from '@/contexts/BrandingContext';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import GitHubIcon from '@/components/icons/GitHubIcon';
import { useEmbeddingSync } from '@/contexts/EmbeddingSyncContext';
import { resolveBreadcrumbs } from '@/utils/navigationRegistry';

interface HeaderProps {
  onToggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { t } = useTranslation();
  const { dashboardTitle } = useBranding();
  const location = useLocation();
  const params = useParams();
  const { activeSyncs } = useEmbeddingSync();

  const crumbs = useMemo(
    () => resolveBreadcrumbs(location.pathname, params, dashboardTitle, t),
    [location.pathname, params, dashboardTitle, t],
  );

  return (
    <header className="hub-topbar shrink-0">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="hub-icon-btn"
        aria-label={t('app.toggleSidebar')}
        title={t('app.toggleSidebar')}
      >
        <Menu size={16} aria-hidden="true" />
      </button>

      <nav
        aria-label={t('nav.breadcrumb')}
        className="hub-crumb flex items-center min-w-0"
      >
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <React.Fragment key={`${crumb.label}-${index}`}>
              {index > 0 && (
                <span className="sep" aria-hidden="true">
                  /
                </span>
              )}
              {isLast ? (
                <b className="truncate" aria-current="page">
                  {crumb.label}
                </b>
              ) : crumb.to ? (
                <Link
                  to={crumb.to}
                  className="truncate transition-colors hover:text-[var(--hub-ink)]"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      <div className="flex-1 flex justify-center px-2 min-w-0">
        {activeSyncs.length > 0 && (
          <div className="flex max-w-full flex-wrap justify-center gap-2">
            {activeSyncs.map((activeSync) => (
              <div
                key={activeSync.serverName}
                className="hub-card flex min-w-0 w-56 max-w-full flex-col px-3 py-1.5 text-xs"
                style={{ borderRadius: 7 }}
                title={t('app.embeddingSyncProgressAriaLabel', {
                  serverName: activeSync.serverName,
                  current: activeSync.current,
                  total: activeSync.total,
                })}
              >
                <span className="truncate hub-mono text-[var(--hub-ink-2)]">
                  {t('app.embeddingSyncProgress', { serverName: activeSync.serverName })}
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <progress
                    className="h-1.5 flex-1"
                    value={activeSync.current}
                    max={activeSync.total}
                    aria-label={t('app.embeddingSyncProgressAriaLabel', {
                      serverName: activeSync.serverName,
                      current: activeSync.current,
                      total: activeSync.total,
                    })}
                  />
                  <span className="shrink-0 hub-mono hub-num text-[var(--hub-ink-3)]">
                    {activeSync.current}/{activeSync.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <a
          href="https://github.com/samanhappy/mcphub"
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn"
          aria-label={t('header.github')}
          title={t('header.github')}
        >
          <GitHubIcon className="h-4 w-4" />
        </a>
        <a
          href="https://docs.mcphub.app"
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn"
          aria-label={t('header.documentation')}
          title={t('header.documentation')}
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </a>
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
    </header>
  );
};

export default Header;
