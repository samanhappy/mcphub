import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import type { FileStagingConfig } from '@/types';
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsStatusBadge,
  SettingsToggleRow,
  settingsInputClass,
} from './SettingsPrimitives';

type FileStagingFormValues = {
  maxFileMiB: string;
  inlineMaxMiB: string;
  perUserQuotaMiB: string;
  globalQuotaMiB: string;
  ttlHours: string;
  downloadTtlSeconds: string;
  uploadTtlSeconds: string;
  maxFilesPerUser: string;
  cleanupIntervalMinutes: string;
};

type FileStagingNumericField = Exclude<keyof FileStagingConfig, 'enabled'>;

interface FileStagingFieldSpec {
  formKey: keyof FileStagingFormValues;
  configField: FileStagingNumericField;
  labelKey: string;
  fallbackLabel: string;
  descKey: string;
  fallbackDesc: string;
  unit: number;
  min: number;
  max: number;
}

const FILE_STAGING_FIELDS: FileStagingFieldSpec[] = [
  {
    formKey: 'maxFileMiB',
    configField: 'maxFileBytes',
    labelKey: 'settings.fileStagingMaxFileSize',
    fallbackLabel: 'Maximum file size',
    descKey: 'settings.fileStagingMaxFileSizeDescription',
    fallbackDesc: 'Largest single file a tool may stage, in MiB.',
    unit: 1024 * 1024,
    min: 1,
    max: 2047,
  },
  {
    formKey: 'inlineMaxMiB',
    configField: 'inlineMaxBytes',
    labelKey: 'settings.fileStagingInlineMaxSize',
    fallbackLabel: 'Inline limit',
    descKey: 'settings.fileStagingInlineMaxSizeDescription',
    fallbackDesc: 'Files up to this size are inlined instead of written to storage, in MiB.',
    unit: 1024 * 1024,
    min: 1,
    max: 2047,
  },
  {
    formKey: 'perUserQuotaMiB',
    configField: 'perUserQuotaBytes',
    labelKey: 'settings.fileStagingPerUserQuota',
    fallbackLabel: 'Per-user quota',
    descKey: 'settings.fileStagingPerUserQuotaDescription',
    fallbackDesc: 'Total staged bytes each user may keep, in MiB.',
    unit: 1024 * 1024,
    min: 1,
    max: 2047,
  },
  {
    formKey: 'globalQuotaMiB',
    configField: 'globalQuotaBytes',
    labelKey: 'settings.fileStagingGlobalQuota',
    fallbackLabel: 'Global quota',
    descKey: 'settings.fileStagingGlobalQuotaDescription',
    fallbackDesc: 'Total staged bytes across all users, in MiB.',
    unit: 1024 * 1024,
    min: 1,
    max: 2047,
  },
  {
    formKey: 'ttlHours',
    configField: 'ttlHours',
    labelKey: 'settings.fileStagingTtlHours',
    fallbackLabel: 'Retention (hours)',
    descKey: 'settings.fileStagingTtlHoursDescription',
    fallbackDesc: 'How long staged files are kept before cleanup.',
    unit: 1,
    min: 1,
    max: 8760,
  },
  {
    formKey: 'downloadTtlSeconds',
    configField: 'downloadTtlSeconds',
    labelKey: 'settings.fileStagingDownloadTtl',
    fallbackLabel: 'Download link lifetime (seconds)',
    descKey: 'settings.fileStagingDownloadTtlDescription',
    fallbackDesc: 'Validity of a one-time download link, in seconds.',
    unit: 1,
    min: 10,
    max: 3600,
  },
  {
    formKey: 'uploadTtlSeconds',
    configField: 'uploadTtlSeconds',
    labelKey: 'settings.fileStagingUploadTtl',
    fallbackLabel: 'Upload link lifetime (seconds)',
    descKey: 'settings.fileStagingUploadTtlDescription',
    fallbackDesc: 'Validity of a one-time upload link, in seconds.',
    unit: 1,
    min: 60,
    max: 3600,
  },
  {
    formKey: 'maxFilesPerUser',
    configField: 'maxFilesPerUser',
    labelKey: 'settings.fileStagingMaxFilesPerUser',
    fallbackLabel: 'Max files per user',
    descKey: 'settings.fileStagingMaxFilesPerUserDescription',
    fallbackDesc: 'Maximum number of staged files each user may keep.',
    unit: 1,
    min: 1,
    max: 2147483647,
  },
  {
    formKey: 'cleanupIntervalMinutes',
    configField: 'cleanupIntervalMinutes',
    labelKey: 'settings.fileStagingCleanupInterval',
    fallbackLabel: 'Cleanup interval (minutes)',
    descKey: 'settings.fileStagingCleanupIntervalDescription',
    fallbackDesc: 'How often expired and over-quota files are purged.',
    unit: 1,
    min: 1,
    max: 1440,
  },
];

interface FileStagingSectionProps {
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const FileStagingSection: React.FC<FileStagingSectionProps> = ({
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { fileStagingConfig, initialLoading } = useRuntimeSettings();
  const { isSectionSaving, updateFileStagingConfigBatch } = useSettingsActions();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const remoteForm = useMemo<FileStagingFormValues>(
    () => ({
      maxFileMiB: String(fileStagingConfig.maxFileBytes / (1024 * 1024)),
      inlineMaxMiB: String(fileStagingConfig.inlineMaxBytes / (1024 * 1024)),
      perUserQuotaMiB: String(fileStagingConfig.perUserQuotaBytes / (1024 * 1024)),
      globalQuotaMiB: String(fileStagingConfig.globalQuotaBytes / (1024 * 1024)),
      ttlHours: String(fileStagingConfig.ttlHours),
      downloadTtlSeconds: String(fileStagingConfig.downloadTtlSeconds),
      uploadTtlSeconds: String(fileStagingConfig.uploadTtlSeconds),
      maxFilesPerUser: String(fileStagingConfig.maxFilesPerUser),
      cleanupIntervalMinutes: String(fileStagingConfig.cleanupIntervalMinutes),
    }),
    [fileStagingConfig],
  );

  const draft = useSettingsDraft(remoteForm);
  const saving = isSectionSaving('fileStaging');
  const busy = initialLoading || saving;

  useEffect(() => {
    onDirtyChange?.('file-staging', draft.dirty);
    return () => onDirtyChange?.('file-staging', false);
  }, [draft.dirty, onDirtyChange]);

  const setField = (key: keyof FileStagingFormValues, value: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    draft.setField(key, value);
  };

  const handleSave = async () => {
    const errors: Record<string, string> = {};
    const updates: Partial<FileStagingConfig> = {};

    for (const spec of FILE_STAGING_FIELDS) {
      if (!(spec.formKey in draft.dirtyFields)) {
        continue;
      }
      const label = t(spec.labelKey) || spec.fallbackLabel;
      const raw = draft.values[spec.formKey];
      const parsed = Number(raw);
      if (!raw.trim() || !Number.isFinite(parsed) || parsed <= 0) {
        errors[spec.formKey] = t('settings.validationPositiveInteger', { field: label });
        continue;
      }
      const floored = Math.floor(parsed);
      if (floored < spec.min || floored > spec.max) {
        errors[spec.formKey] = t('settings.validationRange', {
          field: label,
          min: spec.min,
          max: spec.max,
        });
        continue;
      }
      const nextValue = floored * spec.unit;
      if (nextValue !== fileStagingConfig[spec.configField]) {
        updates[spec.configField] = nextValue;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    if (Object.keys(updates).length === 0) {
      draft.discard();
      return;
    }

    const ok = await updateFileStagingConfigBatch(updates);
    if (ok) {
      draft.discard();
    }
  };

  return (
    <PermissionChecker permissions={PERMISSIONS.SETTINGS_SYSTEM_CONFIG}>
      <SettingsCard
        id="file-staging"
        title={t('settings.fileStagingTitle') || 'File Staging'}
        description={t('settings.fileStagingDescription')}
        icon={<Package size={15} />}
        badge={<SettingsStatusBadge active={fileStagingConfig.enabled} />}
        dirty={draft.dirty}
        highlighted={highlightedSection === 'file-staging'}
      >
        <SettingsToggleRow
          id="file-staging-enabled"
          label={t('settings.fileStagingEnable') || 'Enable file staging'}
          description={t('settings.fileStagingDescription')}
          checked={fileStagingConfig.enabled}
          disabled={busy}
          onCheckedChange={(checked) => void updateFileStagingConfigBatch({ enabled: checked })}
        />

        <div className="grid gap-3 md:grid-cols-2">
          {FILE_STAGING_FIELDS.map((spec) => (
            <SettingsRow
              key={spec.formKey}
              htmlFor={`file-staging-${spec.formKey}`}
              label={t(spec.labelKey) || spec.fallbackLabel}
              description={t(spec.descKey) || spec.fallbackDesc}
              error={fieldErrors[spec.formKey]}
            >
              <input
                id={`file-staging-${spec.formKey}`}
                type="number"
                min={spec.min}
                max={spec.max}
                step="1"
                value={draft.values[spec.formKey]}
                onChange={(e) => setField(spec.formKey, e.target.value)}
                className={settingsInputClass}
                disabled={busy}
              />
            </SettingsRow>
          ))}
        </div>

        <p className="text-xs text-[var(--hub-ink-3)]">
          {t('settings.fileStagingHelper') ||
            'Staging is opt-in per tool. Upload and download links are one-time only, and the hub stores staged files under its data volume.'}
        </p>

        <SettingsSaveBar
          dirty={draft.dirty}
          saving={saving}
          disabled={initialLoading}
          saveLabel={t('settings.fileStagingSave') || t('common.save')}
          onSave={handleSave}
          onDiscard={() => {
            setFieldErrors({});
            draft.discard();
          }}
        />
      </SettingsCard>
    </PermissionChecker>
  );
};

export default FileStagingSection;
