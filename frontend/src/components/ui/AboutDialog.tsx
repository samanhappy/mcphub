import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { ChangelogUpdateInfo } from '@/types';
import {
  dismissUpdateVersion,
  fetchChangelogUpdateInfo,
  isUpdateDismissed,
} from '@/services/changelogService';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
  initialUpdateInfo?: ChangelogUpdateInfo | null;
  onUpdateInfoChange?: (info: ChangelogUpdateInfo | null) => void;
  onDismissUpdate?: (version: string) => void;
}

const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onClose,
  version,
  initialUpdateInfo,
  onUpdateInfoChange,
  onDismissUpdate,
}) => {
  const { t, i18n } = useTranslation();
  const [updateInfo, setUpdateInfo] = useState<ChangelogUpdateInfo | null>(
    initialUpdateInfo ?? null,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [localDismissed, setLocalDismissed] = useState(false);

  useEffect(() => {
    setUpdateInfo(initialUpdateInfo ?? null);
  }, [initialUpdateInfo]);

  useEffect(() => {
    setLocalDismissed(false);
  }, [updateInfo?.latestVersion]);

  const checkForUpdates = async (force = false) => {
    setIsChecking(true);
    try {
      const info = await fetchChangelogUpdateInfo({
        currentVersion: version,
        locale: i18n.language,
        force,
      });
      setUpdateInfo(info);
      onUpdateInfoChange?.(info);
    } catch (error) {
      console.error('Failed to check for updates:', error);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen && !updateInfo) {
      checkForUpdates(false);
    }
  }, [isOpen, updateInfo]);

  const latestEntry = updateInfo?.entries[0] ?? null;
  const hasNewVersion = Boolean(updateInfo?.hasUpdate && updateInfo.latestVersion);
  const dismissed = useMemo(
    () => localDismissed || isUpdateDismissed(updateInfo?.latestVersion),
    [localDismissed, updateInfo?.latestVersion],
  );
  const extraReleaseCount = Math.max(
    0,
    (updateInfo?.totalUpdateCount ?? 0) - (updateInfo?.entries.length ?? 0),
  );

  const handleDismiss = () => {
    if (!updateInfo?.latestVersion) return;
    dismissUpdateVersion(updateInfo.latestVersion);
    setLocalDismissed(true);
    onDismissUpdate?.(updateInfo.latestVersion);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="hub-card w-full max-w-[520px] shadow-xl">
        <div className="p-5 relative">
          <button
            onClick={onClose}
            className="hub-icon-btn sm absolute top-4 right-4"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="pr-8">
            <h3 className="hub-h1">{t('about.title')}</h3>
            <p className="hub-sub">{t('about.versionInfo', { version })}</p>
          </div>

          <div className="mt-5 space-y-4">
            {isChecking && !updateInfo ? (
              <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--hub-ink-2)' }}>
                <RefreshCw className="h-4 w-4 animate-spin" style={{ color: 'var(--hub-accent)' }} />
                {t('about.checking')}
              </div>
            ) : updateInfo?.source === 'disabled' ? (
              <div className="hub-card-pad rounded-md" style={{ background: 'var(--hub-bg-2)' }}>
                <p className="text-[13px]" style={{ color: 'var(--hub-ink-2)' }}>
                  {t('about.updateChecksDisabled')}
                </p>
              </div>
            ) : hasNewVersion ? (
              <div
                className="rounded-md border p-4"
                style={{
                  borderColor: 'var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="hub-mono text-[11px]" style={{ color: 'var(--hub-warn)' }}>
                      {t('about.newVersion')}
                    </div>
                    <div className="mt-1 text-[15px] font-medium" style={{ color: 'var(--hub-ink)' }}>
                      {t('about.newVersionAvailable', { version: updateInfo?.latestVersion })}
                    </div>
                  </div>
                  {dismissed ? (
                    <span className="hub-tag muted">{t('about.dismissed')}</span>
                  ) : (
                    <button className="hub-btn ghost sm" onClick={handleDismiss}>
                      {t('about.dismissUpdate')}
                    </button>
                  )}
                </div>

                {latestEntry?.summary ? (
                  <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--hub-ink-2)' }}>
                    {latestEntry.summary}
                  </p>
                ) : updateInfo?.source === 'npm-fallback' ? (
                  <p className="mt-3 text-[13px]" style={{ color: 'var(--hub-ink-2)' }}>
                    {t('about.releaseNotesUnavailable')}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--hub-ink-2)' }}>
                <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--hub-ok)' }} />
                {t('about.upToDate')}
              </div>
            )}

            {updateInfo?.entries.length ? (
              <div className="hub-card overflow-hidden">
                <div className="px-4 py-3 hub-border-b">
                  <h4 className="hub-card-title">{t('about.latestChanges')}</h4>
                </div>
                <div className="hub-divider">
                  {updateInfo.entries.map((entry) => (
                    <div key={entry.version} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="hub-mono text-[12px]" style={{ color: 'var(--hub-accent)' }}>
                            v{entry.version}
                          </div>
                          <div className="mt-1 text-[13px] font-medium" style={{ color: 'var(--hub-ink)' }}>
                            {entry.title}
                          </div>
                        </div>
                        <a
                          href={entry.changelogUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hub-icon-btn sm"
                          aria-label={t('about.viewReleaseNotes')}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      {entry.highlights.length > 0 && (
                        <ul className="mt-2 space-y-1 list-none p-0">
                          {entry.highlights.slice(0, 3).map((item) => (
                            <li key={item} className="text-[12.5px]" style={{ color: 'var(--hub-ink-2)' }}>
                              <span style={{ color: 'var(--hub-accent)' }}>•</span> {item}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                {extraReleaseCount > 0 && (
                  <div className="px-4 py-2 hub-border-t text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
                    {t('about.earlierReleases', { count: extraReleaseCount })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => checkForUpdates(true)}
                disabled={isChecking}
                className={`hub-btn ${isChecking ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
                {isChecking ? t('about.checking') : t('about.checkForUpdates')}
              </button>
              <a
                href={updateInfo?.changelogUrl || 'https://www.mcphub.app/changelog'}
                target="_blank"
                rel="noopener noreferrer"
                className="hub-btn primary"
              >
                {hasNewVersion ? t('about.viewReleaseNotes') : t('about.viewChangelog')}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              {latestEntry?.url && (
                <a
                  href={latestEntry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hub-btn ghost"
                >
                  {t('about.viewOnGitHub')}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutDialog;
