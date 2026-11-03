import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FakeIpException } from '../../../src/types/network.js';
import type { Server } from '@/types';

interface Props {
  value: FakeIpException[];
  servers: Server[];
  loading: boolean;
  onSave: (rules: FakeIpException[]) => Promise<boolean>;
}

export default function FakeIpExceptionsSettings({ value, servers, loading, onSave }: Props) {
  const { t } = useTranslation();
  const [rules, setRules] = useState(value);
  useEffect(() => setRules(value), [value]);
  const availableServers = servers.filter((server) => server.config?.id);
  const update = (index: number, patch: Partial<FakeIpException>) =>
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  return (
    <form
      aria-labelledby="fake-ip-heading"
      className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(rules);
      }}
    >
      <h3 id="fake-ip-heading" className="font-medium text-[var(--hub-ink)]">
        {t('settings.fakeIp.title')}
      </h3>
      <p className="text-sm text-[var(--hub-ink-2)]">{t('settings.fakeIp.description')}</p>
      <p className="text-xs text-[var(--hub-ink-2)]">{t('settings.fakeIp.warning')}</p>
      {rules.length === 0 && (
        <p className="text-sm text-[var(--hub-ink-2)]">{t('settings.fakeIp.empty')}</p>
      )}
      {rules.map((rule, index) => (
        <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div className="min-w-0">
            <label htmlFor={`fake-ip-server-${index}`} className="block text-sm mb-1">
              {t('settings.fakeIp.server')}
            </label>
            <select
              id={`fake-ip-server-${index}`}
              className="block w-full min-w-0 py-2 px-3 border border-gray-300 rounded-md form-input"
              value={rule.serverId}
              required
              disabled={loading}
              onChange={(event) => update(index, { serverId: event.target.value })}
            >
              <option value="">{t('settings.fakeIp.selectServer')}</option>
              {rule.serverId &&
                !availableServers.some((server) => server.config?.id === rule.serverId) && (
                  <option value={rule.serverId}>
                    {t('settings.fakeIp.unavailable', { id: rule.serverId })}
                  </option>
                )}
              {availableServers.map((server) => (
                <option key={server.config!.id} value={server.config!.id}>
                  {server.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor={`fake-ip-host-${index}`} className="block text-sm mb-1">
              {t('settings.fakeIp.hostname')}
            </label>
            <input
              id={`fake-ip-host-${index}`}
              className="block w-full min-w-0 py-2 px-3 border border-gray-300 rounded-md form-input font-mono"
              value={rule.hostname}
              placeholder="mcp.example.com"
              required
              maxLength={253}
              pattern={
                '(?![0-9.]+$)[a-z0-9](?:[a-z0-9\\-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9\\-]{0,61}[a-z0-9])?)+'
              }
              title={t('settings.fakeIp.hostnameHint')}
              disabled={loading}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) =>
                update(index, { hostname: event.target.value.toLowerCase().trim() })
              }
            />
          </div>
          <button
            type="button"
            className="hub-btn w-full sm:w-auto"
            aria-label={t('settings.fakeIp.remove', { index: index + 1 })}
            disabled={loading}
            onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
          >
            {t('common.delete')}
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="hub-btn"
          disabled={loading}
          onClick={() => setRules((current) => [...current, { serverId: '', hostname: '' }])}
        >
          {t('settings.fakeIp.add')}
        </button>
        <button type="submit" className="hub-btn primary" disabled={loading}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}
