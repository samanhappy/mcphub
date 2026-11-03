import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { User, MyCredentialBinding } from '../types';
import { apiDelete, apiGet, apiPost, apiPut, type ApiResponse } from '../utils/fetchInterceptor';

const CredentialForm = ({
  binding,
  baseUrl,
  bindings,
  onChange,
}: {
  binding: MyCredentialBinding;
  baseUrl: string;
  bindings: MyCredentialBinding[];
  onChange: () => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sourceServer, setSourceServer] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const slotId = (slot: MyCredentialBinding['credentialTemplate'][number]) =>
    `${slot.target}.${slot.target === 'headers' ? slot.name.toLowerCase() : slot.name}`;
  const sources = bindings.filter(
    (source) =>
      source.serverName !== binding.serverName &&
      source.configured &&
      binding.credentialTemplate.every((target) =>
        source.credentialTemplate.some(
          (slot) =>
            slotId(slot) === slotId(target) &&
            (target.target !== 'url' ||
              slot.allowed?.every((value) => target.allowed?.includes(value))),
        ),
      ),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (remove: boolean) => {
    setBusy(true);
    setMessage('');
    try {
      const url = `${baseUrl}/${encodeURIComponent(binding.serverName)}`;
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
  const copy = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await apiPost<ApiResponse>(
        `${baseUrl}/${encodeURIComponent(binding.serverName)}/copy`,
        { sourceServer, overwrite },
      );
      if (!result.success) throw new Error(result.message || t('credentials.failed'));
      setValues({});
      setSourceServer('');
      setOverwrite(false);
      setMessage(t('credentials.copied'));
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
      <p className="text-sm text-[var(--hub-ink-3)]">
        {t(binding.valuePreviews ? 'credentials.previewNotice' : 'credentials.writeOnly')}
      </p>
      {binding.updatedAt && (
        <p className="text-xs text-[var(--hub-ink-3)]">
          {t('credentials.updatedAt')}: {new Date(binding.updatedAt).toLocaleString()}
        </p>
      )}
      <div className="space-y-3 rounded-lg border border-[var(--hub-line)] p-4">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t('credentials.copyFrom')}</span>
          <select
            className="hub-input"
            value={sourceServer}
            disabled={busy || !sources.length}
            onChange={(event) => {
              setSourceServer(event.target.value);
              setOverwrite(false);
            }}
          >
            <option value="">
              {t(sources.length ? 'credentials.chooseSource' : 'credentials.noSources')}
            </option>
            {sources.map((source) => (
              <option key={source.serverName} value={source.serverName}>
                {source.serverName}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[var(--hub-ink-3)]">{t('credentials.copyHint')}</p>
        {sourceServer && binding.updatedAt && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={busy}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            <span>{t('credentials.confirmOverwrite')}</span>
          </label>
        )}
        <button
          type="button"
          className="hub-btn"
          disabled={
            busy ||
            !sources.some((source) => source.serverName === sourceServer) ||
            (!!binding.updatedAt && !overwrite)
          }
          onClick={() => void copy()}
        >
          {t('credentials.copy')}
        </button>
      </div>
      {binding.credentialTemplate.map((slot) => {
        const id = `${slot.target}.${slot.name}`;
        return (
          <label key={id} className="block space-y-1 text-sm">
            <span className="font-medium">
              {slot.label || slot.name}{' '}
              <span className="hub-mono text-xs font-normal text-[var(--hub-ink-3)]">({id})</span>
            </span>
            {binding.valuePreviews?.[id] && (
              <span className="block text-xs text-[var(--hub-ink-3)]">
                {t('credentials.savedValue')}:{' '}
                <span className="hub-mono">{binding.valuePreviews[id]}</span>
              </span>
            )}
            {slot.target === 'url' ? (
              <select
                required
                className="hub-input"
                value={values[id] || ''}
                onChange={(event) => setValues({ ...values, [id]: event.target.value })}
              >
                <option value="">{t('credentials.enterValue')}</option>
                {slot.allowed?.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            ) : (
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
                className="hub-input"
                onChange={(event) => setValues({ ...values, [id]: event.target.value })}
              />
            )}
          </label>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="hub-btn primary" disabled={busy}>
          {t('credentials.save')}
        </button>
        <button
          type="button"
          className="hub-btn danger"
          disabled={busy || !binding.updatedAt}
          onClick={() => void save(true)}
        >
          {t('credentials.delete')}
        </button>
      </div>
      {message && (
        <p role="status" className="text-sm text-[var(--hub-ink-2)]">
          {message}
        </p>
      )}
    </form>
  );
};

function CredentialList({ baseUrl }: { baseUrl: string }) {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const [bindings, setBindings] = useState<MyCredentialBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const result = await apiGet<ApiResponse<MyCredentialBinding[]>>(baseUrl);
      if (!result.success) throw new Error(result.message || t('credentials.failed'));
      setBindings(result.data || []);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : t('credentials.failed'));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, t]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const visible = bindings.filter(
    (binding) => !search.get('server') || binding.serverName === search.get('server'),
  );
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="hub-h1">{t('credentials.title')}</h1>
        <p className="hub-sub">{t('credentials.description')}</p>
      </div>
      {search.has('server') && (
        <button
          className="hub-btn"
          onClick={() =>
            setSearch((params) => {
              params.delete('server');
              return params;
            })
          }
        >
          {t('credentials.showAll')}
        </button>
      )}
      {error && (
        <div
          className="hub-card px-4 py-3 text-sm"
          style={{ color: 'var(--hub-err)' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {loading ? (
        <div className="hub-card p-10 text-center text-sm" style={{ color: 'var(--hub-ink-3)' }}>
          {t('credentials.loading')}
        </div>
      ) : !visible.length && !error ? (
        <div className="hub-card p-10 text-center text-sm" style={{ color: 'var(--hub-ink-3)' }}>
          {t('credentials.empty')}
        </div>
      ) : null}
      {visible.map((binding) => (
        <CredentialForm
          key={binding.serverName}
          binding={binding}
          bindings={bindings}
          baseUrl={baseUrl}
          onChange={reload}
        />
      ))}
    </div>
  );
}

export default function CredentialsPage() {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const [search, setSearch] = useSearchParams();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const admin = Boolean(auth.user?.isAdmin);
  const username = admin ? search.get('user') || '' : '';
  const baseUrl = username ? `/users/${encodeURIComponent(username)}/credentials` : '/credentials';
  useEffect(() => {
    if (!admin) return;
    let active = true;
    void apiGet<ApiResponse<User[]>>('/users')
      .then((result) => {
        if (!active) return;
        if (!result.success) throw new Error(result.message || t('credentials.failed'));
        setUsers(result.data || []);
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : t('credentials.failed'));
      });
    return () => {
      active = false;
    };
  }, [admin, t]);
  return (
    <div className="space-y-5">
      {admin && (
        <div className="max-w-4xl mx-auto">
          <label className="block space-y-1 text-sm">
            <span>{t('credentials.targetUser')}</span>
            <select
              className="hub-input"
              value={username}
              onChange={(event) =>
                setSearch((params) => {
                  if (event.target.value) params.set('user', event.target.value);
                  else params.delete('user');
                  return params;
                })
              }
            >
              <option value="">{t('credentials.myCredentials')}</option>
              {users.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.username}
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      <CredentialList key={baseUrl} baseUrl={baseUrl} />
    </div>
  );
}
