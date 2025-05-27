import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface SponsorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SponsorDialog: React.FC<SponsorDialogProps> = ({ open, onOpenChange }) => {
  const { i18n, t } = useTranslation();

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md w-full">
        <div className="p-6 relative">
          {/* Close button (X) in the top-right corner */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>

          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
            {t('sponsor.title')}
          </h3>

          <div className="flex flex-col items-center justify-center py-4">
            {i18n.language === 'zh' ? (
              <img
                src="./assets/reward.png"
                alt={t('sponsor.rewardAlt')}
                className="max-w-full h-auto"
                style={{ maxHeight: '400px' }}
              />
            ) : (
              <div className="text-center">
                <p className="mb-4 text-gray-700 dark:text-gray-300">{t('sponsor.supportMessage')}</p>
                <a
                  href="https://ko-fi.com/samanhappy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center bg-[#13C3FF] text-white px-4 py-2 rounded-md hover:bg-[#00A5E5] transition-colors"
                >
                  {t('sponsor.supportButton')}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SponsorDialog;
