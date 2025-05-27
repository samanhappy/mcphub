import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface WeChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const WeChatDialog: React.FC<WeChatDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useTranslation();

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
            {t('wechat.title')}
          </h3>

          <div className="flex flex-col items-center justify-center py-4">
            <img
              src="./assets/wexin.png"
              alt={t('wechat.qrCodeAlt')}
              className="max-w-full h-auto"
              style={{ maxHeight: '400px' }}
            />
            <p className="mt-4 text-center text-gray-700 dark:text-gray-300">
              {t('wechat.scanMessage')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeChatDialog;
