import React from 'react';
import { useTranslation } from 'react-i18next';
import { MarketServer } from '@/types';

interface MarketServerDetailProps {
  server: MarketServer;
  onBack: () => void;
  onInstall: (server: MarketServer) => void;
  installing?: boolean;
}

const MarketServerDetail: React.FC<MarketServerDetailProps> = ({ 
  server, 
  onBack, 
  onInstall,
  installing = false
}) => {
  const { t } = useTranslation();

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-4">
        <button 
          onClick={onBack}
          className="text-gray-600 hover:text-gray-900 flex items-center"
        >
          <svg className="h-5 w-5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          {t('market.backToList')}
        </button>
      </div>

      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{server.display_name}</h2>
          <p className="text-sm text-gray-500 mt-1">{server.name}</p>
        </div>
        
        <div className="flex items-center">
          {server.is_official && (
            <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded mr-2">
              {t('market.official')}
            </span>
          )}
          <button
            onClick={() => onInstall(server)}
            disabled={installing}
            className={`px-4 py-2 rounded text-white ${
              installing 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {installing ? t('market.installing') : t('market.install')}
          </button>
        </div>
      </div>

      <p className="text-gray-700 mb-6">{server.description}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="border rounded p-4">
          <h3 className="font-medium mb-2">{t('market.author')}</h3>
          <p>{server.author.name}</p>
        </div>
        <div className="border rounded p-4">
          <h3 className="font-medium mb-2">{t('market.license')}</h3>
          <p>{server.license}</p>
        </div>
        <div className="border rounded p-4">
          <h3 className="font-medium mb-2">{t('market.repository')}</h3>
          <a 
            href={server.repository.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {server.repository.url}
          </a>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">{t('market.categories')}</h3>
        <div className="flex flex-wrap gap-2">
          {server.categories?.map((category, index) => (
            <span key={index} className="bg-gray-100 text-gray-800 px-3 py-1 rounded">
              {category}
            </span>
          ))}
        </div>
      </div>

      {server.tags && server.tags.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">{t('market.tags')}</h3>
          <div className="flex flex-wrap gap-2">
            {server.tags.map((tag, index) => (
              <span key={index} className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-sm">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {server.examples && server.examples.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">{t('market.examples')}</h3>
          <div className="space-y-4">
            {server.examples.map((example, index) => (
              <div key={index} className="border rounded p-4">
                <h4 className="font-medium mb-2">{example.title}</h4>
                <p className="text-gray-600 mb-2">{example.description}</p>
                <pre className="bg-gray-50 p-3 rounded text-sm overflow-auto">
                  {example.prompt}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">{t('market.tools')}</h3>
        <div className="space-y-4">
          {server.tools?.map((tool, index) => (
            <div key={index} className="border rounded p-4">
              <h4 className="font-medium mb-2">{tool.name}</h4>
              <p className="text-gray-600 mb-2">{tool.description}</p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    // Toggle visibility of schema (simplified for this implementation)
                    const element = document.getElementById(`schema-${index}`);
                    if (element) {
                      element.classList.toggle('hidden');
                    }
                  }}
                  className="text-sm text-blue-600 hover:underline focus:outline-none"
                >
                  {t('market.viewSchema')}
                </button>
                <pre id={`schema-${index}`} className="hidden bg-gray-50 p-3 rounded text-sm overflow-auto mt-2">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>

      {server.arguments && Object.keys(server.arguments).length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">{t('market.arguments')}</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('market.argumentName')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('market.description')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('market.required')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('market.example')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Object.entries(server.arguments).map(([name, arg], index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {arg.description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {arg.required ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-600">✗</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <code className="bg-gray-100 px-2 py-1 rounded">{arg.example}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          onClick={() => onInstall(server)}
          disabled={installing}
          className={`px-6 py-2 rounded text-white ${
            installing 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {installing ? t('market.installing') : t('market.install')}
        </button>
      </div>
    </div>
  );
};

export default MarketServerDetail;