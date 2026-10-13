import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, apiDelete } from '../utils/fetchInterceptor';
import { useToast } from '../contexts/ToastContext';

export default function PersonalOAuthControls({ serverName }: { serverName: string }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [connected, setConnected] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const endpoint = `/servers/${encodeURIComponent(serverName)}/oauth/personal`;
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void apiGet(endpoint)
        .then((result) => {
          if (active && result.success) {
            setConnected(Boolean(result.data?.connected));
            setAuthorizationUrl(result.data?.authorizationUrl);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [endpoint]);
  const act = async (disconnect: boolean) => {
    setBusy(true);
    try {
      const result = disconnect ? await apiDelete(endpoint) : await apiPost(endpoint, {});
      if (!result.success) throw new Error(result.message || t('server.oauth.personalError'));
      setConnected(Boolean(result.data?.connected));
      setAuthorizationUrl(result.data?.authorizationUrl);
      if (result.data?.authorizationUrl)
        window.open(result.data.authorizationUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('server.oauth.personalError'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
      <button className="hub-icon-btn" disabled={busy} onClick={() => void act(false)}>
        {t(
          connected || authorizationUrl
            ? 'server.oauth.personalReconnect'
            : 'server.oauth.personalConnect',
        )}
      </button>
      {authorizationUrl && (
        <a
          className="hub-icon-btn"
          href={authorizationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('status.clickToAuthorize')}
        </a>
      )}
      {(connected || authorizationUrl) && (
        <button className="hub-icon-btn" disabled={busy} onClick={() => void act(true)}>
          {t('server.oauth.personalDisconnect')}
        </button>
      )}
    </div>
  );
}
