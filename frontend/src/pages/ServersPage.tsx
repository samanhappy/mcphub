import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Server } from '@/types';
import ServerCard from '@/components/ServerCard';
import AddServerForm from '@/components/AddServerForm';
import EditServerForm from '@/components/EditServerForm';
import { useServerData } from '@/hooks/useServerData';
import McpbUploadForm from '@/components/McpbUploadForm';
import JSONImportForm from '@/components/JSONImportForm';
import Pagination from '@/components/ui/Pagination';

const ServersPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    servers,
    error,
    setError,
    isLoading,
    pagination,
    currentPage,
    serversPerPage,
    setCurrentPage,
    setServersPerPage,
    handleServerAdd,
    handleServerEdit,
    handleServerRemove,
    handleServerToggle,
    handleServerReload,
    triggerRefresh,
  } = useServerData({ refreshOnMount: true });
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showMcpbUpload, setShowMcpbUpload] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);

  const handleEditClick = async (server: Server) => {
    const fullServerData = await handleServerEdit(server);
    if (fullServerData) {
      setEditingServer(fullServerData);
    }
  };

  const handleEditComplete = () => {
    setEditingServer(null);
    triggerRefresh();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      triggerRefresh();
      // Add a slight delay to make the spinner visible
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMcpbUploadSuccess = (_serverConfig: any) => {
    // Close upload dialog and refresh servers
    setShowMcpbUpload(false);
    triggerRefresh();
  };

  const handleJsonImportSuccess = () => {
    // Close import dialog and refresh servers
    setShowJsonImport(false);
    triggerRefresh();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('pages.servers.title')}</h1>
        <div className="flex space-x-4">
          <button
            onClick={() => navigate('/market')}
            className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center btn-primary transition-all duration-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 mr-2"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3z" />
            </svg>
            {t('nav.market')}
          </button>
          <AddServerForm onAdd={handleServerAdd} />
          <button
            onClick={() => setShowJsonImport(true)}
            className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center btn-primary transition-all duration-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 mr-2"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('jsonImport.button')}
          </button>
          <button
            onClick={() => setShowMcpbUpload(true)}
            className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center btn-primary transition-all duration-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 mr-2"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 13H11V9.413l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.413V13H5.5z" />
            </svg>
            {t('mcpb.upload')}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center btn-primary transition-all duration-200 ${isRefreshing ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isRefreshing ? (
              <svg
                className="animate-spin h-4 w-4 mr-2"
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
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 mr-2"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded shadow-sm error-box">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 mt-1">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-gray-500 hover:text-gray-700 transition-colors duration-200 btn-secondary"
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

      {isLoading ? (
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
      ) : servers.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-6 empty-state">
          <p className="text-gray-600">{t('app.noServers')}</p>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {servers.map((server, index) => (
              <ServerCard
                key={index}
                server={server}
                onRemove={handleServerRemove}
                onEdit={handleEditClick}
                onToggle={handleServerToggle}
                onRefresh={triggerRefresh}
                onReload={handleServerReload}
              />
            ))}
          </div>

          <div className="flex items-center mb-4">
            <div className="flex-[2] text-sm text-gray-500">
              {pagination
                ? t('common.showing', {
                    start: (pagination.page - 1) * pagination.limit + 1,
                    end: Math.min(pagination.page * pagination.limit, pagination.total),
                    total: pagination.total,
                  })
                : t('common.showing', {
                    start: 1,
                    end: servers.length,
                    total: servers.length,
                  })}
            </div>
            <div className="flex-[4] flex justify-center">
              {pagination && pagination.totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={pagination.totalPages}
                  onPageChange={setCurrentPage}
                  disabled={isLoading}
                />
              )}
            </div>
            <div className="flex-[2] flex items-center justify-end space-x-2">
              <label htmlFor="perPage" className="text-sm text-gray-600">
                {t('common.itemsPerPage')}:
              </label>
              <select
                id="perPage"
                value={serversPerPage}
                onChange={(e) => setServersPerPage(Number(e.target.value))}
                disabled={isLoading}
                className="border rounded p-1 text-sm btn-secondary outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </>
      )}

      {editingServer && (
        <EditServerForm
          server={editingServer}
          onEdit={handleEditComplete}
          onCancel={() => setEditingServer(null)}
        />
      )}

      {showMcpbUpload && (
        <McpbUploadForm
          onSuccess={handleMcpbUploadSuccess}
          onCancel={() => setShowMcpbUpload(false)}
        />
      )}

      {showJsonImport && (
        <JSONImportForm
          onSuccess={handleJsonImportSuccess}
          onCancel={() => setShowJsonImport(false)}
        />
      )}
    </div>
  );
};

export default ServersPage;
