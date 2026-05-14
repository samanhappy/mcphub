import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useGroupData } from '@/hooks/useGroupData';
import { useServerData } from '@/hooks/useServerData';
import { GroupFormData, Server, IGroupServerConfig } from '@/types';
import { ServerToolConfig } from './ServerToolConfig';

interface AddGroupFormProps {
  onAdd: () => void;
  onCancel: () => void;
}

const AddGroupForm = ({ onAdd, onCancel }: AddGroupFormProps) => {
  const { t } = useTranslation();
  const { createGroup } = useGroupData();
  const { allServers } = useServerData();
  const [availableServers, setAvailableServers] = useState<Server[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<GroupFormData>({
    name: '',
    description: '',
    servers: [] as IGroupServerConfig[],
  });

  useEffect(() => {
    // Filter available servers (enabled only)
    setAvailableServers(allServers.filter((server) => server.enabled !== false));
  }, [allServers]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      if (!formData.name.trim()) {
        setError(t('groups.nameRequired'));
        setIsSubmitting(false);
        return;
      }

      const result = await createGroup(formData.name, formData.description, formData.servers);
      if (!result || !result.success) {
        setError(result?.message || t('groups.createError'));
        setIsSubmitting(false);
        return;
      }

      onAdd();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="p-6 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">{t('groups.addNew')}</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md border border-gray-200 dark:border-gray-700">
              {error}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6">
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                  {t('groups.name')} *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('groups.namePlaceholder')}
                  required
                />
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  {t('groups.configureCapabilities')}
                </label>
                <ServerToolConfig
                  servers={availableServers}
                  value={formData.servers as IGroupServerConfig[]}
                  onChange={(servers) => setFormData((prev) => ({ ...prev, servers }))}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 p-5 pt-3 border-t border-[var(--hub-line-2)] flex-shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="hub-btn"
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="hub-btn primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.submitting') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddGroupForm;
