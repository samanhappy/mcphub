import React from 'react';
import { useTranslation } from 'react-i18next';
import { useServerData } from '@/hooks/useServerData';
import { Server } from '@/types';

const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const { servers, error, setError, isLoading } = useServerData({ refreshOnMount: true });

  // Calculate server statistics
  const serverStats = {
    total: servers.length,
    online: servers.filter((server: Server) => server.status === 'connected').length,
    offline: servers.filter((server: Server) => server.status === 'disconnected').length,
    connecting: servers.filter((server: Server) => server.status === 'connecting').length,
    oauthRequired: servers.filter((server: Server) => server.status === 'oauth_required').length,
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

      {isLoading && (
        <div className="bg-white shadow rounded-lg p-6 flex items-center justify-center loading-container">
          <div className="flex flex-col items-center">
            <svg
              className="animate-spin h-10 w-10 text-blue-500 mb-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <p className="text-gray-600">{t('app.loading')}</p>
          </div>
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
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
      {servers.length > 0 && !isLoading && (
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
                {servers.slice(0, 5).map((server, index) => (
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
                        <span className="text-status-red">✗</span>
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
