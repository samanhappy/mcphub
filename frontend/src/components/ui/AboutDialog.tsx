import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
}

const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose, version }) => {
  const { t } = useTranslation();
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const [latestVersion, setLatestVersion] = useState("");

  // Check if there's a new version available
  // In a real application, this would make an API call to check for updates
  useEffect(() => {
    if (isOpen) {
      // Mock implementation - in real implementation, you would fetch from an API
      const checkForUpdates = async () => {
        try {
          // This is a placeholder - in a real app you would call an API
          // const response = await fetch('/api/check-updates');
          // const data = await response.json();

          // For demo purposes, we'll just pretend there's a new version
          // TODO: Replace this placeholder logic with a real API call to check for updates
          setHasNewVersion(false);
          setLatestVersion("0.0.28"); // Just a higher version for demo
        } catch (error) {
          console.error('Failed to check for updates:', error);
        }
      };

      checkForUpdates();
    }
  }, [isOpen]);

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

            {hasNewVersion && (
              <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-600 dark:text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      {t('about.newVersion')} (v{latestVersion})
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutDialog;
