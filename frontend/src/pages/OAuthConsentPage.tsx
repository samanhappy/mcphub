import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { getBasePath } from '../utils/runtime';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import type { OAuthConsentContext } from '../types/runtime';

/**
 * OAuth consent screen, booted inside the dashboard SPA by the shell the
 * backend serves at GET /oauth/authorize (context injected into
 * window.__OAUTH_CONSENT_CONTEXT__). The server has already validated the
 * request and resolved the user, so this page only renders the payload and
 * POSTs the decision back to /oauth/authorize.
 */
const OAuthConsentPage: React.FC = () => {
  const { t } = useTranslation();

  const context = useMemo<OAuthConsentContext | null>(
    () => window.__OAUTH_CONSENT_CONTEXT__ ?? null,
    [],
  );

  const postUrl = `${getBasePath()}/oauth/authorize`;

  const hiddenInputs = (allow: string): React.ReactNode => {
    if (!context) return null;
    return (
      <>
        <input type="hidden" name="client_id" value={context.clientId} />
        <input type="hidden" name="redirect_uri" value={context.redirectUri} />
        <input type="hidden" name="response_type" value={context.responseType} />
        <input type="hidden" name="scope" value={context.scope} />
        {context.state ? <input type="hidden" name="state" value={context.state} /> : null}
        {context.codeChallenge ? (
          <input type="hidden" name="code_challenge" value={context.codeChallenge} />
        ) : null}
        {context.codeChallengeMethod ? (
          <input type="hidden" name="code_challenge_method" value={context.codeChallengeMethod} />
        ) : null}
        {context.token ? <input type="hidden" name="token" value={context.token} /> : null}
        <input type="hidden" name="allow" value={allow} />
      </>
    );
  };

  if (!context) {
    return (
      <div
        className="relative min-h-screen w-full overflow-hidden"
        style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}
      >
        <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6">
          <div className="hub-card w-full" style={{ padding: '22px' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--hub-err)' }}>
              <AlertCircle size={16} className="flex-shrink-0" />
              <h1 className="hub-h1" style={{ fontSize: 15 }}>
                {t('oauthServer.requestInvalidTitle')}
              </h1>
            </div>
            <p className="hub-sub" style={{ marginTop: 8 }}>
              {t('oauthServer.requestInvalid')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}
    >
      {/* Top-right controls, matching the login screen */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-1">
        <ThemeSwitch />
        <LanguageSwitch />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6">
        <div className="w-full space-y-6">
          {/* Brand */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative grid place-items-center"
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: 'var(--hub-ink)',
                color: 'white',
              }}
            >
              <span className="hub-mono font-semibold" style={{ fontSize: 18 }}>
                M
              </span>
            </div>
            <div className="text-center">
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  color: 'var(--hub-ink)',
                }}
              >
                {t('oauthServer.authorizeTitle')}
              </h1>
              <p className="hub-sub" style={{ marginTop: 4 }}>
                {t('oauthServer.authorizeSubtitle')}
              </p>
            </div>
          </div>

          {/* Consent card */}
          <div className="hub-card" style={{ padding: '22px 22px 20px' }}>
            {/* Client box */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--hub-bg-2)',
                border: '1px solid var(--hub-line)',
              }}
            >
              <span className="hub-sect">{t('oauthServer.application')}</span>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--hub-ink)' }}>
                {context.clientName}
              </span>
            </div>

            {/* Scopes */}
            <div style={{ marginTop: 18 }}>
              <div className="hub-sect" style={{ marginBottom: 4 }}>
                {t('oauthServer.scopesTitle')}
              </div>
              {context.scopes.length === 0 ? (
                <p className="hub-sub" style={{ marginTop: 8 }}>
                  {t('oauthServer.noScopes')}
                </p>
              ) : (
                <div className="hub-divider">
                  {context.scopes.map((scope) => (
                    <div key={scope.name} style={{ padding: '10px 0' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--hub-ink)' }}>
                        <span className="hub-mono">{scope.name}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--hub-ink-2)', marginTop: 2 }}>
                        {scope.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Approve / deny */}
            <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
              <form method="POST" action={postUrl} style={{ flex: 1 }}>
                {hiddenInputs('true')}
                <button
                  type="submit"
                  className="hub-btn primary w-full justify-center"
                  style={{
                    height: 'auto',
                    minHeight: 40,
                    padding: '8px 12px',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <span style={{ lineHeight: 1.3 }}>{t('oauthServer.buttons.approve')}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      lineHeight: 1.3,
                      opacity: 0.8,
                      color: 'inherit',
                    }}
                  >
                    {t('oauthServer.buttons.approveSubtitle')}
                  </span>
                </button>
              </form>
              <form method="POST" action={postUrl} style={{ flex: 1 }}>
                {hiddenInputs('false')}
                <button
                  type="submit"
                  className="hub-btn danger w-full justify-center"
                  style={{
                    height: 'auto',
                    minHeight: 40,
                    padding: '8px 12px',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <span style={{ lineHeight: 1.3 }}>{t('oauthServer.buttons.deny')}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      lineHeight: 1.3,
                      opacity: 0.75,
                      color: 'inherit',
                    }}
                  >
                    {t('oauthServer.buttons.denySubtitle')}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OAuthConsentPage;
