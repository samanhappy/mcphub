import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';
import { BookOpen, Menu } from 'lucide-react';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import GitHubIcon from '@/components/icons/GitHubIcon';
import { useEmbeddingSync } from '@/contexts/EmbeddingSyncContext';

interface HeaderProps {
  onToggleSidebar: () => void;
}

const useCrumbs = (): string[] => {
  const { t } = useTranslation();
  const location = useLocation();
  const params = useParams();

  return useMemo(() => {
    const path = location.pathname;
    const root = t('app.title');
    if (path === '/') return [root, t('nav.dashboard')];
    if (path.startsWith('/servers')) return [root, t('nav.servers')];
    if (path.startsWith('/groups')) return [root, t('nav.groups')];
    if (path.startsWith('/prompts')) return [root, t('nav.prompts')];
    if (path.startsWith('/resources')) return [root, t('nav.resources')];
    if (path.startsWith('/users')) return [root, t('nav.users')];
    if (path.startsWith('/market')) {
      const serverName = (params as { serverName?: string }).serverName;
      const crumbs = [root, t('nav.market')];
      if (serverName) crumbs.push(serverName);
      return crumbs;
    }
    if (path.startsWith('/logs')) return [root, t('nav.logs')];
    if (path.startsWith('/activity')) return [root, t('nav.activity')];
    if (path.startsWith('/settings')) return [root, t('nav.settings')];
    return [root];
  }, [location.pathname, params, t]);
};

const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { t } = useTranslation();
  const { activeSyncs } = useEmbeddingSync();
  const crumbs = useCrumbs();

  return (
    <header className="hub-topbar shrink-0">
      <button
        onClick={onToggleSidebar}
        className="hub-icon-btn"
        aria-label={t('app.toggleSidebar')}
      >
        <Menu size={16} />
      </button>

      <div className="hub-crumb flex items-center min-w-0">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {i === crumbs.length - 1 ? <b className="truncate">{c}</b> : <span className="truncate">{c}</span>}
          </React.Fragment>
        ))}
      </div>

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
          aria-label="GitHub Repository"
        >
          <GitHubIcon className="h-4 w-4" />
        </a>
        <a
          href="https://docs.mcphub.app"
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn"
          aria-label="Documentation"
        >
          <BookOpen className="h-4 w-4" />
        </a>
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
    </header>
  );
};

export default Header;
