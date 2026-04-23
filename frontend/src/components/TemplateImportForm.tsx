import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiPost } from '@/utils/fetchInterceptor';
import { ConfigTemplate, TemplateImportResult } from '@/types';

interface TemplateImportFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const TemplateImportForm: React.FC<TemplateImportFormProps> = ({ onSuccess, onCancel }) => {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<ConfigTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<TemplateImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setTemplate(null);
    setResult(null);

    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed.version || !parsed.name || !parsed.servers || !parsed.groups) {
          setError(t('template.invalidFormat'));
          return;
        }
        setTemplate(parsed as ConfigTemplate);
      } catch {
        setError(t('template.parseError'));
      }
    };
    reader.readAsText(file);
  };

  const handlePaste = (input: string) => {
    setError(null);
    setTemplate(null);
    setResult(null);

    if (!input.trim()) return;

    try {
      const parsed = JSON.parse(input.trim());
      if (!parsed.version || !parsed.name || !parsed.servers || !parsed.groups) {
        setError(t('template.invalidFormat'));
        return;
      }
      setTemplate(parsed as ConfigTemplate);
    } catch {
      setError(t('template.parseError'));
    }
  };

  const handleImport = async () => {
    if (!template) return;

    setIsImporting(true);
    setError(null);

    try {
      const response = await apiPost('/templates/import', template);

      if (response.data) {
        setResult(response.data as TemplateImportResult);
        if (response.data.success) {
          onSuccess();
        }
      } else {
        setError(response.message || t('template.importFailed'));
      }
    } catch (err) {
      console.error('Import error:', err);
      setError(t('template.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">{t('template.importTitle')}</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {result && (
          <div
            className={`mb-4 p-4 rounded border-l-4 ${result.success ? 'bg-green-50 border-green-500' : 'bg-yellow-50 border-yellow-500'}`}
          >
            <p className={result.success ? 'text-green-700' : 'text-yellow-700'}>
              {t('template.importResult', {
                serversCreated: result.serversCreated,
                serversSkipped: result.serversSkipped,
                groupsCreated: result.groupsCreated,
                groupsSkipped: result.groupsSkipped,
              })}
            </p>
            {result.requiredEnvVars.length > 0 && (
              <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded">
                <p className="text-sm font-medium text-orange-800">
                  {t('template.envVarsNeeded')}
                </p>
                <ul className="mt-1 text-sm text-orange-700">
                  {result.requiredEnvVars.map((v) => (
                    <li key={v} className="font-mono">
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!template ? (
          <div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  {t('template.uploadFile')}
                </label>
              </div>
              <div className="flex items-center space-x-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
            </div>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white dark:bg-gray-800 px-2 text-gray-500">{t('template.or')}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('template.pasteJson')}
              </label>
              <textarea
                className="w-full h-64 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder={t('template.pastePlaceholder')}
                onChange={(e) => handlePaste(e.target.value)}
              />
            </div>

            <div className="flex justify-end space-x-4">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 btn-secondary"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Template preview */}
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <h3 className="font-medium text-gray-900">{template.name}</h3>
                {template.description && (
                  <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  {t('template.version')}: {template.version} | {t('template.createdAt')}:{' '}
                  {new Date(template.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  {t('template.servers')} ({Object.keys(template.servers).length})
                </h4>
                <div className="border border-gray-200 dark:border-gray-700 rounded-md divide-y divide-gray-200 dark:divide-gray-700 max-h-40 overflow-y-auto">
                  {Object.entries(template.servers).map(([name, config]) => (
                    <div key={name} className="px-3 py-2">
                      <span className="text-sm font-medium text-gray-900">{name}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {config.type || 'stdio'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  {t('template.groups')} ({template.groups.length})
                </h4>
                <div className="border border-gray-200 dark:border-gray-700 rounded-md divide-y divide-gray-200 dark:divide-gray-700 max-h-40 overflow-y-auto">
                  {template.groups.map((group, idx) => (
                    <div key={idx} className="px-3 py-2">
                      <span className="text-sm font-medium text-gray-900">{group.name}</span>
                      {group.description && (
                        <span className="text-xs text-gray-500 ml-2">{group.description}</span>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {group.servers.length} {t('template.serversInGroup')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {template.requiredEnvVars.length > 0 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <h4 className="text-sm font-medium text-orange-800">
                    {t('template.envVarsNeeded')}
                  </h4>
                  <ul className="mt-1 text-sm text-orange-700 font-mono">
                    {template.requiredEnvVars.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-4 mt-6">
              <button
                onClick={() => {
                  setTemplate(null);
                  setResult(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 btn-secondary"
              >
                {t('common.back')}
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed btn-primary"
              >
                {isImporting ? t('template.importing') : t('template.import')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateImportForm;
