import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiPost } from '@/utils/fetchInterceptor';

interface GroupImportFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

interface ImportGroupConfig {
  name: string;
  description?: string;
  servers?: string[] | Array<{ name: string; tools?: string[] | 'all' }>;
}

interface ImportJsonFormat {
  groups: ImportGroupConfig[];
}

const GroupImportForm: React.FC<GroupImportFormProps> = ({ onSuccess, onCancel }) => {
  const { t } = useTranslation();
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [previewGroups, setPreviewGroups] = useState<ImportGroupConfig[] | null>(null);

  const examplePlaceholder = `{
  "groups": [
    {
      "name": "AI Assistants",
      "servers": ["openai-server", "anthropic-server"]
    },
    {
      "name": "Development Tools",
      "servers": [
        {
          "name": "github-server",
          "tools": ["create_issue", "list_repos"]
        },
        {
          "name": "gitlab-server",
          "tools": "all"
        }
      ]
    }
  ]
}

Supports:
- Simple server list: ["server1", "server2"]
- Advanced server config: [{"name": "server1", "tools": ["tool1", "tool2"]}]
- All groups will be imported in a single efficient batch operation.`;

  const parseAndValidateJson = (input: string): ImportJsonFormat | null => {
    try {
      const parsed = JSON.parse(input.trim());

      // Validate structure
      if (!parsed.groups || !Array.isArray(parsed.groups)) {
        setError(t('groupImport.invalidFormat'));
        return null;
      }

      // Validate each group
      for (const group of parsed.groups) {
        if (!group.name || typeof group.name !== 'string') {
          setError(t('groupImport.missingName'));
          return null;
        }
      }

      return parsed as ImportJsonFormat;
    } catch (e) {
      setError(t('groupImport.parseError'));
      return null;
    }
  };

  const handlePreview = () => {
    setError(null);
    const parsed = parseAndValidateJson(jsonInput);
    if (!parsed) return;

    setPreviewGroups(parsed.groups);
  };

  const handleImport = async () => {
    if (!previewGroups) return;

    setIsImporting(true);
    setError(null);

    try {
      // Use batch import API for better performance
      const result = await apiPost('/groups/batch', {
        groups: previewGroups,
      });

      if (result.success) {
        const { successCount, failureCount, results } = result;

        if (failureCount > 0) {
          const errors = results
            .filter((r: any) => !r.success)
            .map((r: any) => `${r.name}: ${r.message || t('groupImport.addFailed')}`);

          setError(
            t('groupImport.partialSuccess', { count: successCount, total: previewGroups.length }) +
              '\n' +
              errors.join('\n'),
          );
        }

        if (successCount > 0) {
          onSuccess();
        }
      } else {
        setError(result.message || t('groupImport.importFailed'));
      }
    } catch (err) {
      console.error('Import error:', err);
      setError(t('groupImport.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const renderServerList = (
    servers?: string[] | Array<{ name: string; tools?: string[] | 'all' }>,
  ) => {
    if (!servers || servers.length === 0) {
      return <span className="text-gray-500">{t('groups.noServers')}</span>;
    }

    return (
      <div className="space-y-1">
        {servers.map((server, idx) => {
          if (typeof server === 'string') {
            return (
              <div key={idx} className="text-sm">
                • {server}
              </div>
            );
          } else {
            return (
              <div key={idx} className="text-sm">
                • {server.name}
                {server.tools && server.tools !== 'all' && (
                  <span className="text-gray-500 ml-2">
                    ({Array.isArray(server.tools) ? server.tools.join(', ') : server.tools})
                  </span>
                )}
                {server.tools === 'all' && <span className="text-gray-500 ml-2">(all tools)</span>}
              </div>
            );
          }
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">{t('groupImport.title')}</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded">
            <p className="text-red-700 whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {!previewGroups ? (
          <div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('groupImport.inputLabel')}
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-96 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder={examplePlaceholder}
              />
              <p className="text-xs text-gray-500 mt-2">{t('groupImport.inputHelp')}</p>
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
                {t('groupImport.preview')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">
                {t('groupImport.previewTitle')}
              </h3>
              <div className="space-y-3">
                {previewGroups.map((group, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{group.name}</h4>
                        {group.description && (
                          <p className="text-sm text-gray-600 mt-1">{group.description}</p>
                        )}
                        <div className="mt-2 text-sm text-gray-600">
                          <strong>{t('groups.servers')}:</strong>
                          <div className="mt-1">{renderServerList(group.servers)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setPreviewGroups(null)}
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
                    {t('groupImport.importing')}
                  </>
                ) : (
                  t('groupImport.import')
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupImportForm;
