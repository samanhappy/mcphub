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
    connecting: servers.filter((server: Server) => server.status === 'connecting').length
  };

  // Map status to translation keys
  const statusTranslations: Record<string, string> = {
    connected: 'status.online',
    disconnected: 'status.offline',
    connecting: 'status.connecting'
  };

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold text-gray-900">{t('pages.dashboard.title')}</h1>

      {error && (
        <div className="p-4 mb-6 border-l-4 border-red-500 rounded shadow-sm bg-red-50 error-box">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-status-red">{t('app.error')}</h3>
              <p className="mt-1 text-gray-600">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-gray-500 transition-colors duration-200 hover:text-gray-700"
              aria-label={t('app.closeButton')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 011.414 0L10 8.586l4.293-4.293a1 1 111.414 1.414L11.414 10l4.293 4.293a1 1 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 01-1.414-1.414L8.586 10 4.293 5.707a1 1 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center p-6 bg-white rounded-lg shadow loading-container">
          <div className="flex flex-col items-center">
            <svg className="w-10 h-10 mb-4 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">{t('app.loading')}</p>
          </div>
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {/* Total servers */}
          <div className="p-6 bg-white rounded-lg shadow dashboard-card">
            <div className="flex items-center">
              <div className="p-3 text-blue-800 bg-blue-100 rounded-full icon-container status-icon-blue">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">{t('pages.dashboard.totalServers')}</h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.total}</p>
              </div>
            </div>
          </div>

          {/* Online servers */}
          <div className="p-6 bg-white rounded-lg shadow dashboard-card">
            <div className="flex items-center">
              <div className="p-3 text-green-800 bg-green-100 rounded-full icon-container status-icon-green">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">{t('pages.dashboard.onlineServers')}</h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.online}</p>
              </div>
            </div>
          </div>

          {/* Offline servers */}
          <div className="p-6 bg-white rounded-lg shadow dashboard-card">
            <div className="flex items-center">
              <div className="p-3 text-red-800 bg-red-100 rounded-full icon-container status-icon-red">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">{t('pages.dashboard.offlineServers')}</h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.offline}</p>
              </div>
            </div>
          </div>

          {/* Connecting servers */}
          <div className="p-6 bg-white rounded-lg shadow dashboard-card">
            <div className="flex items-center">
              <div className="p-3 text-yellow-800 bg-yellow-100 rounded-full icon-container status-icon-yellow">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <h2 className="text-xl font-semibold text-gray-700">{t('pages.dashboard.connectingServers')}</h2>
                <p className="text-3xl font-bold text-gray-900">{serverStats.connecting}</p>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Recent activity list */}
      {servers.length > 0 && !isLoading && (
        <div className="mt-8">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">{t('pages.dashboard.recentServers')}</h2>
          <div className="overflow-hidden bg-white rounded-lg shadow table-container">
            <table className="min-w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-5 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    {t('server.name')}
                  </th>
                  <th scope="col" className="px-6 py-5 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    {t('server.status')}
                  </th>
                  <th scope="col" className="px-6 py-5 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    {t('server.tools')}
                  </th>
                  <th scope="col" className="px-6 py-5 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    {t('server.prompts')}
                  </th>
                  <th scope="col" className="px-6 py-5 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    {t('server.enabled')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {servers.slice(0, 5).map((server: Server, index: number) => (
                  <tr key={index}>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">
                      {server.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${server.status === 'connected'
                        ? 'status-badge-online'
                        : server.status === 'disconnected'
                          ? 'status-badge-offline'
                          : 'status-badge-connecting'
                        }`}>
                        {t(statusTranslations[server.status] || server.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {server.tools?.length || 0}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {server.prompts?.length || 0}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
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