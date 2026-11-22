import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import type { ToolResultCompressionStrategy } from '@/contexts/settingsTypes';
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsStatusBadge,
  SettingsToggleRow,
  settingsInputClass,
  settingsSelectClass,
} from './SettingsPrimitives';

interface ToolResultCompressionSectionProps {
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const ToolResultCompressionSection: React.FC<ToolResultCompressionSectionProps> = ({
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { toolResultCompressionConfig } = useRuntimeSettings();
  const {
    isSectionSaving,
    updateToolResultCompressionConfig,
    updateToolResultCompressionConfigBatch,
  } = useSettingsActions();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const remoteForm = useMemo(
    () => ({
      minTokens: String(toolResultCompressionConfig.minTokens || 2000),
      maxOutputTokens: String(toolResultCompressionConfig.maxOutputTokens || 1200),
      strategy: (toolResultCompressionConfig.strategy || 'auto') as ToolResultCompressionStrategy,
    }),
    [toolResultCompressionConfig],
  );

  const draft = useSettingsDraft(remoteForm);
  const saving = isSectionSaving('toolResultCompression');

  useEffect(() => {
    onDirtyChange?.('tool-compression', draft.dirty);
    return () => onDirtyChange?.('tool-compression', false);
  }, [draft.dirty, onDirtyChange]);

  const setField = <K extends keyof typeof remoteForm>(key: K, value: (typeof remoteForm)[K]) => {
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
    const parsedMin = Number(draft.values.minTokens);
    const parsedMax = Number(draft.values.maxOutputTokens);

    if (!Number.isFinite(parsedMin) || parsedMin <= 0) {
      errors.minTokens = t('settings.validationPositiveInteger', {
        field: t('settings.toolResultCompressionMinTokens') || 'Minimum tokens',
      });
    }
    if (!Number.isFinite(parsedMax) || parsedMax <= 0) {
      errors.maxOutputTokens = t('settings.validationPositiveInteger', {
        field: t('settings.toolResultCompressionMaxOutputTokens') || 'Output token budget',
      });
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    const updates: Partial<typeof toolResultCompressionConfig> = {};
    const minTokens = Math.floor(parsedMin);
    const maxOutputTokens = Math.floor(parsedMax);

    if (minTokens !== toolResultCompressionConfig.minTokens) {
      updates.minTokens = minTokens;
    }
    if (maxOutputTokens !== toolResultCompressionConfig.maxOutputTokens) {
      updates.maxOutputTokens = maxOutputTokens;
    }
    if (draft.values.strategy !== toolResultCompressionConfig.strategy) {
      updates.strategy = draft.values.strategy;
    }

    if (Object.keys(updates).length === 0) {
      draft.discard();
      return;
    }

    const ok = await updateToolResultCompressionConfigBatch(updates);
    if (ok) {
      draft.discard();
    }
  };

  return (
    <PermissionChecker permissions={PERMISSIONS.SETTINGS_SMART_ROUTING}>
      <SettingsCard
        id="tool-compression"
        title={t('settings.toolResultCompressionTitle') || 'Tool Result Compression'}
        description={t('settings.toolResultCompressionDescription')}
        icon={<FileText size={15} />}
        badge={<SettingsStatusBadge active={toolResultCompressionConfig.enabled} />}
        dirty={draft.dirty}
        highlighted={highlightedSection === 'tool-compression'}
      >
        <SettingsToggleRow
          id="tool-compression-enabled"
          label={t('settings.toolResultCompressionEnable') || 'Enable compression'}
          description={t('settings.toolResultCompressionDescription')}
          checked={toolResultCompressionConfig.enabled}
          disabled={saving}
          onCheckedChange={(checked) =>
            void updateToolResultCompressionConfig('enabled', checked)
          }
        />

        <SettingsRow
          htmlFor="tool-compression-strategy"
          label={t('settings.toolResultCompressionStrategy') || 'Strategy'}
          description={t('settings.toolResultCompressionStrategyDescription')}
        >
          <select
            id="tool-compression-strategy"
            value={draft.values.strategy}
            onChange={(e) =>
              setField('strategy', e.target.value as ToolResultCompressionStrategy)
            }
            className={settingsSelectClass}
            disabled={saving}
          >
            <option value="auto">Auto</option>
            <option value="json">JSON</option>
            <option value="log">Log</option>
            <option value="search">Search</option>
            <option value="diff">Diff</option>
            <option value="text">Text</option>
          </select>
        </SettingsRow>

        <div className="grid gap-3 md:grid-cols-2">
          <SettingsRow
            htmlFor="tool-compression-min-tokens"
            label={t('settings.toolResultCompressionMinTokens') || 'Minimum tokens'}
            description={t('settings.toolResultCompressionMinTokensDescription')}
            error={fieldErrors.minTokens}
          >
            <input
              id="tool-compression-min-tokens"
              type="number"
              min="1"
              value={draft.values.minTokens}
              onChange={(e) => setField('minTokens', e.target.value)}
              className={settingsInputClass}
              disabled={saving}
            />
          </SettingsRow>

          <SettingsRow
            htmlFor="tool-compression-max-tokens"
            label={t('settings.toolResultCompressionMaxOutputTokens') || 'Output token budget'}
            description={t('settings.toolResultCompressionMaxOutputTokensDescription')}
            error={fieldErrors.maxOutputTokens}
          >
            <input
              id="tool-compression-max-tokens"
              type="number"
              min="1"
              value={draft.values.maxOutputTokens}
              onChange={(e) => setField('maxOutputTokens', e.target.value)}
              className={settingsInputClass}
              disabled={saving}
            />
          </SettingsRow>
        </div>

        <SettingsSaveBar
          dirty={draft.dirty}
          saving={saving}
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

export default ToolResultCompressionSection;
