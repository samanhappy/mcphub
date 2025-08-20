import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!username || !password) {
        setError(t('auth.emptyFields'));
        setLoading(false);
        return;
      }

      const success = await login(username, password);

      if (success) {
        navigate('/');
      } else {
        setError(t('auth.loginFailed'));
      }
    } catch (err) {
      setError(t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Top-right controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <ThemeSwitch />
        <LanguageSwitch />
      </div>

      {/* Tech background layer */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-60 dark:opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(60rem 60rem at 20% -10%, rgba(99,102,241,0.25), transparent), radial-gradient(50rem 50rem at 120% 10%, rgba(168,85,247,0.15), transparent)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <svg className="h-full w-full opacity-[0.08] dark:opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" className="text-gray-400 dark:text-gray-300" />
        </svg>
      </div>

      {/* Main content */}
      <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6 py-16">
        <div className="w-full space-y-6">
          {/* Centered slogan */}
          <div className="flex justify-center w-full">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-white sm:text-4xl whitespace-nowrap">
              <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                {t('auth.slogan')}
              </span>
            </h1>
          </div>

          {/* Centered login card */}
          <div className="login-card relative w-full rounded-2xl border border-white/10 bg-white/60 p-8 shadow-xl backdrop-blur-md transition dark:border-white/10 dark:bg-gray-900/60">
            <div className="absolute -top-24 right-12 h-40 w-40 -translate-y-6 rounded-full bg-indigo-500/30 blur-3xl" />
            <div className="absolute -bottom-24 -left-12 h-40 w-40 translate-y-6 rounded-full bg-cyan-500/20 blur-3xl" />
            <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label htmlFor="username" className="sr-only">
                    {t('auth.username')}
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    className="login-input appearance-none relative block w-full rounded-md border border-gray-300/60 bg-white/70 px-3 py-3 text-gray-900 shadow-sm outline-none ring-0 transition-all placeholder:text-gray-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-700/60 dark:bg-gray-800/70 dark:text-white dark:placeholder:text-gray-400"
                    placeholder={t('auth.username')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="sr-only">
                    {t('auth.password')}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="login-input appearance-none relative block w-full rounded-md border border-gray-300/60 bg-white/70 px-3 py-3 text-gray-900 shadow-sm outline-none ring-0 transition-all placeholder:text-gray-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-700/60 dark:bg-gray-800/70 dark:text-white dark:placeholder:text-gray-400"
                    placeholder={t('auth.password')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="error-box rounded border border-red-500/20 bg-red-500/10 p-2 text-center text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="login-button btn-primary group relative flex w-full items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? t('auth.loggingIn') : t('auth.login')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;