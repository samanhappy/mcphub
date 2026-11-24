import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerFormData } from '@/types';
import type { ServerType } from '../../utils/serverFormUi';
import { FieldLabel, FORM_CONTROL_CLASS, SectionCard } from './FormPrimitives';

interface RuntimeSectionProps {
  formData: ServerFormData;
  setFormData: React.Dispatch<React.SetStateAction<ServerFormData>>;
  serverType: ServerType;
  onOptionsChange: (
    field: 'timeout' | 'resetTimeoutOnProgress' | 'maxTotalTimeout' | 'maxBufferSize',
    value: number | boolean | undefined,
  ) => void;
  onFieldMutated: () => void;
}

export const RuntimeSection: React.FC<RuntimeSectionProps> = ({
  formData,
  setFormData,
  serverType,
  onOptionsChange,
  onFieldMutated,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <SectionCard title={t('server.requestOptions')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {serverType === 'stdio' && (
            <div className="md:col-span-2">
              <FieldLabel htmlFor="maxBufferSize">{t('server.maxBufferSize')}</FieldLabel>
              <input
                type="number"
                id="maxBufferSize"
                value={formData.options?.maxBufferSize ?? ''}
                onChange={(e) => {
                  onFieldMutated();
                  onOptionsChange(
                    'maxBufferSize',
                    e.target.value === '' ? undefined : Number(e.target.value),
                  );
                }}
                className={`${FORM_CONTROL_CLASS} hub-mono`}
                placeholder="10485760"
                min="1"
                step="1"
              />
              <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                {t('server.maxBufferSizeDescription')}
              </p>
            </div>
          )}

          <div>
            <FieldLabel htmlFor="timeout">{t('server.timeout')}</FieldLabel>
            <input
              type="number"
              id="timeout"
              value={formData.options?.timeout ?? ''}
              onChange={(e) => {
                onFieldMutated();
                onOptionsChange(
                  'timeout',
                  e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                );
              }}
              onBlur={() => {
                if (formData.options?.timeout === undefined || Number.isNaN(formData.options.timeout)) {
                  onOptionsChange('timeout', 60000);
                }
              }}
              className={`${FORM_CONTROL_CLASS} hub-mono`}
              placeholder="60000"
              min="1000"
            />
            <p className="text-xs text-[var(--hub-ink-3)] mt-1">
              {t('server.timeoutDescription')}
            </p>
          </div>

          <div>
            <FieldLabel htmlFor="maxTotalTimeout">{t('server.maxTotalTimeout')}</FieldLabel>
            <input
              type="number"
              id="maxTotalTimeout"
              value={formData.options?.maxTotalTimeout ?? ''}
              onChange={(e) => {
                onFieldMutated();
                onOptionsChange(
                  'maxTotalTimeout',
                  e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                );
              }}
              className={`${FORM_CONTROL_CLASS} hub-mono`}
              placeholder={t('server.optionalPlaceholder', 'Optional')}
              min="1000"
            />
            <p className="text-xs text-[var(--hub-ink-3)] mt-1">
              {t('server.maxTotalTimeoutDescription')}
            </p>
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--hub-line-2)]">
          <label
            htmlFor="resetTimeoutOnProgress"
            className="flex items-start gap-2.5 cursor-pointer"
          >
            <input
              id="resetTimeoutOnProgress"
              type="checkbox"
              checked={formData.options?.resetTimeoutOnProgress ?? true}
              onChange={(e) => {
                onFieldMutated();
                onOptionsChange('resetTimeoutOnProgress', e.target.checked);
              }}
              className="mt-0.5"
            />
            <div>
              <span className="text-[13px] font-medium text-[var(--hub-ink)] block">
                {t('server.resetTimeoutOnProgress')}
              </span>
              <span className="text-xs text-[var(--hub-ink-3)] block mt-0.5">
                {t('server.resetTimeoutOnProgressDescription')}
              </span>
            </div>
          </label>
        </div>
      </SectionCard>

      {(serverType === 'sse' || serverType === 'streamable-http') && (
        <SectionCard
          title={t('server.keepAlive', 'Connection Health')}
          description={t(
            'server.keepAliveDescription',
            'Run periodic health checks. Disconnected remote servers always reconnect automatically with backoff.',
          )}
        >
          <label htmlFor="enableKeepAlive" className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              id="enableKeepAlive"
              checked={formData.keepAlive?.enabled || false}
              onChange={(e) => {
                onFieldMutated();
                setFormData((prev) => ({
                  ...prev,
                  keepAlive: {
                    ...prev.keepAlive,
                    enabled: e.target.checked,
                  },
                }));
              }}
            />
            <span className="text-[13px] font-medium text-[var(--hub-ink)]">
              {t('server.enableKeepAlive', 'Enable Health Checks')}
            </span>
          </label>

          {formData.keepAlive?.enabled && (
            <div className="pt-2">
              <FieldLabel htmlFor="keepAliveInterval">
                {t('server.keepAliveInterval', 'Check interval (ms)')}
              </FieldLabel>
              <input
                type="number"
                id="keepAliveInterval"
                value={formData.keepAlive?.interval ?? ''}
                onChange={(e) => {
                  onFieldMutated();
                  setFormData((prev) => ({
                    ...prev,
                    keepAlive: {
                      ...prev.keepAlive,
                      interval:
                        e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                    },
                  }));
                }}
                onBlur={() => {
                  if (
                    formData.keepAlive?.interval === undefined ||
                    Number.isNaN(formData.keepAlive.interval)
                  ) {
                    setFormData((prev) => ({
                      ...prev,
                      keepAlive: { ...prev.keepAlive, interval: 60000 },
                    }));
                  }
                }}
                className={`${FORM_CONTROL_CLASS} hub-mono max-w-[220px]`}
                placeholder="60000"
                min="5000"
              />
              <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                {t(
                  'server.keepAliveIntervalDescription',
                  'Time between health checks in milliseconds (default: 60000ms = 1 minute)',
                )}
              </p>
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard title={t('server.sessionLifecycle', 'Session & Lifecycle')}>
        <div className="space-y-4">
          <label htmlFor="perSessionClient" className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              id="perSessionClient"
              checked={formData.perSessionClient || false}
              onChange={(e) => {
                onFieldMutated();
                setFormData((prev) => ({
                  ...prev,
                  perSessionClient: e.target.checked,
                }));
              }}
              className="mt-0.5"
            />
            <div>
              <span className="text-[13px] font-medium text-[var(--hub-ink)] block">
                {t('server.perSessionClient', 'Per-Session Client Isolation')}
              </span>
              <span className="text-xs text-[var(--hub-ink-3)] block mt-0.5">
                {t(
                  'server.perSessionClientDescription',
                  'Create a dedicated upstream connection per session instead of sharing one across all sessions. Enable for stateful servers like Playwright. Increases upstream connections with concurrent sessions.',
                )}
              </span>
            </div>
          </label>

          {serverType === 'stdio' && (
            <div className="pt-3 border-t border-[var(--hub-line-2)] space-y-3">
              <label htmlFor="startOnDemand" className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  id="startOnDemand"
                  checked={formData.startOnDemand || false}
                  onChange={(e) => {
                    onFieldMutated();
                    setFormData((prev) => ({
                      ...prev,
                      startOnDemand: e.target.checked,
                    }));
                  }}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-[13px] font-medium text-[var(--hub-ink)] block">
                    {t('server.startOnDemand', 'Start On Demand')}
                  </span>
                  <span className="text-xs text-[var(--hub-ink-3)] block mt-0.5">
                    {t(
                      'server.startOnDemandDescription',
                      'Skip startup connect and spawn this server only when a tool call arrives. The process is shut down automatically after the idle timeout, then restarted on the next call. Reduces persistent memory usage for rarely-used servers.',
                    )}
                  </span>
                </div>
              </label>

              {(formData.startOnDemand || Boolean(formData.credentialTemplate?.length)) && (
                <div className="pl-6">
                  <FieldLabel htmlFor="idleTimeoutMs">
                    {t('server.idleTimeoutMs', 'Idle shutdown timeout (ms)')}
                  </FieldLabel>
                  <input
                    type="number"
                    id="idleTimeoutMs"
                    min={10000}
                    step={1000}
                    value={formData.idleTimeoutMs ?? ''}
                    onChange={(e) => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        idleTimeoutMs:
                          e.target.value === '' ? undefined : Number(e.target.value),
                      }));
                    }}
                    onBlur={() => {
                      if (
                        formData.idleTimeoutMs === undefined ||
                        Number.isNaN(formData.idleTimeoutMs)
                      ) {
                        setFormData((prev) => ({ ...prev, idleTimeoutMs: 300000 }));
                      }
                    }}
                    className={`${FORM_CONTROL_CLASS} hub-mono max-w-[220px]`}
                  />
                  <p className="text-xs text-[var(--hub-ink-3)] mt-1">
                    {t(
                      'server.idleTimeoutMsDescription',
                      'Shut down the process after this many milliseconds with no tool calls. Default: 300000 (5 minutes).',
                    )}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
};
