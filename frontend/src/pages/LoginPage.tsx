import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getToken } from '../services/authService';
import { getPublicConfig } from '../services/configService';
import { createBetterAuthClient, startOidcLogin } from '../services/betterAuthClient';
import { getBasePath } from '../utils/runtime';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import GitHubIcon from '@/components/icons/GitHubIcon';
import DefaultPasswordWarningModal from '@/components/ui/DefaultPasswordWarningModal';

type SocialProvider = 'google' | 'github' | 'oidc';

const sanitizeReturnUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(value, origin);
    if (url.origin !== origin) return null;
    const relativePath = `${url.pathname}${url.search}${url.hash}`;
    return relativePath || '/';
  } catch {
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    return null;
  }
};

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [betterAuthBasePath, setBetterAuthBasePath] = useState<string | undefined>(undefined);
  const [socialProviders, setSocialProviders] = useState({
    google: false,
    github: false,
    oidc: false,
  });
  const [oidcProviderId, setOidcProviderId] = useState<string>('oidc');
  const [showDefaultPasswordWarning, setShowDefaultPasswordWarning] = useState(false);
  const { login, auth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const returnUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return sanitizeReturnUrl(params.get('returnUrl'));
  }, [location.search]);

  const isServerUnavailableError = useCallback((message?: string) => {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return (
      normalized.includes('failed to fetch') ||
      normalized.includes('networkerror') ||
      normalized.includes('network error') ||
      normalized.includes('connection refused') ||
      normalized.includes('unable to connect') ||
      normalized.includes('fetch error') ||
      normalized.includes('econnrefused') ||
      normalized.includes('http 500') ||
      normalized.includes('internal server error') ||
      normalized.includes('proxy error')
    );
  }, []);

  const buildRedirectTarget = useCallback(() => {
    if (!returnUrl) return '/';
    if (!returnUrl.startsWith('/oauth/authorize')) return returnUrl;
    const token = getToken();
    if (!token) return returnUrl;
    try {
      const origin = window.location.origin;
      const url = new URL(returnUrl, origin);
      url.searchParams.set('token', token);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      const separator = returnUrl.includes('?') ? '&' : '?';
      return `${returnUrl}${separator}token=${encodeURIComponent(token)}`;
    }
  }, [returnUrl]);

  const redirectAfterLogin = useCallback(() => {
    if (returnUrl) {
      window.location.assign(buildRedirectTarget());
    } else {
      navigate('/');
    }
  }, [buildRedirectTarget, navigate, returnUrl]);

  useEffect(() => {
    if (!auth.loading && auth.isAuthenticated) redirectAfterLogin();
  }, [auth.isAuthenticated, auth.loading, redirectAfterLogin]);

  useEffect(() => {
    const loadAuthProviders = async () => {
      const publicConfig = await getPublicConfig();
      const betterAuth = publicConfig.betterAuth;
      if (!betterAuth?.enabled) {
        setSocialProviders({ google: false, github: false, oidc: false });
        return;
      }
      setBetterAuthBasePath(betterAuth.basePath);
      setOidcProviderId(betterAuth.providers?.oidc?.providerId || 'oidc');
      setSocialProviders({
        google: betterAuth.providers?.google?.enabled === true,
        github: betterAuth.providers?.github?.enabled === true,
        oidc: betterAuth.providers?.oidc?.enabled === true,
      });
    };
    loadAuthProviders();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSocialError(null);
    setLoading(true);
    try {
      if (!username || !password) {
        setError(t('auth.emptyFields'));
        setLoading(false);
        return;
      }
      const result = await login(username, password);
      if (result.success) {
        if (result.isUsingDefaultPassword) setShowDefaultPasswordWarning(true);
        else redirectAfterLogin();
      } else {
        const message = result.message;
        setError(isServerUnavailableError(message) ? t('auth.serverUnavailable') : t('auth.loginFailed'));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined;
      setError(isServerUnavailableError(message) ? t('auth.serverUnavailable') : t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: SocialProvider) => {
    setSocialError(null);
    setSocialLoading(provider);
    try {
      if (provider === 'oidc') {
        await startOidcLogin({
          providerId: oidcProviderId,
          callbackURL: returnUrl || '/',
          errorCallbackURL: `${getBasePath()}/login`,
          basePathOverride: betterAuthBasePath,
        });
        return;
      }

      const client = createBetterAuthClient(betterAuthBasePath);
      await client.signIn.social({
        provider,
        callbackURL: returnUrl || '/',
        errorCallbackURL: `${getBasePath()}/login`,
      });
    } catch (err) {
      console.error('Social login error:', err);
      setSocialError(t('auth.socialLoginFailed'));
      setSocialLoading(null);
    }
  };

  const handleCloseWarning = () => {
    setShowDefaultPasswordWarning(false);
    redirectAfterLogin();
  };

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}
    >
      {/* Top-right controls */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-1">
        <a
          href="https://github.com/samanhappy/mcphub"
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn"
          aria-label="GitHub Repository"
        >
          <GitHubIcon className="h-4 w-4" />
        </a>
        <a
          href="https://docs.mcphub.app"
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn"
          aria-label="Documentation"
        >
          <BookOpen className="h-4 w-4" />
        </a>
        <ThemeSwitch />
        <LanguageSwitch />
      </div>

      {/* Subtle grid pattern (kept low-key, hair-line) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <svg
          className="h-full w-full"
          style={{ opacity: 0.5 }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path
                d="M 32 0 L 0 0 0 32"
                fill="none"
                stroke="var(--hub-line-2)"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6">
        <div className="w-full space-y-8">
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
              <span
                className="absolute"
                style={{
                  right: -2,
                  bottom: -2,
                  width: 8,
                  height: 8,
                  borderRadius: 50,
                  background: 'var(--hub-ok)',
                  boxShadow: '0 0 0 3px var(--hub-bg)',
                }}
              />
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
                {t('app.title')}
              </h1>
              <p className="hub-sub" style={{ marginTop: 4 }}>
                {t('auth.slogan')}
              </p>
            </div>
          </div>

          {/* Login card */}
          <div
            className="hub-card"
            style={{
              padding: '22px 22px 20px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <form className="space-y-3" onSubmit={handleSubmit}>
              <div>
                <label
                  htmlFor="username"
                  className="hub-sect block"
                  style={{ marginBottom: 6 }}
                >
                  {t('auth.username')}
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  className="hub-input"
                  placeholder={t('auth.username')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="hub-sect block"
                  style={{ marginBottom: 6 }}
                >
                  {t('auth.password')}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="hub-input"
                  placeholder={t('auth.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div
                  className="flex items-center gap-2"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 7,
                    border: '1px solid oklch(0.85 0.1 25)',
                    background: 'oklch(0.97 0.03 25)',
                    color: 'oklch(0.4 0.18 25)',
                    fontSize: 12.5,
                  }}
                >
                  <AlertCircle size={13} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="hub-btn primary w-full justify-center"
                style={{ height: 34 }}
              >
                {loading ? t('auth.loggingIn') : t('auth.login')}
              </button>
            </form>

            {(socialProviders.google || socialProviders.github || socialProviders.oidc) && (
              <div className="mt-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1" style={{ background: 'var(--hub-line)' }} />
                  <span
                    className="hub-sect"
                    style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
                  >
                    {t('auth.orContinue')}
                  </span>
                  <div className="h-px flex-1" style={{ background: 'var(--hub-line)' }} />
                </div>

                {socialError && (
                  <div
                    className="flex items-center gap-2"
                    style={{
                      padding: '8px 10px',
                      borderRadius: 7,
                      border: '1px solid oklch(0.85 0.1 25)',
                      background: 'oklch(0.97 0.03 25)',
                      color: 'oklch(0.4 0.18 25)',
                      fontSize: 12.5,
                    }}
                  >
                    <AlertCircle size={13} className="flex-shrink-0" />
                    <span>{socialError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  {socialProviders.google && (
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('google')}
                      disabled={socialLoading !== null}
                      className="hub-btn w-full justify-center"
                      style={{ height: 34 }}
                    >
                      {socialLoading === 'google'
                        ? t('auth.loggingIn')
                        : t('auth.loginWithGoogle')}
                    </button>
                  )}
                  {socialProviders.github && (
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('github')}
                      disabled={socialLoading !== null}
                      className="hub-btn w-full justify-center"
                      style={{
                        height: 34,
                        background: 'var(--hub-ink)',
                        color: 'var(--hub-bg)',
                        borderColor: 'var(--hub-ink)',
                      }}
                    >
                      <GitHubIcon className="h-3.5 w-3.5" />
                      {socialLoading === 'github'
                        ? t('auth.loggingIn')
                        : t('auth.loginWithGithub')}
                    </button>
                  )}
                  {socialProviders.oidc && (
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('oidc')}
                      disabled={socialLoading !== null}
                      className="hub-btn w-full justify-center"
                      style={{ height: 34 }}
                    >
                      {socialLoading === 'oidc'
                        ? t('auth.loggingIn')
                        : t('auth.loginWithOIDC')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <p
            className="text-center hub-mono"
            style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}
          >
            v{import.meta.env.PACKAGE_VERSION}
          </p>
        </div>
      </div>

      <DefaultPasswordWarningModal
        isOpen={showDefaultPasswordWarning}
        onClose={handleCloseWarning}
      />
    </div>
  );
};

export default LoginPage;
