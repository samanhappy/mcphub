import React from 'react';
import { useTranslation } from 'react-i18next';
import { useServerData } from '@/hooks/useServerData';
import { Server } from '@/types';

const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const { allServers, error, setError, isLoading } = useServerData({ refreshOnMount: true });

  const [hasLoaded, setHasLoaded] = React.useState(false);
  const loadingStartedRef = React.useRef(false);

  React.useEffect(() => {
    if (isLoading) {
      loadingStartedRef.current = true;
      return;
    }

    if (loadingStartedRef.current) {
      setHasLoaded(true);
      return;
    }

    if (allServers.length > 0 || error) {
      setHasLoaded(true);
    }
  }, [isLoading, allServers.length, error]);

  const showSkeleton = !hasLoaded;

  // Calculate server statistics using allServers (not paginated)
  const serverStats = {
    total: allServers.length,
    online: allServers.filter((server: Server) => server.status === 'connected').length,
    disabled: allServers.filter((server: Server) => server.enabled === false).length,
    offline: allServers.filter(
      (server: Server) => server.status === 'disconnected' && server.enabled !== false,
    ).length,
    connecting: allServers.filter((server: Server) => server.status === 'connecting').length,
    oauthRequired: allServers.filter((server: Server) => server.status === 'oauth_required').length,
  };

  // Map status to translation keys
  const statusTranslations: Record<string, string> = {
    connected: 'status.online',
    disconnected: 'status.offline',
    connecting: 'status.connecting',
    oauth_required: 'status.oauthRequired',
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">{t('pages.dashboard.title')}</h1>

      {error && (
        <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded shadow-sm error-box">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-status-red text-lg font-medium">{t('app.error')}</h3>
              <p className="text-gray-600 mt-1">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-gray-500 hover:text-gray-700 transition-colors duration-200"
              aria-label={t('app.closeButton')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 011.414 0L10 8.586l4.293-4.293a1 1 111.414 1.414L11.414 10l4.293 4.293a1 1 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 01-1.414-1.414L8.586 10 4.293 5.707a1 1 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {showSkeleton && (
        <div className="space-y-8" aria-busy="true" aria-live="polite">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={`stats-skeleton-${index}`}
                className="bg-white rounded-lg shadow p-6 dashboard-card"
              >
                <div className="flex items-center">
                  <div className="h-14 w-14 rounded-full bg-gray-200 animate-pulse" />
                  <div className="ml-4 flex-1 space-y-3">
                    <div className="h-4 w-32 rounded bg-gray-200 animate-pulse" />
                    <div className="h-8 w-20 rounded bg-gray-200 animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="h-6 w-40 rounded bg-gray-200 animate-pulse mb-4" />
            <div className="bg-white shadow rounded-lg overflow-hidden table-container">
              <div className="divide-y divide-gray-200">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={`row-skeleton-${index}`} className="px-6 py-4">
                    <div className="grid grid-cols-5 gap-6">
                      <div className="h-4 w-28 rounded bg-gray-200 animate-pulse" />
                      <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
                      <div className="h-4 w-12 rounded bg-gray-200 animate-pulse" />
                      <div className="h-4 w-12 rounded bg-gray-200 animate-pulse" />
                      <div className="h-4 w-10 rounded bg-gray-200 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!showSkeleton && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
          {/* Total servers */}
          <div className="bg-white rounded-lg shadow p-6 dashboard-card">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 text-blue-800 icon-container status-icon-blue">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">
                  {t('pages.dashboard.totalServers')}
                </h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.total}</p>
              </div>
            </div>
          </div>

          {/* Online servers */}
          <div className="bg-white rounded-lg shadow p-6 dashboard-card">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100 text-green-800 icon-container status-icon-green">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">
                  {t('pages.dashboard.onlineServers')}
                </h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.online}</p>
              </div>
            </div>
          </div>

          {/* Disabled servers */}
          <div className="bg-white rounded-lg shadow p-6 dashboard-card">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-gray-100 text-gray-700 icon-container">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">
                  {t('pages.dashboard.disabledServers')}
                </h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.disabled}</p>
              </div>
            </div>
          </div>

          {/* Offline servers */}
          <div className="bg-white rounded-lg shadow p-6 dashboard-card">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-red-100 text-red-800 icon-container status-icon-red">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">
                  {t('pages.dashboard.offlineServers')}
                </h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.offline}</p>
              </div>
            </div>
          </div>

          {/* Connecting servers */}
          <div className="bg-white rounded-lg shadow p-6 dashboard-card">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-yellow-100 text-yellow-800 icon-container status-icon-yellow">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">
                  {t('pages.dashboard.connectingServers')}
                </h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.connecting}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent activity list */}
      {allServers.length > 0 && !showSkeleton && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            {t('pages.dashboard.recentServers')}
          </h2>
          <div className="bg-white shadow rounded-lg overflow-hidden table-container">
            <table className="min-w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('server.name')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('server.status')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('server.tools')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('server.prompts')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {t('server.enabled')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {allServers.slice(0, 5).map((server, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {server.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <span
                        className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          server.status === 'connected'
                            ? 'status-badge-online'
                            : server.status === 'disconnected'
                              ? 'status-badge-offline'
                              : server.status === 'oauth_required'
                                ? 'status-badge-oauth-required'
                                : 'status-badge-connecting'
                        }`}
                      >
                        {server.status === 'oauth_required' && '🔐 '}
                        {t(statusTranslations[server.status] || server.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {server.tools?.length || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {server.prompts?.length || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {server.enabled !== false ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-gray-500" aria-label={t('pages.dashboard.disabledServers')}>
                          ⏸
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
