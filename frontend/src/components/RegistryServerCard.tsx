import React from 'react';
import { useTranslation } from 'react-i18next';
import { RegistryServerEntry } from '@/types';

interface RegistryServerCardProps {
  serverEntry: RegistryServerEntry;
  onClick: (serverEntry: RegistryServerEntry) => void;
}

const RegistryServerCard: React.FC<RegistryServerCardProps> = ({ serverEntry, onClick }) => {
  const { t } = useTranslation();
  const { server, _meta } = serverEntry;

  const handleClick = () => {
    onClick(serverEntry);
  };

  // Get display description
  const getDisplayDescription = () => {
    if (server.description && server.description.length <= 150) {
      return server.description;
    }
    return server.description
      ? server.description.slice(0, 150) + '...'
      : t('registry.noDescription');
  };

  // Format date for display
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${year}/${month}/${day}`;
    } catch {
      return '';
    }
  };

  // Get icon to display
  const getIcon = () => {
    if (server.icons && server.icons.length > 0) {
      // Prefer light theme icon
      const lightIcon = server.icons.find((icon) => !icon.theme || icon.theme === 'light');
      return lightIcon || server.icons[0];
    }
    return null;
  };

  const icon = getIcon();
  const officialMeta = _meta?.['io.modelcontextprotocol.registry/official'];
  const isLatest = officialMeta?.isLatest;
  const publishedAt = officialMeta?.publishedAt;
  const updatedAt = officialMeta?.updatedAt;

  // Count packages and remotes
  const packageCount = server.packages?.length || 0;
  const remoteCount = server.remotes?.length || 0;
  const totalOptions = packageCount + remoteCount;

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-lg hover:border-blue-400 hover:-translate-y-1 transition-all duration-300 cursor-pointer group relative overflow-hidden h-full flex flex-col"
      onClick={handleClick}
    >
      {/* Background gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/0 to-purple-50/0 group-hover:from-blue-50/30 group-hover:to-purple-50/30 transition-all duration-300 pointer-events-none" />

      {/* Server Header */}
      <div className="relative z-10 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start space-x-3 flex-1">
            {/* Icon */}
            {icon ? (
              <img
                src={icon.src}
                alt={server.title}
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xl font-semibold flex-shrink-0">
                M
              </div>
            )}

            {/* Title and badges */}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors duration-200 mb-1 line-clamp-2">
                {server.name}
              </h3>
              <div className="flex flex-wrap gap-1 mb-1">
                {isLatest && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {t('registry.latest')}
                  </span>
                )}
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  v{server.version}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Server Name */}
        {/* <div className="mb-2">
          <p className="text-xs text-gray-500 font-mono">{server.name}</p>
        </div> */}

        {/* Description */}
        <div className="mb-3 flex-1">
          <p className="text-gray-600 text-sm leading-relaxed line-clamp-3">
            {getDisplayDescription()}
          </p>
        </div>

        {/* Installation Options Info */}
        {totalOptions > 0 && (
          <div className="mb-3">
            <div className="flex items-center space-x-4">
              {packageCount > 0 && (
                <div className="flex items-center space-x-1">
                  <svg
                    className="w-4 h-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                    />
                  </svg>
                  <span className="text-sm text-gray-600">
                    {packageCount}{' '}
                    {packageCount === 1 ? t('registry.package') : t('registry.packages')}
                  </span>
                </div>
              )}
              {remoteCount > 0 && (
                <div className="flex items-center space-x-1">
                  <svg
                    className="w-4 h-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                    />
                  </svg>
                  <span className="text-sm text-gray-600">
                    {remoteCount} {remoteCount === 1 ? t('registry.remote') : t('registry.remotes')}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer - fixed at bottom */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-auto">
          <div className="flex items-center space-x-2 text-xs text-gray-500">
            {(publishedAt || updatedAt) && (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{formatDate(updatedAt || publishedAt)}</span>
              </>
            )}
          </div>

          <div className="flex items-center text-blue-600 text-sm font-medium group-hover:text-blue-700 transition-colors">
            <span>{t('registry.viewDetails')}</span>
            <svg
              className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegistryServerCard;
