import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { getBasePath } from '../utils/runtime';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import type { OAuthConsentContext, ResourceTarget } from '../types/runtime';

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
        {context.resource ? (
          <input type="hidden" name="resource" value={context.resource.raw} />
        ) : null}
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

  const resourceLabel = (resource: ResourceTarget): string => {
    switch (resource.kind) {
      case 'all':
        return t('oauthServer.resourceAll');
      case 'smart':
        return t('oauthServer.resourceSmart');
      case 'server':
        return t('oauthServer.resourceServer', { name: resource.name ?? '' });
      case 'group':
        return t('oauthServer.resourceGroup', { name: resource.name ?? '' });
      default:
        return resource.name || resource.raw;
    }
  };

  const link = (href: string | undefined, label: string): React.ReactNode => {
    if (!href) return null;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11.5,
          color: 'var(--hub-ink-2)',
          textDecoration: 'none',
          borderBottom: '1px solid var(--hub-line)',
          paddingBottom: 1,
          maxWidth: 220,
        }}
        title={href}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <ExternalLink size={10} className="flex-shrink-0" />
      </a>
    );
  };

  if (!context) {
    return (
      <div
        className="relative min-h-screen w-full overflow-hidden"
        style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}
      >
        <div className="relative mx-auto flex min-h-screen w-full max-w-lg items-center justify-center px-6">
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

  const clientIdFingerprint = `${context.clientId.slice(0, 8)}…`;
  const client = context.client;
  const hasLinks = Boolean(client?.policyUri || client?.tosUri || client?.clientUri);

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

      <div className="relative mx-auto flex min-h-screen w-full max-w-lg items-center justify-center px-6">
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
                color: 'var(--hub-bg)',
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
            {/* Resource target (RFC 8707) */}
            {context.resource ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--hub-accent-soft)',
                  border: '1px solid var(--hub-line)',
                  marginBottom: 14,
                }}
              >
                <span className="hub-sect">{t('oauthServer.grantingAccessTo')}</span>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--hub-ink)' }}>
                  {resourceLabel(context.resource)}
                </span>
                <span
                  className="hub-mono"
                  style={{
                    fontSize: 11.5,
                    color: 'var(--hub-ink-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {context.resource.raw}
                </span>
              </div>
            ) : null}

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {client?.logoUri ? (
                  <img
                    src={client.logoUri}
                    alt=""
                    width={20}
                    height={20}
                    style={{ borderRadius: 4, flexShrink: 0, objectFit: 'contain' }}
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--hub-ink)' }}>
                  {context.clientName}
                </span>
              </div>
              <span className="hub-sect">
                {t('oauthServer.clientId')}: <span className="hub-mono">{clientIdFingerprint}</span>
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: 'var(--hub-ink-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={context.redirectUri}
              >
                {t('oauthServer.willRedirectTo')} {context.redirectUri}
              </span>
              {hasLinks ? (
                <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                  {link(client?.policyUri, t('oauthServer.policy'))}
                  {link(client?.tosUri, t('oauthServer.terms'))}
                  {link(client?.clientUri, t('oauthServer.homepage'))}
                </div>
              ) : null}
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
