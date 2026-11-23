import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react';
import { useBranding } from '@/contexts/BrandingContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { apiPut } from '@/utils/fetchInterceptor';
import { cn } from '@/utils/cn';
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsToggleRow,
  settingsInputClass,
  settingsSelectClass,
} from './SettingsPrimitives';

const AVAILABLE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'vi', label: 'Tiếng Việt' },
];

interface GeneralSettingsSectionProps {
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const GeneralSettingsSection: React.FC<GeneralSettingsSectionProps> = ({
  highlightedSection,
  onDirtyChange,
}) => {
  const { t, i18n } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const { showToast } = useToast();
  const { dashboardName, setDashboardName } = useBranding();
  const {
    nameSeparator,
    normalizeToolNames,
    enableSessionRebuild,
    storeToolPayload,
    initialLoading,
  } = useRuntimeSettings();
  const {
    isSectionSaving,
    updateNameSeparator,
    updateNormalizeToolNames,
    updateSessionRebuild,
    updateStoreToolPayload,
  } = useSettingsActions();

  const [savingSystem, setSavingSystem] = useState(false);

  const remoteSystem = useMemo(
    () => ({
      dashboardName,
      nameSeparator,
    }),
    [dashboardName, nameSeparator],
  );

  const draft = useSettingsDraft(remoteSystem);

  useEffect(() => {
    onDirtyChange?.('system', draft.dirty);
    return () => onDirtyChange?.('system', false);
  }, [draft.dirty, onDirtyChange]);

  const currentLang =
    AVAILABLE_LANGUAGES.find((lang) => i18n.language?.startsWith(lang.code))?.code || 'en';

  const handleLanguageChange = (lang: string) => {
    localStorage.setItem('i18nextLng', lang);
    void i18n.changeLanguage(lang);
  };

  const handleSaveSystem = async () => {
    if (!draft.dirty) return;
    setSavingSystem(true);
    try {
      let allOk = true;

      if ('dashboardName' in draft.dirtyFields) {
        const trimmed = draft.values.dashboardName.trim();
        const result = await apiPut('/system-config', { dashboardName: trimmed });
        if (!result.success) {
          showToast(result.message || result.error || t('settings.dashboardNameSaveFailed'), 'error');
          allOk = false;
        } else {
          setDashboardName(trimmed);
          if (!('nameSeparator' in draft.dirtyFields)) {
            showToast(t('settings.systemConfigUpdated'), 'success');
          }
        }
      }

      if (allOk && 'nameSeparator' in draft.dirtyFields) {
        const ok = await updateNameSeparator(draft.values.nameSeparator);
        if (!ok) {
          allOk = false;
        }
      }

      if (allOk) {
        draft.discard();
      }
    } catch {
      showToast(t('settings.dashboardNameSaveFailed'), 'error');
    } finally {
      setSavingSystem(false);
    }
  };

  const systemBusy = initialLoading || savingSystem || isSectionSaving('nameSeparator');
  const togglesBusy =
    initialLoading ||
    isSectionSaving('normalizeToolNames') ||
    isSectionSaving('sessionRebuild') ||
    isSectionSaving('storeToolPayload');

  return (
    <div className="space-y-4">
      <SettingsCard
        id="appearance"
        title={t('pages.settings.appearance')}
        description={t('settings.appearanceDescription')}
        icon={<Palette size={15} />}
        highlighted={highlightedSection === 'appearance'}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <SettingsRow
            label={t('settings.themeLabel')}
            description={t('settings.themeDescription')}
          >
            <div className="inline-flex rounded-lg border border-[var(--hub-line)] bg-[var(--hub-surface)] p-0.5">
              <button
                type="button"
                onClick={() => setTheme('light')}
                aria-pressed={resolvedTheme === 'light'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  resolvedTheme === 'light'
                    ? 'bg-[var(--hub-ink)] text-[var(--hub-bg)]'
                    : 'text-[var(--hub-ink-2)] hover:text-[var(--hub-ink)]',
                )}
              >
                <Sun size={13} aria-hidden="true" />
                {t('theme.light')}
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                aria-pressed={resolvedTheme === 'dark'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  resolvedTheme === 'dark'
                    ? 'bg-[var(--hub-ink)] text-[var(--hub-bg)]'
                    : 'text-[var(--hub-ink-2)] hover:text-[var(--hub-ink)]',
                )}
              >
                <Moon size={13} aria-hidden="true" />
                {t('theme.dark')}
              </button>
            </div>
          </SettingsRow>

          <SettingsRow
            htmlFor="settings-language-select"
            label={
              <span className="inline-flex items-center gap-1.5">
                <Globe size={13} className="text-[var(--hub-ink-2)]" aria-hidden="true" />
                {t('pages.settings.language')}
              </span>
            }
            description={t('settings.languageDescription')}
          >
            <select
              id="settings-language-select"
              className={settingsSelectClass}
              value={currentLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
            >
              {AVAILABLE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </SettingsRow>
        </div>
      </SettingsCard>

      <PermissionChecker permissions={PERMISSIONS.SETTINGS_SYSTEM_CONFIG}>
        <SettingsCard
          id="system"
          title={t('settings.systemSettings')}
          description={t('settings.systemSettingsDescription')}
          icon={<SlidersHorizontal size={15} />}
          dirty={draft.dirty}
          highlighted={highlightedSection === 'system'}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <SettingsRow
              htmlFor="dashboard-name"
              label={t('settings.dashboardName')}
              description={t('settings.dashboardNameDescription')}
            >
              <input
                id="dashboard-name"
                value={draft.values.dashboardName}
                onChange={(e) => draft.setField('dashboardName', e.target.value)}
                maxLength={100}
                placeholder={t('app.title')}
                disabled={systemBusy}
                className={settingsInputClass}
              />
            </SettingsRow>

            <SettingsRow
              htmlFor="name-separator-input"
              label={t('settings.nameSeparatorLabel')}
              description={t('settings.nameSeparatorDescription')}
            >
              <input
                id="name-separator-input"
                type="text"
                value={draft.values.nameSeparator}
                onChange={(e) => draft.setField('nameSeparator', e.target.value)}
                placeholder="-"
                maxLength={5}
                disabled={systemBusy}
                className={cn(settingsInputClass, 'mono')}
              />
            </SettingsRow>
          </div>

          <SettingsSaveBar
            dirty={draft.dirty}
            saving={savingSystem || isSectionSaving('nameSeparator')}
            disabled={initialLoading}
            onSave={handleSaveSystem}
            onDiscard={draft.discard}
          />

          <div className="space-y-3 pt-1">
            <SettingsToggleRow
              id="normalize-tool-names"
              label={t('settings.normalizeToolNames')}
              description={t('settings.normalizeToolNamesDescription')}
              checked={normalizeToolNames}
              disabled={togglesBusy}
              onCheckedChange={(checked) => void updateNormalizeToolNames(checked)}
            />

            <SettingsToggleRow
              id="enable-session-rebuild"
              label={t('settings.enableSessionRebuild')}
              description={t('settings.enableSessionRebuildDescription')}
              checked={enableSessionRebuild}
              disabled={togglesBusy}
              onCheckedChange={(checked) => void updateSessionRebuild(checked)}
            />

            <SettingsToggleRow
              id="store-tool-payload"
              label={t('settings.storeToolPayload')}
              description={t('settings.storeToolPayloadDescription')}
              checked={storeToolPayload}
              disabled={togglesBusy}
              onCheckedChange={(checked) => void updateStoreToolPayload(checked)}
            />
          </div>
        </SettingsCard>
      </PermissionChecker>
    </div>
  );
};

export default GeneralSettingsSection;
