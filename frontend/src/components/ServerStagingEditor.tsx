import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Package } from 'lucide-react';
import type { Server } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useRuntimeSettings } from '@/hooks/useSettingsData';
import { useToast } from '@/contexts/ToastContext';
import { updateServerStaging } from '@/services/toolService';
import {
  buildServerStagingPayload,
  isServerStagingDirty,
  type StagingAdapterValue,
} from '@/utils/fileStaging';

interface ServerStagingEditorProps {
  server: Server;
  onSaved?: () => void;
}

const ServerStagingEditor = ({ server, onSaved }: ServerStagingEditorProps) => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const { fileStagingConfig } = useRuntimeSettings();
  const { showToast } = useToast();

  const isAdmin = auth.user?.isAdmin === true;
  const initialStaging = server.config?.staging;
  const initialAdapter: StagingAdapterValue = initialStaging?.adapter ?? '';
  const initialShared = Boolean(initialStaging?.shared);

  const [draftAdapter, setDraftAdapter] = useState<StagingAdapterValue>(initialAdapter);
  const [draftShared, setDraftShared] = useState<boolean>(initialShared);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftAdapter(initialAdapter);
    setDraftShared(initialShared);
    setError(null);
  }, [initialAdapter, initialShared, server.name]);

  const dirty = isServerStagingDirty(draftAdapter, draftShared, initialStaging, isAdmin);
  const cannotClearBecauseShared = !isAdmin && initialShared;
  const hasCredentialSlots = Boolean(server.config?.credentialTemplate?.length);

  const handleAdapterChange = (nextAdapter: StagingAdapterValue) => {
    setError(null);
    setDraftAdapter(nextAdapter);
    if (nextAdapter === '' && isAdmin && draftShared) {
      setDraftShared(false);
    }
  };

  const handleReset = () => {
    setDraftAdapter(initialAdapter);
    setDraftShared(initialShared);
    setError(null);
  };

  const handleSave = async () => {
    if (!dirty || isSaving) return;
    const payload = buildServerStagingPayload(draftAdapter, draftShared, initialStaging, isAdmin);
    if (Object.keys(payload).length === 0) return;

    setIsSaving(true);
    setError(null);
    try {
      const result = await updateServerStaging(server.name, payload);
      if (result.success) {
        showToast(t('server.stagingSaveSuccess'), 'success');
        onSaved?.();
      } else {
        setError(result.error || t('server.stagingSaveFailed'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="mb-3 rounded-lg border px-3 py-2.5"
      style={{
        background: 'var(--hub-surface)',
        borderColor: 'var(--hub-line)',
      }}
      onClick={(e) => e.stopPropagation()}
      aria-labelledby={`server-staging-title-${server.name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Package size={13} style={{ color: 'var(--hub-ink-3)' }} />
          <h3
            id={`server-staging-title-${server.name}`}
            className="text-[12px] font-medium m-0"
            style={{ color: 'var(--hub-ink)' }}
          >
            {t('server.stagingTitle')}
          </h3>
          {initialAdapter && (
            <span className="hub-tag accent" style={{ fontSize: 10.5 }}>
              {initialAdapter}
            </span>
          )}
          {!isAdmin && initialShared && (
            <span
              className="hub-tag"
              style={{ fontSize: 10.5 }}
              title={t('server.stagingSharedReadOnlyHint')}
            >
              {t('server.stagingSharedBadge')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="hub-btn sm"
            disabled={!dirty || isSaving}
            onClick={handleReset}
          >
            {t('common.reset')}
          </button>
          <button
            type="button"
            className="hub-btn primary sm"
            disabled={!dirty || isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>

      {isAdmin && !fileStagingConfig.enabled && (
        <div
          className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11.5px]"
          style={{
            background: 'var(--hub-bg-2)',
            borderColor: 'var(--hub-line)',
            color: 'var(--hub-ink-2)',
          }}
        >
          <span>{t('server.stagingGlobalDisabledBanner')}</span>
          <Link
            to="/settings?category=intelligence&section=file-staging"
            className="font-medium underline"
            style={{ color: 'var(--hub-accent)' }}
          >
            {t('server.stagingOpenGlobalSettings')}
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--hub-ink-2)' }}>
          <span>{t('server.stagingAdapterLabel')}</span>
          <select
            value={draftAdapter}
            disabled={isSaving}
            onChange={(e) => handleAdapterChange(e.target.value as StagingAdapterValue)}
            className="rounded-md border px-2 py-1 text-[12px] bg-[var(--hub-surface)] text-[var(--hub-ink)]"
            style={{ borderColor: 'var(--hub-line-2)' }}
            aria-label={t('server.stagingAdapterLabel')}
          >
            <option value="" disabled={cannotClearBecauseShared}>
              {t('server.stagingAdapterNone')}
            </option>
            <option value="ssh">{t('server.stagingAdapterSsh')}</option>
          </select>
        </label>

        {isAdmin ? (
          <label
            className="flex items-center gap-1.5 text-[12px]"
            style={{
              color: draftAdapter ? 'var(--hub-ink-2)' : 'var(--hub-ink-3)',
              cursor: draftAdapter && !isSaving ? 'pointer' : 'not-allowed',
            }}
          >
            <input
              type="checkbox"
              checked={draftShared}
              disabled={!draftAdapter || isSaving}
              onChange={(e) => {
                setError(null);
                setDraftShared(e.target.checked);
              }}
            />
            <span>{t('server.stagingSharedLabel')}</span>
          </label>
        ) : (
          <span className="text-[11.5px]" style={{ color: 'var(--hub-ink-3)' }}>
            {initialShared
              ? t('server.stagingSharedReadOnlyHint')
              : t('server.stagingSharedAdminOnly')}
          </span>
        )}
      </div>

      {isAdmin && draftShared && !hasCredentialSlots && (
        <div className="mt-1.5 text-[11.5px]" style={{ color: 'var(--hub-warn)' }}>
          {t('server.stagingSharedCredentialSlotsHint')}
        </div>
      )}

      <div className="mt-1.5 text-[11.5px]" style={{ color: 'var(--hub-ink-3)' }}>
        {t('server.stagingRestartNotice')}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px]"
          style={{
            borderColor: 'var(--hub-err)',
            color: 'var(--hub-err)',
            background: 'var(--hub-bg-2)',
          }}
        >
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
};

export default ServerStagingEditor;
