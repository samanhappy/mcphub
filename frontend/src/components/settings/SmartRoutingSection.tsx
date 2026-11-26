import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Code as CodeIcon,
  Database,
  Route as RouteIcon,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { PermissionChecker } from '@/components/PermissionChecker';
import SmartRoutingIndexPanel from '@/components/SmartRoutingIndexPanel';
import { Switch } from '@/components/ui/ToggleGroup';
import { EndpointCopy } from '@/components/ui/EndpointCopy';
import { PERMISSIONS } from '@/constants/permissions';
import { useToast } from '@/contexts/ToastContext';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import { getSmartRoutingPath } from '@/utils/runtime';
import type { SmartRoutingConfig } from '@/contexts/settingsTypes';
import {
  SettingsAlert,
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsStatusBadge,
  SettingsToggleRow,
  settingsInputClass,
  settingsSelectClass,
} from './SettingsPrimitives';

function getDefaultTokenLimitForUI(model: string): number {
  const lower = model.toLowerCase();
  const MODEL_LIMITS: Array<[string, number]> = [
    ['text-embedding-3-small', 8191],
    ['text-embedding-3-large', 8191],
    ['text-embedding-ada-002', 8191],
    ['gemini-embedding-001', 2048],
    ['bge-m3', 8192],
  ];
  for (const [pattern, limit] of MODEL_LIMITS) {
    if (lower.includes(pattern)) return limit;
  }
  if (lower.includes('bge')) return 512;
  return 512;
}

type EmbeddingProviderPresetId = 'openai' | 'openrouter' | 'siliconflow' | 'gemini' | 'custom';

const EMBEDDING_PROVIDER_PRESETS: Record<
  EmbeddingProviderPresetId,
  { baseUrl?: string; model?: string }
> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'baai/bge-m3',
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'BAAI/bge-m3',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-embedding-001',
  },
  custom: {},
};

function getEmbeddingProviderPresetId(
  baseUrl: string,
  model: string,
): EmbeddingProviderPresetId {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  const normalizedModel = model.trim().toLowerCase();

  for (const [id, preset] of Object.entries(EMBEDDING_PROVIDER_PRESETS) as Array<
    [EmbeddingProviderPresetId, (typeof EMBEDDING_PROVIDER_PRESETS)[EmbeddingProviderPresetId]]
  >) {
    if (
      id !== 'custom' &&
      normalizedBaseUrl === preset.baseUrl?.replace(/\/+$/, '').toLowerCase() &&
      normalizedModel === preset.model?.toLowerCase()
    ) {
      return id;
    }
  }

  return 'custom';
}

function parseEmbeddingMaxTokensForUpdate(
  rawValue: string,
  currentValue: number | null | undefined,
): number | null | undefined {
  const trimmed = rawValue.trim();
  const parsed = trimmed ? parseInt(trimmed, 10) : NaN;
  const result = trimmed && !isNaN(parsed) ? parsed : null;
  const current = currentValue ?? null;
  return result !== current ? result : undefined;
}

function parseEmbeddingDimensionsForUpdate(
  rawValue: string,
  currentValue: number | null | undefined,
): number | null | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return currentValue == null ? undefined : null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed !== currentValue ? parsed : undefined;
}

function parseOptionalSearchSettingForUpdate(
  rawValue: string,
  currentValue: number | null | undefined,
  parse: (value: number) => boolean,
): number | null | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return currentValue == null ? undefined : null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !parse(parsed)) {
    return undefined;
  }
  return parsed !== currentValue ? parsed : undefined;
}

function parseBasePacingDelayForUpdate(
  rawValue: string,
  currentValue: number | null | undefined,
): number | null | undefined {
  const trimmed = rawValue.trim();
  const parsed = trimmed ? parseInt(trimmed, 10) : NaN;
  const result = trimmed && !isNaN(parsed) && parsed >= 0 ? parsed : null;
  const current = currentValue ?? null;
  return result !== current ? result : undefined;
}

const isSimilarityThreshold = (value: number) => value >= 0 && value <= 1;
const isFullSchemaTopN = (value: number) => Number.isInteger(value) && value >= 0;

const CODE_MODE_DEFAULTS = {
  enabled: false,
  readOnlyVariantEnabled: true,
  timeoutMs: 30000,
  cpuTimeoutMs: 5000,
  memoryLimitMb: 32,
  maxToolCalls: 20,
  maxSourceBytes: 32768,
  maxLogBytes: 16384,
  maxToolResultBytes: 524288,
  maxOutputBytes: 65536,
  maxConcurrentRuns: 4,
};

const CODE_MODE_LIMIT_RANGES = {
  timeoutMs: { min: 500, max: 120000 },
  cpuTimeoutMs: { min: 100, max: 30000 },
  memoryLimitMb: { min: 4, max: 256 },
  maxToolCalls: { min: 1, max: 100 },
  maxSourceBytes: { min: 256, max: 262144 },
  maxLogBytes: { min: 256, max: 131072 },
  maxToolResultBytes: { min: 4096, max: 4194304 },
  maxOutputBytes: { min: 1024, max: 1048576 },
  maxConcurrentRuns: { min: 1, max: 32 },
} as const;

type CodeModeLimitField = keyof typeof CODE_MODE_LIMIT_RANGES;

const TOOL_DEFINITION_FIELDS = [
  'title',
  'annotations',
  'outputSchema',
  'execution',
  'icons',
  '_meta',
] as const;
const DEFAULT_TOOL_DEFINITION_FIELDS: readonly string[] = ['title', 'annotations'];

type SmartRoutingFormValues = {
  dbUrl: string;
  basePacingDelayMs: string;
  embeddingProvider: 'openai' | 'azure_openai';
  embeddingProviderPreset: EmbeddingProviderPresetId;
  embeddingEncodingFormat: 'auto' | 'base64' | 'float';
  embeddingDimensions: string;
  llmProviderBaseUrl: string;
  llmProviderApiKey: string;
  embeddingModel: string;
  azureOpenaiEndpoint: string;
  azureOpenaiApiKey: string;
  azureOpenaiApiVersion: string;
  azureOpenaiEmbeddingDeployment: string;
  azureOpenaiEmbeddingModel: string;
  embeddingMaxTokens: string;
  embeddingQueryPrefix: string;
  embeddingDocumentPrefix: string;
  similarityThreshold: string;
  fullSchemaTopN: string;
  codeModeTimeoutMs: string;
  codeModeCpuTimeoutMs: string;
  codeModeMemoryLimitMb: string;
  codeModeMaxToolCalls: string;
  codeModeMaxSourceBytes: string;
  codeModeMaxLogBytes: string;
  codeModeMaxToolResultBytes: string;
  codeModeMaxOutputBytes: string;
  codeModeMaxConcurrentRuns: string;
};

interface SmartRoutingSectionProps {
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const SmartRoutingSection: React.FC<SmartRoutingSectionProps> = ({
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { smartRoutingConfig, installConfig, initialLoading } = useRuntimeSettings();
  const { isSectionSaving, updateSmartRoutingConfig, updateSmartRoutingConfigBatch } =
    useSettingsActions();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const remoteForm = useMemo<SmartRoutingFormValues>(
    () => ({
      dbUrl: smartRoutingConfig.dbUrl || '',
      basePacingDelayMs:
        smartRoutingConfig.basePacingDelayMs != null
          ? String(smartRoutingConfig.basePacingDelayMs)
          : '',
      embeddingProvider:
        smartRoutingConfig.embeddingProvider === 'azure_openai' ? 'azure_openai' : 'openai',
      embeddingProviderPreset: getEmbeddingProviderPresetId(
        smartRoutingConfig.llmProviderBaseUrl || '',
        smartRoutingConfig.embeddingModel || '',
      ),
      embeddingEncodingFormat:
        smartRoutingConfig.embeddingEncodingFormat === 'base64'
          ? 'base64'
          : smartRoutingConfig.embeddingEncodingFormat === 'float'
            ? 'float'
            : 'auto',
      embeddingDimensions:
        smartRoutingConfig.embeddingDimensions != null
          ? String(smartRoutingConfig.embeddingDimensions)
          : '',
      llmProviderBaseUrl: smartRoutingConfig.llmProviderBaseUrl || '',
      llmProviderApiKey: smartRoutingConfig.llmProviderApiKey || '',
      embeddingModel: smartRoutingConfig.embeddingModel || '',
      azureOpenaiEndpoint: smartRoutingConfig.azureOpenaiEndpoint || '',
      azureOpenaiApiKey: smartRoutingConfig.azureOpenaiApiKey || '',
      azureOpenaiApiVersion: smartRoutingConfig.azureOpenaiApiVersion || '2024-02-15-preview',
      azureOpenaiEmbeddingDeployment: smartRoutingConfig.azureOpenaiEmbeddingDeployment || '',
      azureOpenaiEmbeddingModel: smartRoutingConfig.azureOpenaiEmbeddingModel || '',
      embeddingMaxTokens:
        smartRoutingConfig.embeddingMaxTokens != null
          ? String(smartRoutingConfig.embeddingMaxTokens)
          : '',
      embeddingQueryPrefix: smartRoutingConfig.embeddingQueryPrefix || '',
      embeddingDocumentPrefix: smartRoutingConfig.embeddingDocumentPrefix || '',
      similarityThreshold:
        smartRoutingConfig.similarityThreshold != null
          ? String(smartRoutingConfig.similarityThreshold)
          : '',
      fullSchemaTopN:
        smartRoutingConfig.fullSchemaTopN != null ? String(smartRoutingConfig.fullSchemaTopN) : '',
      codeModeTimeoutMs: String(
        smartRoutingConfig.codeMode?.timeoutMs ?? CODE_MODE_DEFAULTS.timeoutMs,
      ),
      codeModeCpuTimeoutMs: String(
        smartRoutingConfig.codeMode?.cpuTimeoutMs ?? CODE_MODE_DEFAULTS.cpuTimeoutMs,
      ),
      codeModeMemoryLimitMb: String(
        smartRoutingConfig.codeMode?.memoryLimitMb ?? CODE_MODE_DEFAULTS.memoryLimitMb,
      ),
      codeModeMaxToolCalls: String(
        smartRoutingConfig.codeMode?.maxToolCalls ?? CODE_MODE_DEFAULTS.maxToolCalls,
      ),
      codeModeMaxSourceBytes: String(
        smartRoutingConfig.codeMode?.maxSourceBytes ?? CODE_MODE_DEFAULTS.maxSourceBytes,
      ),
      codeModeMaxLogBytes: String(
        smartRoutingConfig.codeMode?.maxLogBytes ?? CODE_MODE_DEFAULTS.maxLogBytes,
      ),
      codeModeMaxToolResultBytes: String(
        smartRoutingConfig.codeMode?.maxToolResultBytes ?? CODE_MODE_DEFAULTS.maxToolResultBytes,
      ),
      codeModeMaxOutputBytes: String(
        smartRoutingConfig.codeMode?.maxOutputBytes ?? CODE_MODE_DEFAULTS.maxOutputBytes,
      ),
      codeModeMaxConcurrentRuns: String(
        smartRoutingConfig.codeMode?.maxConcurrentRuns ?? CODE_MODE_DEFAULTS.maxConcurrentRuns,
      ),
    }),
    [smartRoutingConfig],
  );

  const draft = useSettingsDraft(remoteForm);
  const saving = isSectionSaving('smartRouting');
  const busy = initialLoading || saving;

  useEffect(() => {
    onDirtyChange?.('smart-routing', draft.dirty);
    return () => onDirtyChange?.('smart-routing', false);
  }, [draft.dirty, onDirtyChange]);

  const setField = <K extends keyof SmartRoutingFormValues>(
    key: K,
    value: SmartRoutingFormValues[K],
  ) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    if (key === 'llmProviderBaseUrl' || key === 'embeddingModel') {
      draft.patchFields({
        [key]: value,
        embeddingProviderPreset: 'custom',
      } as Partial<SmartRoutingFormValues>);
    } else {
      draft.setField(key, value);
    }
  };

  const handlePresetChange = (presetId: EmbeddingProviderPresetId) => {
    const preset = EMBEDDING_PROVIDER_PRESETS[presetId];
    draft.patchFields({
      embeddingProviderPreset: presetId,
      ...(preset.baseUrl ? { llmProviderBaseUrl: preset.baseUrl } : {}),
      ...(preset.model ? { embeddingModel: preset.model } : {}),
    });
  };

  const renderEnvOverrideWarning = (field: string) => {
    const envVar = smartRoutingConfig.envOverriddenFields?.find(
      (entry) => entry.field === field,
    )?.envVar;
    if (!envVar) return null;
    return (
      <p className="text-xs text-amber-700 dark:text-amber-400">
        {t('settings.smartRoutingEnvOverrideWarning', { envVar })}
      </p>
    );
  };

  const validateSearchSettings = (): boolean => {
    const errors: Record<string, string> = {};
    const invalidLabels: string[] = [];

    const threshold = draft.values.similarityThreshold.trim();
    if (threshold && !isSimilarityThreshold(Number(threshold))) {
      const label = t('settings.similarityThreshold');
      invalidLabels.push(label);
      errors.similarityThreshold = t('settings.validationRange', {
        field: label,
        min: 0,
        max: 1,
      });
    }

    const topN = draft.values.fullSchemaTopN.trim();
    if (topN && !isFullSchemaTopN(Number(topN))) {
      const label = t('settings.fullSchemaTopN');
      invalidLabels.push(label);
      errors.fullSchemaTopN = t('settings.invalidNumberInput');
    }

    const codeModeChecks: Array<[keyof SmartRoutingFormValues, CodeModeLimitField, string]> = [
      ['codeModeTimeoutMs', 'timeoutMs', t('settings.codeModeTimeoutMs')],
      ['codeModeCpuTimeoutMs', 'cpuTimeoutMs', t('settings.codeModeCpuTimeoutMs')],
      ['codeModeMemoryLimitMb', 'memoryLimitMb', t('settings.codeModeMemoryLimitMb')],
      ['codeModeMaxToolCalls', 'maxToolCalls', t('settings.codeModeMaxToolCalls')],
      ['codeModeMaxSourceBytes', 'maxSourceBytes', t('settings.codeModeMaxSourceBytes')],
      ['codeModeMaxLogBytes', 'maxLogBytes', t('settings.codeModeMaxLogBytes')],
      ['codeModeMaxToolResultBytes', 'maxToolResultBytes', t('settings.codeModeMaxToolResultBytes')],
      ['codeModeMaxOutputBytes', 'maxOutputBytes', t('settings.codeModeMaxOutputBytes')],
      ['codeModeMaxConcurrentRuns', 'maxConcurrentRuns', t('settings.codeModeMaxConcurrentRuns')],
    ];

    for (const [formKey, field, label] of codeModeChecks) {
      const raw = String(draft.values[formKey]).trim();
      const parsed = Number(raw);
      const { min, max } = CODE_MODE_LIMIT_RANGES[field];
      if (!raw || !Number.isInteger(parsed) || parsed < min || parsed > max) {
        invalidLabels.push(label);
        errors[formKey] = t('settings.validationRange', { field: label, min, max });
      }
    }

    if (invalidLabels.length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      showToast(t('settings.invalidSearchSettings', { fields: invalidLabels.join(', ') }), 'error');
      return false;
    }
    return true;
  };

  const buildUpdatesFromDraft = (): Partial<SmartRoutingConfig> => {
    const v = draft.values;
    const updates: Partial<SmartRoutingConfig> & Record<string, unknown> = {};

    if (v.dbUrl !== smartRoutingConfig.dbUrl) updates.dbUrl = v.dbUrl;
    const parsedBasePacingDelay = parseBasePacingDelayForUpdate(
      v.basePacingDelayMs,
      smartRoutingConfig.basePacingDelayMs,
    );
    if (parsedBasePacingDelay !== undefined) updates.basePacingDelayMs = parsedBasePacingDelay;

    if (v.embeddingProvider !== smartRoutingConfig.embeddingProvider) {
      updates.embeddingProvider = v.embeddingProvider;
    }
    if (v.embeddingEncodingFormat !== smartRoutingConfig.embeddingEncodingFormat) {
      updates.embeddingEncodingFormat = v.embeddingEncodingFormat;
    }
    if (v.llmProviderBaseUrl !== smartRoutingConfig.llmProviderBaseUrl) {
      updates.llmProviderBaseUrl = v.llmProviderBaseUrl;
    }
    if (v.llmProviderApiKey !== smartRoutingConfig.llmProviderApiKey) {
      updates.llmProviderApiKey = v.llmProviderApiKey;
    }
    if (v.embeddingModel !== smartRoutingConfig.embeddingModel) {
      updates.embeddingModel = v.embeddingModel;
    }
    if (v.azureOpenaiEndpoint !== smartRoutingConfig.azureOpenaiEndpoint) {
      updates.azureOpenaiEndpoint = v.azureOpenaiEndpoint;
    }
    if (v.azureOpenaiApiKey !== smartRoutingConfig.azureOpenaiApiKey) {
      updates.azureOpenaiApiKey = v.azureOpenaiApiKey;
    }
    if (v.azureOpenaiApiVersion !== smartRoutingConfig.azureOpenaiApiVersion) {
      updates.azureOpenaiApiVersion = v.azureOpenaiApiVersion;
    }
    if (v.azureOpenaiEmbeddingDeployment !== smartRoutingConfig.azureOpenaiEmbeddingDeployment) {
      updates.azureOpenaiEmbeddingDeployment = v.azureOpenaiEmbeddingDeployment;
    }
    if (v.azureOpenaiEmbeddingModel !== smartRoutingConfig.azureOpenaiEmbeddingModel) {
      updates.azureOpenaiEmbeddingModel = v.azureOpenaiEmbeddingModel;
    }
    if (v.embeddingQueryPrefix !== (smartRoutingConfig.embeddingQueryPrefix || '')) {
      updates.embeddingQueryPrefix = v.embeddingQueryPrefix;
    }
    if (v.embeddingDocumentPrefix !== (smartRoutingConfig.embeddingDocumentPrefix || '')) {
      updates.embeddingDocumentPrefix = v.embeddingDocumentPrefix;
    }

    const parsedTokens = parseEmbeddingMaxTokensForUpdate(
      v.embeddingMaxTokens,
      smartRoutingConfig.embeddingMaxTokens,
    );
    if (parsedTokens !== undefined) updates.embeddingMaxTokens = parsedTokens;

    const parsedDimensions = parseEmbeddingDimensionsForUpdate(
      v.embeddingDimensions,
      smartRoutingConfig.embeddingDimensions,
    );
    if (parsedDimensions !== undefined) updates.embeddingDimensions = parsedDimensions;

    const parsedThreshold = parseOptionalSearchSettingForUpdate(
      v.similarityThreshold,
      smartRoutingConfig.similarityThreshold,
      isSimilarityThreshold,
    );
    if (parsedThreshold !== undefined) updates.similarityThreshold = parsedThreshold;

    const parsedTopN = parseOptionalSearchSettingForUpdate(
      v.fullSchemaTopN,
      smartRoutingConfig.fullSchemaTopN,
      isFullSchemaTopN,
    );
    if (parsedTopN !== undefined) updates.fullSchemaTopN = parsedTopN;

    const currentCodeMode = smartRoutingConfig.codeMode ?? CODE_MODE_DEFAULTS;
    const codeModeDiff: Record<string, number> = {};
    const codeModeMap: Array<[keyof SmartRoutingFormValues, CodeModeLimitField]> = [
      ['codeModeTimeoutMs', 'timeoutMs'],
      ['codeModeCpuTimeoutMs', 'cpuTimeoutMs'],
      ['codeModeMemoryLimitMb', 'memoryLimitMb'],
      ['codeModeMaxToolCalls', 'maxToolCalls'],
      ['codeModeMaxSourceBytes', 'maxSourceBytes'],
      ['codeModeMaxLogBytes', 'maxLogBytes'],
      ['codeModeMaxToolResultBytes', 'maxToolResultBytes'],
      ['codeModeMaxOutputBytes', 'maxOutputBytes'],
      ['codeModeMaxConcurrentRuns', 'maxConcurrentRuns'],
    ];
    for (const [formKey, field] of codeModeMap) {
      const parsed = Number(String(v[formKey]).trim());
      if (Number.isInteger(parsed) && parsed !== currentCodeMode[field]) {
        codeModeDiff[field] = parsed;
      }
    }
    if (Object.keys(codeModeDiff).length > 0) {
      updates.codeMode = { ...currentCodeMode, ...codeModeDiff };
    }

    return updates;
  };

  const handleEnabledChange = async (value: boolean) => {
    if (!value) {
      await updateSmartRoutingConfig('enabled', false);
      return;
    }

    const v = draft.values;
    const currentDbUrl = v.dbUrl || smartRoutingConfig.dbUrl;
    const missingFields: string[] = [];
    if (!currentDbUrl) missingFields.push(t('settings.dbUrl') || 'Database URL');

    if (v.embeddingProvider === 'azure_openai') {
      const endpoint = v.azureOpenaiEndpoint || smartRoutingConfig.azureOpenaiEndpoint;
      const key = v.azureOpenaiApiKey || smartRoutingConfig.azureOpenaiApiKey;
      const apiVersion = v.azureOpenaiApiVersion || smartRoutingConfig.azureOpenaiApiVersion;
      const deployment =
        v.azureOpenaiEmbeddingDeployment || smartRoutingConfig.azureOpenaiEmbeddingDeployment;
      if (!endpoint || !key || !apiVersion || !deployment) {
        missingFields.push(
          t('settings.azureOpenaiEndpoint') || 'Azure OpenAI Endpoint',
          t('settings.azureOpenaiApiKey') || 'Azure OpenAI API Key',
          t('settings.azureOpenaiApiVersion') || 'Azure OpenAI API Version',
          t('settings.azureOpenaiEmbeddingDeployment') || 'Azure Embedding Deployment',
        );
      }
    } else {
      const apiKey = (v.llmProviderApiKey || smartRoutingConfig.llmProviderApiKey || '').trim();
      const baseUrl = (v.llmProviderBaseUrl || smartRoutingConfig.llmProviderBaseUrl || '').trim();
      const model = (v.embeddingModel || smartRoutingConfig.embeddingModel || '').trim();
      if (!apiKey) missingFields.push(t('settings.llmProviderApiKey') || 'OpenAI API Key');
      if (!baseUrl) missingFields.push(t('settings.llmProviderBaseUrl') || 'OpenAI API Base URL');
      if (!model) missingFields.push(t('settings.embeddingModel') || 'OpenAI Embedding Model');
    }

    if (missingFields.length > 0) {
      showToast(
        t('settings.smartRoutingValidationError', { fields: missingFields.join(', ') }),
        'error',
      );
      return;
    }

    if (!validateSearchSettings()) return;

    const updates = { enabled: true, ...buildUpdatesFromDraft() };
    const ok = await updateSmartRoutingConfigBatch(updates);
    if (ok) {
      setFieldErrors({});
      draft.discard();
    }
  };

  const handleSave = async () => {
    if (!validateSearchSettings()) return;
    const updates = buildUpdatesFromDraft();
    if (Object.keys(updates).length === 0) {
      draft.discard();
      return;
    }
    const ok = await updateSmartRoutingConfigBatch(updates);
    if (ok) {
      setFieldErrors({});
      draft.discard();
    }
  };

  const embeddingModelName =
    (draft.values.embeddingProvider === 'azure_openai'
      ? draft.values.azureOpenaiEmbeddingModel || smartRoutingConfig.azureOpenaiEmbeddingModel
      : draft.values.embeddingModel || smartRoutingConfig.embeddingModel) ||
    'text-embedding-3-small';

  return (
    <PermissionChecker permissions={PERMISSIONS.SETTINGS_SMART_ROUTING}>
      <SettingsCard
        id="smart-routing"
        title={t('pages.settings.smartRouting')}
        description={t('settings.enableSmartRoutingDescription')}
        icon={<RouteIcon size={15} />}
        badge={<SettingsStatusBadge active={smartRoutingConfig.enabled} />}
        dirty={draft.dirty}
        highlighted={highlightedSection === 'smart-routing'}
      >
        {/* Status banner */}
        <div className="rounded-lg border border-[var(--hub-line)] bg-[var(--hub-bg-2)] p-4">
          <div className="grid items-center gap-4 lg:grid-cols-[1.1fr_1px_1.4fr_1px_auto]">
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 shrink-0">
                <div
                  className="grid h-full w-full place-items-center rounded-md border border-[var(--hub-line)]"
                  style={{
                    background: smartRoutingConfig.enabled
                      ? 'oklch(0.95 0.05 145)'
                      : 'var(--hub-surface)',
                  }}
                >
                  <RouteIcon
                    size={18}
                    style={{
                      color: smartRoutingConfig.enabled
                        ? 'oklch(0.4 0.13 145)'
                        : 'var(--hub-ink-3)',
                    }}
                  />
                </div>
                {smartRoutingConfig.enabled && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full"
                    style={{
                      background: 'var(--hub-ok)',
                      boxShadow: '0 0 0 2px var(--hub-surface)',
                    }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-[var(--hub-ink)]">
                  {smartRoutingConfig.enabled ? t('common.active') : t('common.inactive')}
                </div>
                <div className="text-xs text-[var(--hub-ink-3)]">
                  {t('settings.enableSmartRoutingDescription')}
                </div>
              </div>
            </div>

            <div className="hidden h-9 bg-[var(--hub-line)] lg:block" />

            <div className="min-w-0">
              <div className="hub-sect mb-1.5">smart endpoint</div>
              <EndpointCopy
                label="SMART"
                url={`${(installConfig.baseUrl || '').replace(/\/+$/, '')}/mcp/${getSmartRoutingPath()}`}
              />
            </div>

            <div className="hidden h-9 bg-[var(--hub-line)] lg:block" />

            <div className="flex items-center justify-between gap-2 lg:justify-end">
              <span className="text-xs font-medium text-[var(--hub-ink-2)]">
                {t('settings.enableSmartRouting')}
              </span>
              <Switch
                disabled={busy}
                checked={smartRoutingConfig.enabled}
                onCheckedChange={(checked) => void handleEnabledChange(checked)}
              />
            </div>
          </div>
        </div>

        {/* Workflow diagram */}
        <div className="rounded-lg border border-[var(--hub-line)] bg-[var(--hub-surface)] p-4">
          <h3 className="hub-card-title mb-1">{t('settings.smartRoutingWorkflow') || 'Workflow'}</h3>
          <p className="mb-4 text-xs text-[var(--hub-ink-3)]">
            {t('settings.smartRoutingWorkflowDescription') ||
              'Prompt is embedded, top-k similar tools are retrieved from pgvector, only relevant tools are exposed.'}
          </p>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[520px] items-center"
              style={{ gridTemplateColumns: 'repeat(9, 1fr)' }}
            >
              {[
                { icon: <CodeIcon size={16} />, title: 'Prompt', sub: 'client' },
                null,
                { icon: <Zap size={16} />, title: 'Embedding', sub: 'openai · 1536d' },
                null,
                { icon: <Database size={16} />, title: 'pgvector', sub: 'ann · cosine' },
                null,
                { icon: <Wrench size={16} />, title: 'Top-K', sub: 'score > 0.7' },
                null,
                { icon: <Sparkles size={16} />, title: 'LLM', sub: 'relevant subset' },
              ].map((step, i) =>
                step === null ? (
                  <div key={`sep-${i}`} className="flex justify-center">
                    <svg width="100%" height="20" preserveAspectRatio="none" viewBox="0 0 100 20">
                      <line
                        x1="4"
                        y1="10"
                        x2="96"
                        y2="10"
                        stroke="var(--hub-line)"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <polygon points="96,10 88,6 88,14" fill="var(--hub-ink-3)" />
                    </svg>
                  </div>
                ) : (
                  <div key={step.title} className="flex flex-col items-center gap-1.5">
                    <div className="grid h-10 w-10 place-items-center rounded-[10px] border border-[var(--hub-line)] bg-[var(--hub-bg-2)] text-[var(--hub-ink)]">
                      {step.icon}
                    </div>
                    <div className="text-center">
                      <div className="text-xs font-medium text-[var(--hub-ink)]">{step.title}</div>
                      <div className="hub-mono text-[10.5px] text-[var(--hub-ink-3)]">
                        {step.sub}
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>

        <SettingsAlert variant="info">{t('settings.smartRoutingRequiredFields')}</SettingsAlert>

        <div className="space-y-3">
          {smartRoutingConfig.dbUrl !== '${DB_URL}' && (
            <SettingsRow htmlFor="sr-db-url" label={t('settings.dbUrl')} required>
              <input
                id="sr-db-url"
                type="text"
                value={draft.values.dbUrl}
                onChange={(e) => setField('dbUrl', e.target.value)}
                placeholder={t('settings.dbUrlPlaceholder')}
                className={`${settingsInputClass} mono`}
                disabled={busy}
              />
            </SettingsRow>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsRow
              htmlFor="sr-embedding-provider"
              label={t('settings.embeddingProvider') || 'Embedding Provider'}
            >
              <select
                id="sr-embedding-provider"
                className={settingsSelectClass}
                value={draft.values.embeddingProvider}
                onChange={(e) =>
                  setField('embeddingProvider', e.target.value as 'openai' | 'azure_openai')
                }
                disabled={busy}
              >
                <option value="openai">OpenAI (or compatible)</option>
                <option value="azure_openai">Azure OpenAI</option>
              </select>
            </SettingsRow>

            {draft.values.embeddingProvider === 'openai' && (
              <SettingsRow
                htmlFor="sr-provider-preset"
                label={t('settings.embeddingProviderPreset') || 'Provider Preset'}
                description={t('settings.embeddingProviderPresetDescription')}
              >
                <select
                  id="sr-provider-preset"
                  value={draft.values.embeddingProviderPreset}
                  onChange={(e) =>
                    handlePresetChange(e.target.value as EmbeddingProviderPresetId)
                  }
                  className={settingsSelectClass}
                  disabled={busy}
                >
                  <option value="openai">
                    {t('settings.embeddingProviderPresetOpenai') || 'OpenAI'}
                  </option>
                  <option value="openrouter">
                    {t('settings.embeddingProviderPresetOpenrouter') || 'OpenRouter'}
                  </option>
                  <option value="siliconflow">
                    {t('settings.embeddingProviderPresetSiliconflow') || 'SiliconFlow · free tier'}
                  </option>
                  <option value="gemini">
                    {t('settings.embeddingProviderPresetGemini') || 'Google Gemini · free tier'}
                  </option>
                  <option value="custom">
                    {t('settings.embeddingProviderPresetCustom') || 'Other / OpenAI-compatible'}
                  </option>
                </select>
              </SettingsRow>
            )}
          </div>

          {draft.values.embeddingProvider === 'openai' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <SettingsRow
                htmlFor="sr-openai-key"
                label={t('settings.llmProviderApiKey')}
                required
                warning={renderEnvOverrideWarning('llmProviderApiKey')}
              >
                <input
                  id="sr-openai-key"
                  type="password"
                  value={draft.values.llmProviderApiKey}
                  onChange={(e) => setField('llmProviderApiKey', e.target.value)}
                  placeholder={t('settings.llmProviderApiKeyPlaceholder')}
                  className={settingsInputClass}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="sr-openai-model"
                label={t('settings.embeddingModel')}
                required
                warning={renderEnvOverrideWarning('embeddingModel')}
              >
                <input
                  id="sr-openai-model"
                  type="text"
                  value={draft.values.embeddingModel}
                  onChange={(e) => setField('embeddingModel', e.target.value)}
                  placeholder={t('settings.embeddingModelPlaceholder')}
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                  required
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="sr-openai-base-url"
                label={t('settings.llmProviderBaseUrl')}
                required
                warning={renderEnvOverrideWarning('llmProviderBaseUrl')}
                className="md:col-span-2"
              >
                <input
                  id="sr-openai-base-url"
                  type="text"
                  value={draft.values.llmProviderBaseUrl}
                  onChange={(e) => setField('llmProviderBaseUrl', e.target.value)}
                  placeholder={t('settings.llmProviderBaseUrlPlaceholder')}
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                  required
                />
              </SettingsRow>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <SettingsRow
                htmlFor="sr-azure-endpoint"
                label={t('settings.azureOpenaiEndpoint') || 'Azure OpenAI Endpoint'}
                required
                warning={renderEnvOverrideWarning('azureOpenaiEndpoint')}
              >
                <input
                  id="sr-azure-endpoint"
                  type="text"
                  value={draft.values.azureOpenaiEndpoint}
                  onChange={(e) => setField('azureOpenaiEndpoint', e.target.value)}
                  placeholder={
                    t('settings.azureOpenaiEndpointPlaceholder') ||
                    'https://YOUR_RESOURCE_NAME.openai.azure.com'
                  }
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="sr-azure-key"
                label={t('settings.azureOpenaiApiKey') || 'Azure OpenAI API Key'}
                required
                warning={renderEnvOverrideWarning('azureOpenaiApiKey')}
              >
                <input
                  id="sr-azure-key"
                  type="password"
                  value={draft.values.azureOpenaiApiKey}
                  onChange={(e) => setField('azureOpenaiApiKey', e.target.value)}
                  placeholder={t('settings.azureOpenaiApiKeyPlaceholder') || '***'}
                  className={settingsInputClass}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="sr-azure-version"
                label={t('settings.azureOpenaiApiVersion') || 'Azure OpenAI API Version'}
                required
              >
                <input
                  id="sr-azure-version"
                  type="text"
                  value={draft.values.azureOpenaiApiVersion}
                  onChange={(e) => setField('azureOpenaiApiVersion', e.target.value)}
                  placeholder={
                    t('settings.azureOpenaiApiVersionPlaceholder') || '2024-02-15-preview'
                  }
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="sr-azure-deployment"
                label={t('settings.azureOpenaiEmbeddingDeployment') || 'Azure Embedding Deployment'}
                required
              >
                <input
                  id="sr-azure-deployment"
                  type="text"
                  value={draft.values.azureOpenaiEmbeddingDeployment}
                  onChange={(e) => setField('azureOpenaiEmbeddingDeployment', e.target.value)}
                  placeholder={
                    t('settings.azureOpenaiEmbeddingDeploymentPlaceholder') ||
                    'your-embedding-deployment-name'
                  }
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="sr-azure-model"
                label={t('settings.azureOpenaiEmbeddingModel') || 'Azure Embedding Model Name'}
                description={t('settings.azureOpenaiEmbeddingModelDescription')}
                required
                className="md:col-span-2"
              >
                <input
                  id="sr-azure-model"
                  type="text"
                  value={draft.values.azureOpenaiEmbeddingModel}
                  onChange={(e) => setField('azureOpenaiEmbeddingModel', e.target.value)}
                  placeholder={
                    t('settings.azureOpenaiEmbeddingModelPlaceholder') || 'text-embedding-3-small'
                  }
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                  required
                />
              </SettingsRow>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsRow
              htmlFor="sr-embedding-dimensions"
              label={t('settings.embeddingDimensions') || 'Embedding Dimensions'}
              description={t('settings.embeddingDimensionsDescription')}
            >
              <input
                id="sr-embedding-dimensions"
                type="number"
                min="1"
                step="1"
                value={draft.values.embeddingDimensions}
                onChange={(e) => setField('embeddingDimensions', e.target.value)}
                placeholder={t('settings.embeddingDimensionsPlaceholder') || 'Empty = model default'}
                className={settingsInputClass}
                disabled={busy}
              />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--hub-line-2)] pt-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[var(--hub-ink)]">
                    {t('settings.embeddingDimensionsApiPassthrough') ||
                      'Forward dimensions to API (MRL passthrough)'}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--hub-ink-3)]">
                    {t('settings.embeddingDimensionsApiPassthroughDescription')}
                  </p>
                </div>
                <Switch
                  disabled={busy || !smartRoutingConfig.enabled}
                  checked={smartRoutingConfig.embeddingDimensionsApiPassthrough}
                  onCheckedChange={(checked) =>
                    void updateSmartRoutingConfig('embeddingDimensionsApiPassthrough', checked)
                  }
                />
              </div>
            </SettingsRow>

            <SettingsRow
              htmlFor="sr-base-pacing-delay"
              label={t('settings.basePacingDelayMs')}
              description={t('settings.basePacingDelayMsDescription')}
            >
              <input
                id="sr-base-pacing-delay"
                type="number"
                min="0"
                step="1000"
                value={draft.values.basePacingDelayMs}
                onChange={(e) => setField('basePacingDelayMs', e.target.value)}
                placeholder={t('settings.basePacingDelayMsPlaceholder') || 'Empty = default 0 ms'}
                className={settingsInputClass}
                disabled={busy}
              />
              <p className="mt-2 text-xs text-[var(--hub-ink-3)]">
                {(() => {
                  const trimmedValue = draft.values.basePacingDelayMs.trim();
                  if (!trimmedValue) return t('settings.basePacingDelayMsAuto', { value: 0 });
                  if (trimmedValue === '0') return t('settings.basePacingDelayMsZero');
                  return t('settings.basePacingDelayMsOverride');
                })()}
              </p>
            </SettingsRow>

            <SettingsRow
              htmlFor="sr-encoding-format"
              label={t('settings.embeddingEncodingFormat')}
              description={t('settings.embeddingEncodingFormatDescription')}
            >
              <select
                id="sr-encoding-format"
                value={draft.values.embeddingEncodingFormat}
                onChange={(e) =>
                  setField(
                    'embeddingEncodingFormat',
                    e.target.value as 'auto' | 'base64' | 'float',
                  )
                }
                className={settingsSelectClass}
                disabled={busy}
              >
                <option value="auto">{t('settings.embeddingEncodingFormatAuto') || 'Auto'}</option>
                <option value="base64">Base64</option>
                <option value="float">Float</option>
              </select>
            </SettingsRow>

            <SettingsRow
              htmlFor="sr-max-tokens"
              label={t('settings.embeddingMaxTokens')}
              description={t('settings.embeddingMaxTokensDescription')}
            >
              <input
                id="sr-max-tokens"
                type="number"
                min="1"
                value={draft.values.embeddingMaxTokens}
                onChange={(e) => setField('embeddingMaxTokens', e.target.value)}
                placeholder={t('settings.embeddingMaxTokensPlaceholder') || 'Empty = auto by model'}
                className={settingsInputClass}
                disabled={busy}
              />
              <p className="mt-2 text-xs text-[var(--hub-ink-3)]">
                {draft.values.embeddingMaxTokens.trim()
                  ? t('settings.embeddingMaxTokensOverride')
                  : t('settings.embeddingMaxTokensAuto', {
                      limit: getDefaultTokenLimitForUI(embeddingModelName),
                      model: embeddingModelName,
                    })}
              </p>
            </SettingsRow>
          </div>

          <SettingsRow
            label={t('settings.embeddingPrefixes')}
            description={t('settings.embeddingPrefixesDescription')}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="embeddingQueryPrefix"
                  className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]"
                >
                  {t('settings.embeddingQueryPrefix')}
                </label>
                <input
                  id="embeddingQueryPrefix"
                  type="text"
                  value={draft.values.embeddingQueryPrefix}
                  onChange={(e) => setField('embeddingQueryPrefix', e.target.value)}
                  placeholder="task: search result | query: "
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
                {renderEnvOverrideWarning('embeddingQueryPrefix')}
              </div>

              <div>
                <label
                  htmlFor="embeddingDocumentPrefix"
                  className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]"
                >
                  {t('settings.embeddingDocumentPrefix')}
                </label>
                <input
                  id="embeddingDocumentPrefix"
                  type="text"
                  value={draft.values.embeddingDocumentPrefix}
                  onChange={(e) => setField('embeddingDocumentPrefix', e.target.value)}
                  placeholder="title: none | text: "
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
                {renderEnvOverrideWarning('embeddingDocumentPrefix')}
              </div>
            </div>
          </SettingsRow>

          <SettingsRow
            label={t('settings.searchResults')}
            description={t('settings.searchResultsDescription')}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="similarityThreshold"
                  className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]"
                >
                  {t('settings.similarityThreshold')}
                </label>
                <input
                  id="similarityThreshold"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={draft.values.similarityThreshold}
                  onChange={(e) => setField('similarityThreshold', e.target.value)}
                  placeholder={t('settings.similarityThresholdPlaceholder')}
                  className={settingsInputClass}
                  disabled={busy}
                />
                {fieldErrors.similarityThreshold && (
                  <p role="alert" className="mt-1 text-xs text-[var(--hub-err)]">
                    {fieldErrors.similarityThreshold}
                  </p>
                )}
                {renderEnvOverrideWarning('similarityThreshold')}
              </div>

              <div>
                <label
                  htmlFor="fullSchemaTopN"
                  className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]"
                >
                  {t('settings.fullSchemaTopN')}
                </label>
                <input
                  id="fullSchemaTopN"
                  type="number"
                  min="0"
                  step="1"
                  value={draft.values.fullSchemaTopN}
                  onChange={(e) => setField('fullSchemaTopN', e.target.value)}
                  placeholder={t('settings.fullSchemaTopNPlaceholder')}
                  className={settingsInputClass}
                  disabled={busy}
                />
                {fieldErrors.fullSchemaTopN && (
                  <p role="alert" className="mt-1 text-xs text-[var(--hub-err)]">
                    {fieldErrors.fullSchemaTopN}
                  </p>
                )}
                {renderEnvOverrideWarning('fullSchemaTopN')}
              </div>
            </div>

            <div className="mt-3 border-t border-[var(--hub-line-2)] pt-3">
              <p className="text-xs font-medium text-[var(--hub-ink-2)]">
                {t('settings.toolDefinitionFields')}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {TOOL_DEFINITION_FIELDS.map((field) => {
                  const selected =
                    smartRoutingConfig.toolDefinitionFields ?? DEFAULT_TOOL_DEFINITION_FIELDS;
                  return (
                    <label
                      key={field}
                      className="hub-mono flex items-center gap-1.5 text-xs text-[var(--hub-ink)]"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[var(--hub-accent)]"
                        checked={selected.includes(field)}
                        onChange={(e) =>
                          void updateSmartRoutingConfig(
                            'toolDefinitionFields',
                            TOOL_DEFINITION_FIELDS.filter((name) =>
                              name === field ? e.target.checked : selected.includes(name),
                            ),
                          )
                        }
                        disabled={busy}
                      />
                      {field}
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-[var(--hub-ink-3)]">
                {t('settings.toolDefinitionFieldsDescription')}
              </p>
              {renderEnvOverrideWarning('toolDefinitionFields')}
            </div>
          </SettingsRow>

          <SettingsToggleRow
            id="sr-progressive-disclosure"
            label={t('settings.progressiveDisclosure')}
            description={t('settings.progressiveDisclosureDescription')}
            checked={smartRoutingConfig.progressiveDisclosure}
            disabled={busy || !smartRoutingConfig.enabled}
            onCheckedChange={(checked) =>
              void updateSmartRoutingConfig('progressiveDisclosure', checked)
            }
          />

          <SettingsRow
            label={t('settings.codeModeTitle')}
            description={t('settings.codeModeDescription')}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[var(--hub-ink)]">
                    {t('settings.codeModeEnable')}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--hub-ink-3)]">
                    {t('settings.codeModeEnableDescription')}
                  </p>
                  {renderEnvOverrideWarning('codeMode.enabled')}
                </div>
                <Switch
                  id="sr-code-mode-enabled"
                  disabled={busy || !smartRoutingConfig.enabled}
                  checked={smartRoutingConfig.codeMode?.enabled ?? false}
                  onCheckedChange={(checked) =>
                    void updateSmartRoutingConfig('codeMode', { enabled: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-[var(--hub-line-2)] pt-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[var(--hub-ink)]">
                    {t('settings.codeModeReadOnlyEnable')}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--hub-ink-3)]">
                    {t('settings.codeModeReadOnlyDescription')}
                  </p>
                  {renderEnvOverrideWarning('codeMode.readOnlyVariantEnabled')}
                </div>
                <Switch
                  id="sr-code-mode-readonly"
                  disabled={
                    busy || !smartRoutingConfig.enabled || !(smartRoutingConfig.codeMode?.enabled ?? false)
                  }
                  checked={smartRoutingConfig.codeMode?.readOnlyVariantEnabled ?? true}
                  onCheckedChange={(checked) =>
                    void updateSmartRoutingConfig('codeMode', { readOnlyVariantEnabled: checked })
                  }
                />
              </div>

              <SettingsAlert variant="warning">
                {t('settings.codeModeReadOnlyAdvisoryWarning')}
              </SettingsAlert>

              <div className="grid gap-3 border-t border-[var(--hub-line-2)] pt-3 md:grid-cols-3">
                {(
                  [
                    ['codeModeTimeoutMs', 'timeoutMs', 'settings.codeModeTimeoutMs'],
                    ['codeModeCpuTimeoutMs', 'cpuTimeoutMs', 'settings.codeModeCpuTimeoutMs'],
                    ['codeModeMemoryLimitMb', 'memoryLimitMb', 'settings.codeModeMemoryLimitMb'],
                    ['codeModeMaxToolCalls', 'maxToolCalls', 'settings.codeModeMaxToolCalls'],
                    ['codeModeMaxSourceBytes', 'maxSourceBytes', 'settings.codeModeMaxSourceBytes'],
                    ['codeModeMaxLogBytes', 'maxLogBytes', 'settings.codeModeMaxLogBytes'],
                    [
                      'codeModeMaxToolResultBytes',
                      'maxToolResultBytes',
                      'settings.codeModeMaxToolResultBytes',
                    ],
                    ['codeModeMaxOutputBytes', 'maxOutputBytes', 'settings.codeModeMaxOutputBytes'],
                    [
                      'codeModeMaxConcurrentRuns',
                      'maxConcurrentRuns',
                      'settings.codeModeMaxConcurrentRuns',
                    ],
                  ] as const
                ).map(([formKey, limitField, labelKey]) => {
                  const range = CODE_MODE_LIMIT_RANGES[limitField];
                  return (
                    <div key={formKey}>
                      <label
                        htmlFor={`sr-${formKey}`}
                        className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]"
                      >
                        {t(labelKey)}
                      </label>
                      <input
                        id={`sr-${formKey}`}
                        type="number"
                        min={range.min}
                        max={range.max}
                        step="1"
                        value={draft.values[formKey]}
                        onChange={(e) => setField(formKey, e.target.value)}
                        className={settingsInputClass}
                        disabled={busy}
                      />
                      {fieldErrors[formKey] && (
                        <p role="alert" className="mt-1 text-xs text-[var(--hub-err)]">
                          {fieldErrors[formKey]}
                        </p>
                      )}
                      {renderEnvOverrideWarning(`codeMode.${limitField}`)}
                    </div>
                  );
                })}
              </div>
            </div>
          </SettingsRow>
        </div>

        <SettingsSaveBar
          dirty={draft.dirty}
          saving={saving}
          disabled={initialLoading}
          onSave={handleSave}
          onDiscard={() => {
            setFieldErrors({});
            draft.discard();
          }}
        />

        <div className="pt-2">
          <SmartRoutingIndexPanel enabled={smartRoutingConfig.enabled} />
        </div>
      </SettingsCard>
    </PermissionChecker>
  );
};

export default SmartRoutingSection;
