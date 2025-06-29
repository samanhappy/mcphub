import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, RefreshCw } from 'lucide-react';
import { checkLatestVersion, compareVersions } from '@/utils/version';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
}

const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose, version }) => {
  const { t } = useTranslation();
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const [latestVersion, setLatestVersion] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  const checkForUpdates = async () => {
    setIsChecking(true);
    try {
      const latest = await checkLatestVersion();
      if (latest) {
        setLatestVersion(latest);
        setHasNewVersion(compareVersions(version, latest) > 0);
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkForUpdates();
    }
  }, [isOpen, version]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 bg-opacity-30 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md w-full">
        <div className="p-6 relative">
          {/* Close button (X) in the top-right corner */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>

          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
            {t('about.title')}
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-700 dark:text-gray-300">
                {t('about.currentVersion')}:
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {version}
              </span>
            </div>

            {hasNewVersion && latestVersion && (
              <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-600 dark:text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1 text-sm text-blue-700 dark:text-blue-300">
                    <p>{t('about.newVersionAvailable', { version: latestVersion })}</p>
                    <p className="mt-1">
                      <a
                        href="https://github.com/samanhappy/mcphub"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {t('about.viewOnGitHub')}
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={checkForUpdates}
              disabled={isChecking}
              className={`mt-4 inline-flex items-center px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium btn-secondary
                ${isChecking
                  ? 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800'
                  : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isChecking ? 'animate-spin' : ''}`} />
              {isChecking ? t('about.checking') : t('about.checkForUpdates')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutDialog;
