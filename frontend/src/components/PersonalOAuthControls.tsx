import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, apiDelete } from '../utils/fetchInterceptor';
import { useToast } from '../contexts/ToastContext';
import { ChevronDown } from 'lucide-react';

export default function PersonalOAuthControls({
  serverName,
  enabled = true,
}: {
  serverName: string;
  enabled?: boolean;
}) {
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
    // Open during the click gesture; browsers may block popups after discovery awaits.
    const popup = disconnect ? null : window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setBusy(true);
    try {
      const result = disconnect ? await apiDelete(endpoint) : await apiPost(endpoint, {});
      if (!result.success) throw new Error(result.message || t('server.oauth.personalError'));
      setConnected(Boolean(result.data?.connected));
      setAuthorizationUrl(result.data?.authorizationUrl);
      if (result.data?.authorizationUrl && popup) {
        popup.location.replace(result.data.authorizationUrl);
      } else {
        popup?.close();
      }
    } catch (error) {
      popup?.close();
      showToast(error instanceof Error ? error.message : t('server.oauth.personalError'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const label = t(
    !enabled ? 'server.disable' : connected ? 'status.online' : 'status.oauthRequired',
  );
  const kind = !enabled ? 'muted' : connected ? 'ok' : 'warn';
  const triggerClass = `hub-status ${kind} hub-server-card-status hub-personal-oauth-trigger${
    kind === 'warn' ? ' hub-personal-oauth-action' : ''
  }`;
  const menuClass =
    'block w-full px-2.5 py-1.5 text-[12px] rounded-md hover:bg-[var(--hub-surface-hover)] text-left whitespace-nowrap';
  return (
    <div className="relative w-full min-w-0" onClick={(e) => e.stopPropagation()}>
      {connected ? (
        <details className="w-full min-w-0">
          <summary className={`${triggerClass} cursor-pointer list-none`} title={label}>
            <span className="hub-dot" />
            <span className="hub-status-label">{label}</span>
            <ChevronDown size={11} className="shrink-0 opacity-70" />
          </summary>
          <div className="absolute left-0 top-full mt-1 z-20 hub-card p-1 min-w-[136px] shadow-md">
            <button
              type="button"
              className={menuClass}
              disabled={busy || !enabled}
              onClick={() => void act(false)}
            >
              {t('server.oauth.personalReconnect')}
            </button>
            <button
              type="button"
              className={menuClass}
              disabled={busy}
              onClick={() => void act(true)}
            >
              {t('server.oauth.personalDisconnect')}
            </button>
          </div>
        </details>
      ) : authorizationUrl && enabled ? (
        <a
          className={`${triggerClass} cursor-pointer`}
          title={t('status.clickToAuthorize')}
          href={authorizationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="hub-dot" />
          <span className="hub-status-label">{label}</span>
        </a>
      ) : (
        <button
          type="button"
          className={`${triggerClass}${busy || !enabled ? '' : ' cursor-pointer'}`}
          disabled={busy || !enabled}
          title={enabled ? t('server.oauth.personalConnect') : label}
          onClick={() => void act(false)}
        >
          <span className="hub-dot" />
          <span className="hub-status-label">{label}</span>
        </button>
      )}
    </div>
  );
}
