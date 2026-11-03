import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { getCredentialCopySources } from '../utils/credentialCopySources';
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
  const [mode, setMode] = useState<'view' | 'edit' | 'copy' | 'delete'>(
    binding.configured ? 'view' : 'edit',
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [sourceServer, setSourceServer] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>();
  const sources = getCredentialCopySources(binding, bindings);
  const selectedSource = sources.find(({ source }) => source.serverName === sourceServer);
  const hasBinding = Boolean(binding.updatedAt);
  const changeMode = (next: typeof mode) => {
    setMode(next);
    setValues({});
    setSourceServer('');
    setOverwrite(false);
    setFeedback(undefined);
  };
  const submit = async (action: 'save' | 'copy' | 'delete') => {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const url = `${baseUrl}/${encodeURIComponent(binding.serverName)}`;
      const result =
        action === 'delete'
          ? await apiDelete<ApiResponse>(url)
          : action === 'copy'
            ? await apiPost<ApiResponse>(`${url}/copy`, { sourceServer, overwrite })
            : await apiPut<ApiResponse>(url, { values });
      if (!result.success) throw new Error(result.message || t('credentials.failed'));
      await onChange();
      changeMode('view');
      setFeedback({
        message: t(
          `credentials.${action === 'copy' ? 'copied' : action === 'delete' ? 'deleted' : 'saved'}`,
        ),
        error: false,
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : t('credentials.failed'),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const sourceReason = (entry: (typeof sources)[number]) => {
    if (entry.reason === 'missing')
      return t('credentials.sourceMissing', { slots: entry.missing.join(', ') });
    if (entry.reason === 'unconfigured') return t('credentials.sourceUnconfigured');
    if (entry.reason === 'url') return t('credentials.sourceUrlMismatch');
    return '';
  };
  return (
    <section className="hub-card p-5 space-y-4" aria-label={binding.serverName}>
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-semibold break-words">{binding.serverName}</h2>
          {binding.updatedAt && (
            <p className="text-xs text-[var(--hub-ink-3)]">
              {t('credentials.updatedAt')}:{' '}
              <time dateTime={binding.updatedAt}>
                {new Date(binding.updatedAt).toLocaleString(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </time>
            </p>
          )}
        </div>
        <span className="hub-tag shrink-0">
          {t(binding.configured ? 'credentials.savedStatus' : 'credentials.required')}
        </span>
      </div>
      {mode !== 'edit' && (
        <dl className="divide-y divide-[var(--hub-line-2)]">
          {binding.credentialTemplate.map((slot) => {
            const id = `${slot.target}.${slot.name}`;
            return (
              <div key={id} className="flex items-start justify-between gap-4 py-2 text-sm">
                <dt className="min-w-0">
                  <span className="font-medium break-words">{slot.label || slot.name}</span>
                  <span className="hub-mono block break-all text-xs text-[var(--hub-ink-3)]">
                    {id}
                  </span>
                </dt>
                <dd className="hub-mono text-[var(--hub-ink-3)]">
                  {binding.valuePreviews?.[id] ||
                    t(
                      binding.configuredSlots.includes(id)
                        ? 'credentials.savedStatus'
                        : 'credentials.notSet',
                    )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {mode === 'view' && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="hub-btn primary" onClick={() => changeMode('edit')}>
            {t(hasBinding ? 'credentials.update' : 'credentials.configure')}
          </button>
          <button type="button" className="hub-btn" onClick={() => changeMode('copy')}>
            {t('credentials.copyFrom')}
          </button>
          {hasBinding && (
            <details className="relative ml-auto">
              <summary className="hub-btn cursor-pointer">{t('credentials.moreActions')}</summary>
              <div className="absolute right-0 z-10 mt-2 rounded-lg bg-[var(--hub-surface)] p-2 shadow-lg hub-border">
                <button
                  type="button"
                  className="hub-btn danger whitespace-nowrap"
                  onClick={() => changeMode('delete')}
                >
                  {t('credentials.delete')}
                </button>
              </div>
            </details>
          )}
        </div>
      )}
      {mode === 'edit' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit('save');
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <legend className="mb-2 text-sm font-medium">
              {t(hasBinding ? 'credentials.update' : 'credentials.configure')}
            </legend>
            <p className="text-xs text-[var(--hub-ink-3)]">
              {t(hasBinding ? 'credentials.replaceHint' : 'credentials.configureHint')}
            </p>
            {binding.credentialTemplate.map((slot) => {
              const id = `${slot.target}.${slot.name}`;
              return (
                <label key={id} className="block space-y-1 text-sm">
                  <span className="font-medium">{slot.label || slot.name}</span>
                  <span className="hub-mono block text-xs text-[var(--hub-ink-3)]">{id}</span>
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
              <button type="submit" className="hub-btn primary">
                {t(hasBinding ? 'credentials.replace' : 'credentials.save')}
              </button>
              <button type="button" className="hub-btn" onClick={() => changeMode('view')}>
                {t('credentials.cancel')}
              </button>
              <button type="button" className="hub-btn" onClick={() => changeMode('copy')}>
                {t('credentials.copyFrom')}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {mode === 'copy' && (
        <div className="space-y-3 border-t border-[var(--hub-line)] pt-4">
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
                {t(sources.length ? 'credentials.chooseSource' : 'credentials.noOtherServers')}
              </option>
              {sources.map((entry) => (
                <option
                  key={entry.source.serverName}
                  value={entry.source.serverName}
                  disabled={Boolean(entry.reason)}
                >
                  {entry.source.serverName}
                  {entry.reason ? ` — ${sourceReason(entry)}` : ''}
                </option>
              ))}
            </select>
          </label>
          {!sources.some((entry) => !entry.reason) && (
            <div className="space-y-1 text-sm text-[var(--hub-ink-3)]">
              <p>{t('credentials.noSourcesHelp')}</p>
              {sources.length > 0 && (
                <ul className="list-disc pl-5">
                  {sources.map((entry) => (
                    <li key={entry.source.serverName} className="break-words">
                      {entry.source.serverName}: {sourceReason(entry)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-xs text-[var(--hub-ink-3)]">{t('credentials.copyHint')}</p>
          {sourceServer && hasBinding && (
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="hub-btn primary"
              disabled={
                busy ||
                !selectedSource ||
                Boolean(selectedSource.reason) ||
                (hasBinding && !overwrite)
              }
              onClick={() => void submit('copy')}
            >
              {t('credentials.copy')}
            </button>
            <button
              type="button"
              className="hub-btn"
              disabled={busy}
              onClick={() => changeMode('view')}
            >
              {t('credentials.cancel')}
            </button>
          </div>
        </div>
      )}
      {mode === 'delete' && (
        <div className="space-y-3 border-t border-[var(--hub-line)] pt-4">
          <p className="text-sm">
            {t('credentials.deleteConfirm', { server: binding.serverName })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="hub-btn danger"
              disabled={busy}
              onClick={() => void submit('delete')}
            >
              {t('credentials.delete')}
            </button>
            <button
              type="button"
              className="hub-btn"
              disabled={busy}
              onClick={() => changeMode('view')}
            >
              {t('credentials.cancel')}
            </button>
          </div>
        </div>
      )}
      {feedback && (
        <p
          role={feedback.error ? 'alert' : 'status'}
          className="text-sm"
          style={{ color: feedback.error ? 'var(--hub-err)' : 'var(--hub-ink-2)' }}
        >
          {feedback.message}
        </p>
      )}
    </section>
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
