import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, type ApiResponse } from '../utils/fetchInterceptor';
import type { OAuthApproval } from '../types';

export default function OAuthApprovalsPage() {
  const { t, i18n } = useTranslation();
  const [approvals, setApprovals] = useState<OAuthApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmClient, setConfirmClient] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiGet<ApiResponse<OAuthApproval[]>>('/oauth/approvals');
      if (!result.success || !result.data) throw new Error(t('oauthApprovals.failed'));
      setApprovals(result.data);
    } catch {
      setError(t('oauthApprovals.failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (approval: OAuthApproval) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiDelete<ApiResponse>(
        `/oauth/approvals/${encodeURIComponent(approval.id)}`,
      );
      if (!result.success) throw new Error(t('oauthApprovals.failed'));
      setApprovals((rows) => rows.filter((row) => row.clientId !== approval.clientId));
      setConfirmClient(undefined);
      setNotice(t('oauthApprovals.revoked'));
    } catch {
      setError(t('oauthApprovals.failed'));
    } finally {
      setBusy(false);
    }
  };
  const date = (value: string) => new Date(value).toLocaleString(i18n.language);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('oauthApprovals.title')}</h1>
          <p className="text-sm text-[var(--hub-ink-3)] mt-2">{t('oauthApprovals.description')}</p>
        </div>
        <button
          className="hub-btn"
          disabled={loading || busy}
          onClick={() => {
            setNotice('');
            void load();
          }}
        >
          {t('oauthApprovals.refresh')}
        </button>
      </div>
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
      {loading ? (
        <p role="status">{t('oauthApprovals.loading')}</p>
      ) : (
        <div className="space-y-4">
          {!error && approvals.length === 0 && (
            <div className="hub-card p-6">{t('oauthApprovals.empty')}</div>
          )}
          {approvals.map((approval) => (
            <section
              key={approval.id}
              className="hub-card p-5 space-y-4"
              aria-label={approval.clientId}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold break-all">{approval.clientId}</h2>
                <span className="hub-tag">
                  {t(
                    new Date(approval.expiresAt).getTime() > Date.now()
                      ? 'oauthApprovals.active'
                      : 'oauthApprovals.expired',
                  )}
                </span>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {[
                  ['scopes', approval.scopes.join(', ') || '—'],
                  ['resource', approval.resource || '—'],
                  ['redirect', approval.redirectUri],
                  ['approvedAt', date(approval.approvedAt)],
                  ['expiresAt', date(approval.expiresAt)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[var(--hub-ink-3)]">{t(`oauthApprovals.${label}`)}</dt>
                    <dd className="break-all mt-1">{value}</dd>
                  </div>
                ))}
              </dl>
              {confirmClient === approval.clientId ? (
                <div className="space-y-3 border-t border-[var(--hub-line-2)] pt-3">
                  <p>{t('oauthApprovals.confirm', { client: approval.clientId })}</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="hub-btn danger"
                      disabled={busy}
                      onClick={() => void revoke(approval)}
                    >
                      {t('oauthApprovals.confirmRevoke')}
                    </button>
                    <button
                      className="hub-btn"
                      disabled={busy}
                      onClick={() => setConfirmClient(undefined)}
                    >
                      {t('oauthApprovals.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="hub-btn danger"
                  disabled={busy}
                  onClick={() => setConfirmClient(approval.clientId)}
                >
                  {t('oauthApprovals.revoke')}
                </button>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
