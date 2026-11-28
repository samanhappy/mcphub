import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BearerKey } from '@/types';
import { apiPost } from '@/utils/fetchInterceptor';
import { copyText } from '@/utils/clipboard';
import {
  BEARER_KEY_MAX_EXPIRES_IN_DAYS,
  BEARER_KEY_MIN_EXPIRES_IN_DAYS,
  validateExpiresInDaysInput,
} from '@/utils/bearerKeyExpiry';

type ResetExpiryMode = 'keep' | 'set' | 'clear';

interface Props {
  keyData: BearerKey;
  onClose: () => void;
  onReset: () => Promise<void>;
}

export default function ResetBearerKeyDialog({ keyData, onClose, onReset }: Props) {
  const { t } = useTranslation();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [expiryMode, setExpiryMode] = useState<ResetExpiryMode>('keep');
  const [expiryDaysInput, setExpiryDaysInput] = useState('30');

  const reset = async () => {
    if (pending.current || token) return;

    const payload: { expiresInDays?: number | null } = {};
    if (expiryMode === 'clear') {
      payload.expiresInDays = null;
    } else if (expiryMode === 'set') {
      const parsedDays = validateExpiresInDaysInput(expiryDaysInput);
      if (parsedDays === null || Number.isNaN(parsedDays)) {
        setError(t('settings.bearerKeyInvalidExpiresInDays'));
        return;
      }
      payload.expiresInDays = parsedDays;
    }

    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<ApiResponse<BearerKey>>(
        `/auth/keys/${encodeURIComponent(keyData.id)}/reset`,
        payload,
      );
      if (!result.success || !result.data?.token) {
        setError(result.message || t('settings.resetBearerKeyError'));
        return;
      }
      setToken(result.data.token);
      await onReset();
    } catch {
      setError(t('settings.resetBearerKeyError'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-key-title"
        aria-describedby="reset-key-description"
        className="hub-card p-6 max-w-xl w-full"
      >
        <h2 id="reset-key-title" className="hub-h2 mb-4">
          {t('settings.resetBearerKey')} — {keyData.name}
        </h2>
        <p id="reset-key-description" className="hub-sub mb-4">
          {t(token ? 'settings.resetBearerKeySuccess' : 'settings.resetBearerKeyConfirm')}
        </p>
        {!token && (
          <div className="mb-4 space-y-2">
            <p className="text-xs text-[var(--hub-ink-3)]">
              {t('settings.resetBearerKeyExpiryHint')}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-44 flex-1">
                <label
                  htmlFor="reset-key-expiry-mode"
                  className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]"
                >
                  {t('settings.bearerKeyExpiration')}
                </label>
                <select
                  id="reset-key-expiry-mode"
                  className="hub-input w-full"
                  value={expiryMode}
                  onChange={(e) => setExpiryMode(e.target.value as ResetExpiryMode)}
                  disabled={busy}
                >
                  <option value="keep">{t('settings.bearerKeyExpirationKeep')}</option>
                  <option value="set">{t('settings.bearerKeyExpirationSet')}</option>
                  {keyData.expiresAt && (
                    <option value="clear">{t('settings.bearerKeyExpirationClear')}</option>
                  )}
                </select>
              </div>
              {expiryMode === 'set' && (
                <div className="w-32">
                  <label
                    htmlFor="reset-key-expiry-days"
                    className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]"
                  >
                    {t('settings.bearerKeyExpirationDaysLabel')}
                  </label>
                  <input
                    id="reset-key-expiry-days"
                    type="number"
                    min={BEARER_KEY_MIN_EXPIRES_IN_DAYS}
                    max={BEARER_KEY_MAX_EXPIRES_IN_DAYS}
                    step={1}
                    className="hub-input w-full"
                    value={expiryDaysInput}
                    onChange={(e) => setExpiryDaysInput(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mb-4 text-red-600">
            {error}
          </p>
        )}
        {token && (
          <div className="mb-4">
            <label htmlFor="reset-key-token" className="block mb-2">
              {t('settings.bearerKeyToken')}
            </label>
            <textarea
              id="reset-key-token"
              className="hub-input w-full font-mono break-all"
              rows={3}
              style={{ height: 'auto', minHeight: 88, resize: 'none' }}
              value={token}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button
              className="hub-btn mt-2"
              onClick={async () => {
                const success = await copyText(token);
                setCopied(success);
                setError(success ? '' : t('common.copyFailed'));
              }}
            >
              {t(copied ? 'common.copied' : 'common.copy')}
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="hub-btn" disabled={busy} onClick={onClose} autoFocus>
            {t(token ? 'common.close' : 'common.cancel')}
          </button>
          {!token && (
            <button className="hub-btn primary" disabled={busy} onClick={reset}>
              {t(busy ? 'common.updating' : 'common.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
