import React from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvVar, OpenApiToolStats, ServerFormData } from '@/types';
import TagInput from '../ui/TagInput';
import { SERVER_NAME_MAX_LENGTH, SERVER_NAME_PATTERN } from '../../utils/serverName';
import { OPENAPI_STATS_WARN_TOKENS, formatBytes, formatTokens } from '../../utils/contextCost';
import type { ServerType } from '../../utils/serverFormUi';
import {
  ArgumentListEditor,
  FieldLabel,
  FORM_CONTROL_CLASS,
  FORM_TEXTAREA_CLASS,
  KeyValueListEditor,
  SectionCard,
  ServerTypeSelector,
} from './FormPrimitives';

interface ConnectionSectionProps {
  formData: ServerFormData;
  setFormData: React.Dispatch<React.SetStateAction<ServerFormData>>;
  serverType: ServerType;
  onServerTypeChange: (type: ServerType) => void;
  isAdmin: boolean;
  isEdit: boolean;
  enforceNamePattern: boolean;
  tagSuggestions: string[];
  envVars: EnvVar[];
  onAddEnvVar: () => void;
  onEnvVarChange: (index: number, field: 'key' | 'value', value: string) => void;
  onRemoveEnvVar: (index: number) => void;
  headerVars: EnvVar[];
  onAddHeaderVar: () => void;
  onHeaderVarChange: (index: number, field: 'key' | 'value', value: string) => void;
  onRemoveHeaderVar: (index: number) => void;
  openApiSourcePresent: boolean;
  openApiStats: OpenApiToolStats | null;
  openApiStatsLoading: boolean;
  openApiStatsUnavailable: boolean;
  onFieldMutated: () => void;
}

export const ConnectionSection: React.FC<ConnectionSectionProps> = ({
  formData,
  setFormData,
  serverType,
  onServerTypeChange,
  isAdmin,
  isEdit,
  enforceNamePattern,
  tagSuggestions,
  envVars,
  onAddEnvVar,
  onEnvVarChange,
  onRemoveEnvVar,
  headerVars,
  onAddHeaderVar,
  onHeaderVarChange,
  onRemoveHeaderVar,
  openApiSourcePresent,
  openApiStats,
  openApiStatsLoading,
  openApiStatsUnavailable,
  onFieldMutated,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <SectionCard title={t('server.sectionBasicInfo', 'Basic Info')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <div className="md:col-span-1">
            <FieldLabel htmlFor="server-name" required>
              {t('server.name')}
            </FieldLabel>
            <input
              type="text"
              name="name"
              id="server-name"
              value={formData.name}
              onChange={(e) => {
                onFieldMutated();
                setFormData((prev) => ({ ...prev, name: e.target.value }));
              }}
              className={`${FORM_CONTROL_CLASS} hub-mono`}
              placeholder="time-mcp"
              pattern={enforceNamePattern ? SERVER_NAME_PATTERN.source : undefined}
              maxLength={enforceNamePattern ? SERVER_NAME_MAX_LENGTH : undefined}
              title={t('server.nameInvalid')}
              required
              aria-required="true"
            />
          </div>

          <div className="md:col-span-2">
            <FieldLabel htmlFor="server-description">{t('server.description')}</FieldLabel>
            <input
              type="text"
              name="description"
              id="server-description"
              value={formData.description || ''}
              onChange={(e) => {
                onFieldMutated();
                setFormData((prev) => ({ ...prev, description: e.target.value }));
              }}
              className={FORM_CONTROL_CLASS}
              placeholder={t('server.descriptionPlaceholder')}
            />
          </div>

          <div className="md:col-span-3">
            <FieldLabel htmlFor="server-tags">{t('server.tags')}</FieldLabel>
            <TagInput
              id="server-tags"
              value={formData.tags ?? []}
              onChange={(tags) => {
                onFieldMutated();
                setFormData((prev) => ({ ...prev, tags }));
              }}
              suggestions={tagSuggestions}
              placeholder={t('server.tagsPlaceholder')}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t('server.sectionConnection', 'Connection')}>
        <div>
          <FieldLabel>{t('server.type')}</FieldLabel>
          <ServerTypeSelector
            value={serverType}
            onChange={(nextType) => {
              onFieldMutated();
              onServerTypeChange(nextType);
            }}
            isAdmin={isAdmin}
          />
          {!isAdmin && (
            <p
              id="local-execution-permission"
              className="text-xs text-amber-700 dark:text-amber-300 mt-2"
            >
              {t('server.localExecutionRequiresAdmin')}
            </p>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--hub-line-2)] space-y-4">
          {serverType === 'openapi' ? (
            <>
              <div>
                <FieldLabel>{t('server.openapi.inputMode')}</FieldLabel>
                <div
                  role="radiogroup"
                  aria-label={t('server.openapi.inputMode')}
                  className="inline-flex p-0.5 rounded-lg"
                  style={{
                    border: '1px solid var(--hub-line)',
                    background: 'var(--hub-bg-2)',
                  }}
                >
                  {(
                    [
                      ['url', 'input-mode-url', t('server.openapi.inputModeUrl')],
                      ['schema', 'input-mode-schema', t('server.openapi.inputModeSchema')],
                    ] as const
                  ).map(([modeValue, inputId, label]) => {
                    const active = (formData.openapi?.inputMode || 'url') === modeValue;
                    return (
                      <label
                        key={modeValue}
                        htmlFor={inputId}
                        className="px-3 py-1 rounded-[6px] text-xs font-medium cursor-pointer transition-colors"
                        style={{
                          background: active ? 'var(--hub-surface)' : 'transparent',
                          color: active ? 'var(--hub-ink)' : 'var(--hub-ink-3)',
                          border: active
                            ? '1px solid var(--hub-line)'
                            : '1px solid transparent',
                        }}
                      >
                        <input
                          type="radio"
                          id={inputId}
                          name="inputMode"
                          value={modeValue}
                          checked={active}
                          onChange={() => {
                            onFieldMutated();
                            setFormData((prev) => ({
                              ...prev,
                              openapi: { ...prev.openapi!, inputMode: modeValue },
                            }));
                          }}
                          className="sr-only"
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>

              {(formData.openapi?.inputMode || 'url') === 'url' ? (
                <div>
                  <FieldLabel htmlFor="openapi-url" required>
                    {t('server.openapi.specUrl')}
                  </FieldLabel>
                  <input
                    type="url"
                    name="openapi-url"
                    id="openapi-url"
                    value={formData.openapi?.url || ''}
                    onChange={(e) => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        openapi: { ...prev.openapi!, url: e.target.value },
                      }));
                    }}
                    className={`${FORM_CONTROL_CLASS} hub-mono`}
                    placeholder="https://api.example.com/openapi.json"
                    required
                    aria-required="true"
                  />
                </div>
              ) : (
                <div>
                  <FieldLabel htmlFor="openapi-schema" required>
                    {t('server.openapi.schema')}
                  </FieldLabel>
                  <textarea
                    name="openapi-schema"
                    id="openapi-schema"
                    rows={9}
                    value={formData.openapi?.schema || ''}
                    onChange={(e) => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        openapi: { ...prev.openapi!, schema: e.target.value },
                      }));
                    }}
                    className={`${FORM_TEXTAREA_CLASS} hub-mono text-xs`}
                    placeholder={`{\n  "openapi": "3.1.0",\n  "info": { "title": "API", "version": "1.0.0" },\n  "servers": [{ "url": "https://api.example.com" }],\n  "paths": {}\n}`}
                    required
                    aria-required="true"
                  />
                  <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                    {t('server.openapi.schemaHelp')}
                  </p>
                </div>
              )}

              {!isEdit && openApiSourcePresent && (
                <div
                  className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs dark:border-blue-900/70 dark:bg-blue-950/30"
                  aria-live="polite"
                >
                  {openApiStatsLoading ? (
                    <p className="text-blue-700 dark:text-blue-300">
                      {t('server.openapi.statsMeasuring')}
                    </p>
                  ) : openApiStats ? (
                    <>
                      <p className="font-medium text-blue-900 dark:text-blue-100">
                        {t('server.openapi.statsSummary', {
                          toolCount: openApiStats.toolCount,
                          bytes: formatBytes(openApiStats.definitionsBytes),
                          tokens: formatTokens(openApiStats.estimatedTokens),
                        })}
                      </p>
                      {openApiStats.estimatedTokens >= OPENAPI_STATS_WARN_TOKENS && (
                        <p className="mt-1 text-amber-700 dark:text-amber-300">
                          {t('server.openapi.statsWarning')}
                        </p>
                      )}
                    </>
                  ) : openApiStatsUnavailable ? (
                    <p className="text-[var(--hub-ink-2)]">{t('server.openapi.statsUnavailable')}</p>
                  ) : null}
                </div>
              )}

              <KeyValueListEditor
                label={t('server.headers')}
                addLabel={t('server.addHeader', 'Add header')}
                items={headerVars}
                onAdd={() => {
                  onFieldMutated();
                  onAddHeaderVar();
                }}
                onChange={(index, field, value) => {
                  onFieldMutated();
                  onHeaderVarChange(index, field, value);
                }}
                onRemove={(index) => {
                  onFieldMutated();
                  onRemoveHeaderVar(index);
                }}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer token..."
                getRemoveAriaLabel={(index) =>
                  t('server.removeHeader', { index, defaultValue: `Remove header ${index}` })
                }
              />
            </>
          ) : serverType === 'sse' || serverType === 'streamable-http' ? (
            <>
              <div>
                <FieldLabel htmlFor="server-url" required>
                  {t('server.url')}
                </FieldLabel>
                <input
                  type="url"
                  name="url"
                  id="server-url"
                  value={formData.url}
                  onChange={(e) => {
                    onFieldMutated();
                    setFormData((prev) => ({ ...prev, url: e.target.value }));
                  }}
                  className={`${FORM_CONTROL_CLASS} hub-mono`}
                  placeholder={
                    serverType === 'streamable-http'
                      ? 'http://localhost:3000/mcp'
                      : 'http://localhost:3000/sse'
                  }
                  required
                  aria-required="true"
                />
              </div>

              <KeyValueListEditor
                label={t('server.headers')}
                addLabel={t('server.addHeader', 'Add header')}
                items={headerVars}
                onAdd={() => {
                  onFieldMutated();
                  onAddHeaderVar();
                }}
                onChange={(index, field, value) => {
                  onFieldMutated();
                  onHeaderVarChange(index, field, value);
                }}
                onRemove={(index) => {
                  onFieldMutated();
                  onRemoveHeaderVar(index);
                }}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer token..."
                getRemoveAriaLabel={(index) =>
                  t('server.removeHeader', { index, defaultValue: `Remove header ${index}` })
                }
              />

              <KeyValueListEditor
                label={t('server.envVars')}
                addLabel={t('server.addEnvVar', 'Add variable')}
                items={envVars}
                onAdd={() => {
                  onFieldMutated();
                  onAddEnvVar();
                }}
                onChange={(index, field, value) => {
                  onFieldMutated();
                  onEnvVarChange(index, field, value);
                }}
                onRemove={(index) => {
                  onFieldMutated();
                  onRemoveEnvVar(index);
                }}
                keyPlaceholder={t('server.key')}
                valuePlaceholder={t('server.value')}
                getRemoveAriaLabel={(index) =>
                  t('server.removeEnvVar', { index, defaultValue: `Remove variable ${index}` })
                }
                separator="="
              />
            </>
          ) : (
            <>
              <div>
                <FieldLabel htmlFor="server-command" required>
                  {t('server.command')}
                </FieldLabel>
                <input
                  type="text"
                  name="command"
                  id="server-command"
                  value={formData.command}
                  onChange={(e) => {
                    onFieldMutated();
                    setFormData((prev) => ({ ...prev, command: e.target.value }));
                  }}
                  className={`${FORM_CONTROL_CLASS} hub-mono`}
                  placeholder="npx"
                  required
                  aria-required="true"
                />
              </div>

              <ArgumentListEditor
                label={t('server.arguments')}
                hint={t('server.argumentsHint')}
                addLabel={t('server.addArgument')}
                args={formData.args || []}
                onAdd={() => {
                  onFieldMutated();
                  setFormData((prev) => ({ ...prev, args: [...(prev.args || []), ''] }));
                }}
                onChange={(index, value) => {
                  onFieldMutated();
                  setFormData((prev) => ({
                    ...prev,
                    args: prev.args?.map((item, i) => (i === index ? value : item)),
                  }));
                }}
                onRemove={(index) => {
                  onFieldMutated();
                  setFormData((prev) => ({
                    ...prev,
                    args: prev.args?.filter((_, i) => i !== index),
                  }));
                }}
                getItemAriaLabel={(index) => t('server.argumentLabel', { index })}
                getRemoveAriaLabel={(index) => t('server.removeArgument', { index })}
              />

              <KeyValueListEditor
                label={t('server.envVars')}
                addLabel={t('server.addEnvVar', 'Add variable')}
                items={envVars}
                onAdd={() => {
                  onFieldMutated();
                  onAddEnvVar();
                }}
                onChange={(index, field, value) => {
                  onFieldMutated();
                  onEnvVarChange(index, field, value);
                }}
                onRemove={(index) => {
                  onFieldMutated();
                  onRemoveEnvVar(index);
                }}
                keyPlaceholder={t('server.key')}
                valuePlaceholder={t('server.value')}
                getRemoveAriaLabel={(index) =>
                  t('server.removeEnvVar', { index, defaultValue: `Remove variable ${index}` })
                }
                separator="="
              />
            </>
          )}
        </div>
      </SectionCard>
    </div>
  );
};
