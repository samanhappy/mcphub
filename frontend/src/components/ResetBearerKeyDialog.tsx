import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BearerKey } from '@/types';
import { apiPost } from '@/utils/fetchInterceptor';
import { copyText } from '@/utils/clipboard';

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

  const reset = async () => {
    if (pending.current || token) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<ApiResponse<BearerKey>>(
        `/auth/keys/${encodeURIComponent(keyData.id)}/reset`,
        {},
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
