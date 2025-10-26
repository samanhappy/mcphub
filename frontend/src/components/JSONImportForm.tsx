import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiPost } from '@/utils/fetchInterceptor';

interface JSONImportFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
}

interface ImportJsonFormat {
  mcpServers: Record<string, McpServerConfig>;
}

const JSONImportForm: React.FC<JSONImportFormProps> = ({ onSuccess, onCancel }) => {
  const { t } = useTranslation();
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [previewServers, setPreviewServers] = useState<Array<{ name: string; config: any }> | null>(
    null,
  );

  const examplePlaceholder = `STDIO example:
{
  "mcpServers": {
    "stdio-server-example": {
      "command": "npx",
      "args": ["-y", "mcp-server-example"]
    }
  }
}

SSE example:
{
  "mcpServers": {
    "sse-server-example": {
      "type": "sse",
      "url": "http://localhost:3000"
    }
  }
}

HTTP example:
{
  "mcpServers": {
    "http-server-example": {
      "type": "streamable-http",
      "url": "http://localhost:3001",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer your-token"
      }
    }
  }
}`;

  const parseAndValidateJson = (input: string): ImportJsonFormat | null => {
    try {
      const parsed = JSON.parse(input.trim());

      // Validate structure
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        setError(t('jsonImport.invalidFormat'));
        return null;
      }

      return parsed as ImportJsonFormat;
    } catch (e) {
      setError(t('jsonImport.parseError'));
      return null;
    }
  };

  const handlePreview = () => {
    setError(null);
    const parsed = parseAndValidateJson(jsonInput);
    if (!parsed) return;

    const servers = Object.entries(parsed.mcpServers).map(([name, config]) => {
      // Normalize config to MCPHub format
      const normalizedConfig: any = {};

      if (config.type === 'sse' || config.type === 'streamable-http') {
        normalizedConfig.type = config.type;
        normalizedConfig.url = config.url;
        if (config.headers) {
          normalizedConfig.headers = config.headers;
        }
      } else {
        // Default to stdio
        normalizedConfig.type = 'stdio';
        normalizedConfig.command = config.command;
        normalizedConfig.args = config.args || [];
        if (config.env) {
          normalizedConfig.env = config.env;
        }
      }

      return { name, config: normalizedConfig };
    });

    setPreviewServers(servers);
  };

  const handleImport = async () => {
    if (!previewServers) return;

    setIsImporting(true);
    setError(null);

    try {
      let successCount = 0;
      const errors: string[] = [];

      for (const server of previewServers) {
        try {
          const result = await apiPost('/servers', {
            name: server.name,
            config: server.config,
          });

          if (result.success) {
            successCount++;
          } else {
            errors.push(`${server.name}: ${result.message || t('jsonImport.addFailed')}`);
          }
        } catch (err) {
          errors.push(
            `${server.name}: ${err instanceof Error ? err.message : t('jsonImport.addFailed')}`,
          );
        }
      }

      if (errors.length > 0) {
        setError(
          t('jsonImport.partialSuccess', { count: successCount, total: previewServers.length }) +
            '\n' +
            errors.join('\n'),
        );
      }

      if (successCount > 0) {
        onSuccess();
      }
    } catch (err) {
      console.error('Import error:', err);
      setError(t('jsonImport.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">{t('jsonImport.title')}</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded">
            <p className="text-red-700 whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {!previewServers ? (
          <div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('jsonImport.inputLabel')}
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-96 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder={examplePlaceholder}
              />
              <p className="text-xs text-gray-500 mt-2">{t('jsonImport.inputHelp')}</p>
            </div>

            <div className="flex justify-end space-x-4">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handlePreview}
                disabled={!jsonInput.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 btn-primary"
              >
                {t('jsonImport.preview')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">
                {t('jsonImport.previewTitle')}
              </h3>
              <div className="space-y-3">
                {previewServers.map((server, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{server.name}</h4>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div>
                            <strong>{t('server.type')}:</strong> {server.config.type || 'stdio'}
                          </div>
                          {server.config.command && (
                            <div>
                              <strong>{t('server.command')}:</strong> {server.config.command}
                            </div>
                          )}
                          {server.config.args && server.config.args.length > 0 && (
                            <div>
                              <strong>{t('server.arguments')}:</strong>{' '}
                              {server.config.args.join(' ')}
                            </div>
                          )}
                          {server.config.url && (
                            <div>
                              <strong>{t('server.url')}:</strong> {server.config.url}
                            </div>
                          )}
                          {server.config.env && Object.keys(server.config.env).length > 0 && (
                            <div>
                              <strong>{t('server.envVars')}:</strong>{' '}
                              {Object.keys(server.config.env).join(', ')}
                            </div>
                          )}
                          {server.config.headers &&
                            Object.keys(server.config.headers).length > 0 && (
                              <div>
                                <strong>{t('server.headers')}:</strong>{' '}
                                {Object.keys(server.config.headers).join(', ')}
                              </div>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setPreviewServers(null)}
                disabled={isImporting}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 btn-secondary"
              >
                {t('common.back')}
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center btn-primary"
              >
                {isImporting ? (
                  <>
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
                    {t('jsonImport.importing')}
                  </>
                ) : (
                  t('jsonImport.import')
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default JSONImportForm;
