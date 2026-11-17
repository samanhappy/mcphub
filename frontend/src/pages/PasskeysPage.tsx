import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import type { Passkey } from '../types';
import {
  deletePasskey,
  listPasskeys,
  passkeysSupported,
  registerPasskey,
  type PasskeyCeremonyError,
} from '../services/passkeyService';

const ceremonyMessageKey: Record<PasskeyCeremonyError, string> = {
  cancelled: 'passkeys.cancelled',
  alreadyRegistered: 'passkeys.alreadyRegistered',
  insecureContext: 'passkeys.insecureContext',
  failed: 'passkeys.registerFailed',
};

export default function PasskeysPage() {
  const { t, i18n } = useTranslation();
  const [supported] = useState(passkeysSupported);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [registrationAvailable, setRegistrationAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmId, setConfirmId] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listPasskeys();
      if (!result.success || !result.data) throw new Error(result.message);
      setPasskeys(result.data);
      setRegistrationAvailable(result.registrationAvailable !== false);
    } catch (loadError) {
      setError(
        loadError instanceof Error && loadError.message ? loadError.message : t('passkeys.failed'),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const closeForm = () => {
    setAdding(false);
    setName('');
    setCurrentPassword('');
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await registerPasskey(name.trim(), currentPassword);
      if (result.success) {
        setPasskeys((rows) => [...rows, result.passkey]);
        closeForm();
        setNotice(t('passkeys.added'));
        return;
      }
      // Keep the password so a dismissed browser prompt can simply be retried
      setError(
        result.error
          ? t(ceremonyMessageKey[result.error])
          : result.message || t('passkeys.registerFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (passkey: Passkey) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await deletePasskey(passkey.id);
      if (!result.success) throw new Error(result.message);
      setPasskeys((rows) => rows.filter((row) => row.id !== passkey.id));
      setConfirmId(undefined);
      setNotice(t('passkeys.removed'));
    } catch (removeError) {
      setError(
        removeError instanceof Error && removeError.message
          ? removeError.message
          : t('passkeys.removeFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const date = (value: string) => new Date(value).toLocaleString(i18n.language);
  const canAdd = supported && registrationAvailable;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('passkeys.title')}</h1>
          <p className="text-sm text-[var(--hub-ink-3)] mt-2">{t('passkeys.description')}</p>
          <p className="text-xs text-[var(--hub-ink-3)] mt-1">{t('passkeys.passwordChangeNote')}</p>
        </div>
        {canAdd && !adding && !loading && (
          <button
            className="hub-btn primary"
            disabled={busy}
            onClick={() => {
              setNotice('');
              setError('');
              setAdding(true);
            }}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {t('passkeys.add')}
          </button>
        )}
      </div>

      {!supported && <div className="hub-card p-4 text-sm">{t('passkeys.unsupported')}</div>}
      {supported && !loading && !registrationAvailable && (
        <div className="hub-card p-4 text-sm">{t('passkeys.unavailable')}</div>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-green-700 dark:text-green-400">
          {notice}
        </p>
      )}

      {adding && canAdd && (
        <form className="hub-card p-5" onSubmit={(event) => void add(event)}>
          <fieldset disabled={busy} className="space-y-4">
            <legend className="mb-2 text-sm font-medium">{t('passkeys.add')}</legend>
            <p className="text-xs text-[var(--hub-ink-3)]">{t('passkeys.confirmHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{t('passkeys.nameLabel')}</span>
                <input
                  className="hub-input"
                  value={name}
                  maxLength={64}
                  autoComplete="off"
                  placeholder={t('passkeys.namePlaceholder')}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{t('passkeys.currentPassword')}</span>
                <input
                  className="hub-input"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="hub-btn primary">
                {busy ? t('passkeys.waiting') : t('passkeys.create')}
              </button>
              <button type="button" className="hub-btn" onClick={closeForm}>
                {t('passkeys.cancel')}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {loading ? (
        <p role="status">{t('passkeys.loading')}</p>
      ) : (
        <div className="space-y-4">
          {!error && passkeys.length === 0 && (
            <div className="hub-card p-6">{t('passkeys.empty')}</div>
          )}
          {passkeys.map((passkey) => (
            <section key={passkey.id} className="hub-card p-5 space-y-4" aria-label={passkey.name}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-semibold break-all">
                  <KeyRound className="h-4 w-4 shrink-0" />
                  {passkey.name}
                </h2>
                <span className="hub-tag">
                  {t(passkey.backedUp ? 'passkeys.synced' : 'passkeys.deviceBound')}
                </span>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-[var(--hub-ink-3)]">{t('passkeys.site')}</dt>
                  <dd className="mt-1 break-all hub-mono">{passkey.rpId}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[var(--hub-ink-3)]">{t('passkeys.createdAt')}</dt>
                  <dd className="mt-1">{date(passkey.createdAt)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[var(--hub-ink-3)]">{t('passkeys.lastUsedAt')}</dt>
                  <dd className="mt-1">
                    {passkey.lastUsedAt ? date(passkey.lastUsedAt) : t('passkeys.never')}
                  </dd>
                </div>
              </dl>
              {confirmId === passkey.id ? (
                <div className="space-y-3 border-t border-[var(--hub-line-2)] pt-3">
                  <p>{t('passkeys.confirmRemove', { name: passkey.name })}</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="hub-btn danger"
                      disabled={busy}
                      onClick={() => void remove(passkey)}
                    >
                      {t('passkeys.confirmRemoveButton')}
                    </button>
                    <button
                      className="hub-btn"
                      disabled={busy}
                      onClick={() => setConfirmId(undefined)}
                    >
                      {t('passkeys.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="hub-btn danger"
                  disabled={busy}
                  onClick={() => setConfirmId(passkey.id)}
                >
                  {t('passkeys.remove')}
                </button>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
