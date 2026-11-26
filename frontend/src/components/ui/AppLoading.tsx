import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AppLoadingProps {
  fullScreen?: boolean;
}

const AppLoading: React.FC<AppLoadingProps> = ({ fullScreen = false }) => {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center justify-center ${fullScreen ? 'min-h-screen' : 'h-full min-h-[240px]'}`}
      style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-xl border border-[var(--hub-line)] bg-[var(--hub-surface)] px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--hub-ink-2)]">
          <Loader2 className="shrink-0 motion-safe:animate-spin" size={14} aria-hidden="true" />
          <span>{t('app.loading')}</span>
        </div>
      </div>
    </div>
  );
};

export default AppLoading;
