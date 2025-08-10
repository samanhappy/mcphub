import React from 'react';
import { useTranslation } from 'react-i18next';
import { CloudServer } from '@/types';

interface CloudServerCardProps {
  server: CloudServer;
  onClick: (server: CloudServer) => void;
}

const CloudServerCard: React.FC<CloudServerCardProps> = ({ server, onClick }) => {
  const { t } = useTranslation();

  const handleClick = () => {
    onClick(server);
  };

  // Extract a brief description from content if description is too long
  const getDisplayDescription = () => {
    if (server.description && server.description.length <= 150) {
      return server.description;
    }

    // Try to extract a summary from content
    if (server.content) {
      const lines = server.content.split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.length > 50 && line.length <= 150) {
          return line;
        }
      }
    }

    return server.description ?
      server.description.slice(0, 150) + '...' :
      t('cloud.noDescription');
  };

  // Format date for display
  const formatDate = (dateString: string) => {
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

  // Get initials for avatar
  const getAuthorInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

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
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors duration-200 mb-2 line-clamp-2">
              {server.title || server.name}
            </h3>

            {/* Author Section */}
            <div className="flex items-center space-x-2 mb-2">
              <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                {getAuthorInitials(server.author_name)}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">{server.author_name}</p>
                {server.updated_at && (
                  <p className="text-xs text-gray-500">
                    {t('cloud.updated')} {formatDate(server.updated_at)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Server Type Badge */}
          <div className="flex flex-col items-end space-y-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              MCP Server
            </span>
          </div>
        </div>

        {/* Description */}
        <div className="mb-3 flex-1">
          <p className="text-gray-600 text-sm leading-relaxed line-clamp-2">
            {getDisplayDescription()}
          </p>
        </div>

        {/* Tools Info */}
        {server.tools && server.tools.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center space-x-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm text-gray-600 font-medium">
                {server.tools.length} {server.tools.length === 1 ? t('cloud.tool') : t('cloud.tools')}
              </span>
            </div>
          </div>
        )}

        {/* Footer - 固定在底部 */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-auto">
          <div className="flex items-center space-x-2 text-xs text-gray-500">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            <span>{formatDate(server.created_at)}</span>
          </div>

          <div className="flex items-center text-blue-600 text-sm font-medium group-hover:text-blue-700 transition-colors">
            <span>{t('cloud.viewDetails')}</span>
            <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CloudServerCard;
