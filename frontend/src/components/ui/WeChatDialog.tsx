import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface WeChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const WeChatDialog: React.FC<WeChatDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const dialog = (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-50 flex items-center justify-center p-4"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wechat-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="hub-card w-full max-w-sm overflow-hidden shadow-xl"
      >
        <div className="p-5 relative">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="hub-icon-btn sm absolute top-4 right-4"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>

          <h3 id="wechat-dialog-title" className="hub-h1 pr-8">
            {t('wechat.title')}
          </h3>

          <div className="mt-5 flex flex-col items-center justify-center">
            <div className="rounded-xl border border-[var(--hub-line)] bg-white p-3">
              <img
                src="./assets/wexin.png"
                alt={t('wechat.qrCodeAlt')}
                className="block max-w-full h-auto rounded-md"
                style={{ maxHeight: '300px' }}
              />
            </div>
            <p className="mt-3.5 text-center text-[13px] text-[var(--hub-ink-2)]">
              {t('wechat.scanMessage')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
};

export default WeChatDialog;
