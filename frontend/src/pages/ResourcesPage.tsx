import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuiltinResource } from '@/types';
import { useBuiltinResourceData } from '@/hooks/useBuiltinResourceData';
import { useAuth } from '@/contexts/AuthContext';
import { Edit, Trash, Plus, FileText, X, ChevronDown, ChevronUp } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

// Form dialog for creating/editing a built-in resource
interface ResourceFormDialogProps {
  resource?: BuiltinResource | null;
  onSave: (data: Omit<BuiltinResource, 'id'>) => Promise<{ success: boolean; message?: string }>;
  onCancel: () => void;
}

const ResourceFormDialog: React.FC<ResourceFormDialogProps> = ({ resource, onSave, onCancel }) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [uri, setUri] = useState(resource?.uri || '');
  const [name, setName] = useState(resource?.name || '');
  const [description, setDescription] = useState(resource?.description || '');
  const [mimeType, setMimeType] = useState(resource?.mimeType || 'text/plain');
  const [content, setContent] = useState(resource?.content || '');
  const [enabled, setEnabled] = useState(resource?.enabled !== false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!uri.trim()) {
      setError(t('builtinResources.uriRequired'));
      return;
    }
    if (!content.trim()) {
      setError(t('builtinResources.contentRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onSave({
        uri: uri.trim(),
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        mimeType: mimeType.trim() || 'text/plain',
        content,
        enabled,
      });
      if (!result.success) {
        setError(result.message || t('builtinResources.saveError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('builtinResources.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-gray-100 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
            {resource ? t('builtinResources.edit') : t('builtinResources.addNew')}
          </h2>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md">
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinResources.uri')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder={t('builtinResources.uriPlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm transition-all duration-200"
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinResources.name')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('builtinResources.namePlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinResources.description')}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('builtinResources.descriptionPlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinResources.mimeType')}
              </label>
              <input
                type="text"
                value={mimeType}
                onChange={(e) => setMimeType(e.target.value)}
                placeholder="text/plain"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinResources.content')} <span className="text-red-500">*</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('builtinResources.contentPlaceholder')}
                rows={8}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm transition-all duration-200"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="flex items-center pt-2">
              <input
                type="checkbox"
                id="enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                disabled={isSubmitting}
              />
              <label htmlFor="enabled" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                {t('builtinResources.enabled')}
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-8">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 btn-secondary"
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 btn-primary transition-all duration-200 shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ResourcesPage: React.FC = () => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const {
    resources,
    loading,
    error,
    setError,
    addResource,
    editResource,
    removeResource,
  } = useBuiltinResourceData();

  const [showForm, setShowForm] = useState(false);
  const [editingResource, setEditingResource] = useState<BuiltinResource | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<BuiltinResource | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const isAdmin = auth.user?.isAdmin;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async (data: Omit<BuiltinResource, 'id'>) => {
    const result = await addResource(data);
    if (result.success) {
      setShowForm(false);
    }
    return result;
  };

  const handleEdit = async (data: Omit<BuiltinResource, 'id'>) => {
    if (!editingResource) return { success: false, message: 'No resource selected' };
    const result = await editResource(editingResource.id, data);
    if (result.success) {
      setEditingResource(null);
    }
    return result;
  };

  const handleConfirmDelete = async () => {
    if (resourceToDelete) {
      await removeResource(resourceToDelete.id);
      setResourceToDelete(null);
    }
  };

  return (
    <div className="container mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('pages.resources.title')}
        </h1>
        {isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center btn-primary transition-all duration-200 shadow-sm"
          >
            <Plus size={16} className="mr-2" />
            {t('builtinResources.add')}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 error-box rounded-lg shadow-sm">
          <div className="flex justify-between items-center">
            <p>{error}</p>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              <X size={20} />
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 loading-container flex justify-center items-center h-64">
          <div className="flex flex-col items-center justify-center">
            <svg
              className="animate-spin h-10 w-10 text-blue-500 mb-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-600 dark:text-gray-400">{t('app.loading')}</p>
          </div>
        </div>
      ) : resources.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 empty-state dashboard-card">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full mb-4">
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-lg font-medium">
              {t('builtinResources.noResources')}
            </p>
            {isAdmin && (
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 text-blue-600 hover:text-blue-800 font-medium"
              >
                {t('builtinResources.addFirst')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {resources.map((resource) => {
            const isExpanded = expandedIds.has(resource.id);
            return (
              <div
                key={resource.id}
                className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden dashboard-card"
              >
                <div
                  className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750"
                  onClick={() => toggleExpand(resource.id)}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    <FileText
                      size={18}
                      className={`mr-3 flex-shrink-0 ${resource.enabled !== false ? 'text-green-500' : 'text-gray-400'}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                          {resource.name || resource.uri}
                        </span>
                        {resource.name && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                            {resource.uri}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full flex-shrink-0 ${
                            resource.enabled !== false
                              ? 'bg-green-100 text-green-800 border border-green-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                        >
                          {resource.enabled !== false ? t('builtinResources.active') : t('builtinResources.inactive')}
                        </span>
                        {resource.mimeType && (
                          <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-full border border-blue-200 flex-shrink-0">
                            {resource.mimeType}
                          </span>
                        )}
                      </div>
                      {resource.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {resource.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center ml-4 gap-2">
                    {isAdmin && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingResource(resource);
                          }}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                          title={t('builtinResources.edit')}
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setResourceToDelete(resource);
                          }}
                          className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 transition-colors"
                          title={t('builtinResources.delete')}
                        >
                          <Trash size={18} />
                        </button>
                      </>
                    )}
                    {isExpanded ? (
                      <ChevronUp size={18} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={18} className="text-gray-400" />
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-6 pb-4 border-t border-gray-100 dark:border-gray-700">
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                        {t('builtinResources.content')}
                      </h4>
                      <pre className="text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                        {resource.content}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add form dialog */}
      {showForm && (
        <ResourceFormDialog onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {/* Edit form dialog */}
      {editingResource && (
        <ResourceFormDialog
          resource={editingResource}
          onSave={handleEdit}
          onCancel={() => setEditingResource(null)}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!resourceToDelete}
        onClose={() => setResourceToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('builtinResources.confirmDelete')}
        message={t('builtinResources.deleteWarning', { name: resourceToDelete?.name || resourceToDelete?.uri || '' })}
        variant="danger"
      />
    </div>
  );
};

export default ResourcesPage;
