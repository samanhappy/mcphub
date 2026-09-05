import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { MyCredentialBinding } from '../types';
import { apiDelete, apiGet, apiPut, type ApiResponse } from '../utils/fetchInterceptor';

const CredentialForm = ({
  binding,
  onChange,
}: {
  binding: MyCredentialBinding;
  onChange: () => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (remove: boolean) => {
    setBusy(true);
    setMessage('');
    try {
      const url = `/credentials/${encodeURIComponent(binding.serverName)}`;
      const result = remove
        ? await apiDelete<ApiResponse>(url)
        : await apiPut<ApiResponse>(url, { values });
      if (!result.success) throw new Error(result.message || t('credentials.failed'));
      setValues({});
      setMessage(t(remove ? 'credentials.deleted' : 'credentials.saved'));
      await onChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('credentials.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="hub-card p-5 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{binding.serverName}</h2>
        <span className="hub-tag">
          {t(binding.configured ? 'credentials.configured' : 'credentials.required')}
        </span>
      </div>
      <p className="text-sm text-[var(--hub-ink-3)]">{t('credentials.writeOnly')}</p>
      {binding.credentialTemplate.map((slot) => {
        const id = `${slot.target}.${slot.name}`;
        return (
          <label key={id} className="block space-y-1 text-sm">
            <span>
              {slot.label || slot.name} <span className="text-[var(--hub-ink-3)]">({id})</span>
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              maxLength={16384}
              value={values[id] || ''}
              placeholder={t(
                binding.configuredSlots.includes(id)
                  ? 'credentials.replaceValue'
                  : 'credentials.enterValue',
              )}
              className="w-full rounded-md border border-[var(--hub-line)] bg-[var(--hub-surface)] px-3 py-2"
              onChange={(event) => setValues({ ...values, [id]: event.target.value })}
            />
          </label>
        );
      })}
      <div className="flex gap-2">
        <button type="submit" className="hub-btn primary" disabled={busy}>
          {t('credentials.save')}
        </button>
        <button
          type="button"
          className="hub-btn"
          disabled={busy || !binding.updatedAt}
          onClick={() => void save(true)}
        >
          {t('credentials.delete')}
        </button>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
};

export default function CredentialsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const [bindings, setBindings] = useState<MyCredentialBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const result = await apiGet<ApiResponse<MyCredentialBinding[]>>('/credentials');
      if (!result.success) throw new Error(result.message || t('credentials.failed'));
      setBindings(result.data || []);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : t('credentials.failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const visible = bindings.filter(
    (binding) => !search.get('server') || binding.serverName === search.get('server'),
  );
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t('credentials.title')}</h1>
        <p className="mt-2 text-sm text-[var(--hub-ink-3)]">{t('credentials.description')}</p>
      </div>
      {search.has('server') && (
        <button className="hub-btn" onClick={() => setSearch({})}>
          {t('credentials.showAll')}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>{t('credentials.loading')}</p>
      ) : !visible.length && !error ? (
        <p>{t('credentials.empty')}</p>
      ) : null}
      {visible.map((binding) => (
        <CredentialForm key={binding.serverName} binding={binding} onChange={reload} />
      ))}
    </div>
  );
}
