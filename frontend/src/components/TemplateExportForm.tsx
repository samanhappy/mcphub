import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiPost } from '@/utils/fetchInterceptor';
import { Group, ConfigTemplate } from '@/types';

interface TemplateExportFormProps {
  groups: Group[];
  onCancel: () => void;
}

const TemplateExportForm: React.FC<TemplateExportFormProps> = ({ groups, onCancel }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  };

  const handleSelectAll = () => {
    if (selectedGroupIds.length === groups.length) {
      setSelectedGroupIds([]);
    } else {
      setSelectedGroupIds(groups.map((g) => g.id));
    }
  };

  const handleExport = async () => {
    if (!name.trim()) {
      setError(t('template.nameRequired'));
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      const result = await apiPost('/templates/export', {
        name: name.trim(),
        description: description.trim() || undefined,
        groupIds: selectedGroupIds.length > 0 ? selectedGroupIds : undefined,
        includeDisabledServers: includeDisabled,
      });

      if (result.success && result.data) {
        const template: ConfigTemplate = result.data;
        const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${template.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.mcphub-template.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        onCancel();
      } else {
        setError(result.message || t('template.exportFailed'));
      }
    } catch (err) {
      console.error('Export error:', err);
      setError(t('template.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">{t('template.exportTitle')}</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('template.name')} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('template.namePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('template.description')}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('template.descriptionPlaceholder')}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                {t('template.selectGroups')}
              </label>
              <button
                onClick={handleSelectAll}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {selectedGroupIds.length === groups.length
                  ? t('template.deselectAll')
                  : t('template.selectAll')}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">{t('template.selectGroupsHelp')}</p>
            <div className="border border-gray-200 rounded-md max-h-48 overflow-y-auto">
              {groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={() => handleToggleGroup(group.id)}
                    className="mr-3 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">{group.name}</span>
                    {group.description && (
                      <span className="text-xs text-gray-500 ml-2">{group.description}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDisabled}
              onChange={(e) => setIncludeDisabled(e.target.checked)}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">{t('template.includeDisabled')}</span>
          </label>
        </div>

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-700">{t('template.exportNote')}</p>
        </div>

        <div className="flex justify-end space-x-4 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || !name.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed btn-primary"
          >
            {isExporting ? t('template.exporting') : t('template.export')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateExportForm;
