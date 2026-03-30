import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import GitHubIcon from '@/components/icons/GitHubIcon';
import { useEmbeddingSync } from '@/contexts/EmbeddingSyncContext';

interface HeaderProps {
  onToggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { t } = useTranslation();
  const { activeSyncs } = useEmbeddingSync();

  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
      <div className="flex items-center gap-4 px-3 py-3">
        <div className="flex items-center shrink-0">
          {/* 侧边栏切换按钮 */}
          <button
            onClick={onToggleSidebar}
            className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none"
            aria-label={t('app.toggleSidebar')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          {/* 应用标题 */}
          <h1 className="ml-4 text-xl font-bold text-gray-900 dark:text-white">{t('app.title')}</h1>
        </div>

        <div className="flex flex-1 justify-center px-2 min-w-0">
          {activeSyncs.length > 0 && (
            <div className="flex max-w-full flex-wrap justify-center gap-2">
              {activeSyncs.map((activeSync) => (
                <div
                  key={activeSync.serverName}
                  className="flex min-w-0 w-56 max-w-full flex-col rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:bg-gray-700 dark:text-blue-100"
                  title={t('app.embeddingSyncProgressAriaLabel', {
                    serverName: activeSync.serverName,
                    current: activeSync.current,
                    total: activeSync.total,
                  })}
                >
                  <span className="truncate font-medium">
                    {t('app.embeddingSyncProgress', { serverName: activeSync.serverName })}
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <progress
                      className="h-2 flex-1"
                      value={activeSync.current}
                      max={activeSync.total}
                      aria-label={t('app.embeddingSyncProgressAriaLabel', {
                        serverName: activeSync.serverName,
                        current: activeSync.current,
                        total: activeSync.total,
                      })}
                    />
                    <span className="shrink-0 tabular-nums">
                      {activeSync.current}/{activeSync.total}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Theme Switch and Language Switcher and Version */}
        <div className="flex items-center space-x-1 shrink-0">
          <span className="text-sm text-gray-500 dark:text-gray-400 mr-2">
            {import.meta.env.PACKAGE_VERSION === 'dev'
              ? import.meta.env.PACKAGE_VERSION
              : `v${import.meta.env.PACKAGE_VERSION}`}
          </span>

          <a
            href="https://github.com/samanhappy/mcphub"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="GitHub Repository"
          >
            <GitHubIcon className="h-5 w-5" />
          </a>

          <a
            href="https://docs.mcphub.app"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Documentation"
          >
            <BookOpen className="h-5 w-5" />
          </a>

          <ThemeSwitch />
          <LanguageSwitch />
        </div>
      </div>
    </header>
  );
};

export default Header;
