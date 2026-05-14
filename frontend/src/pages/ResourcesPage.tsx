import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuiltinResource } from '@/types';
import { useBuiltinResourceData } from '@/hooks/useBuiltinResourceData';
import { useAuth } from '@/contexts/AuthContext';
import { Edit, Trash, Plus, FileText, X, ChevronDown } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { StatusDot } from '@/components/ui/StatusDot';

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
      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl max-w-3xl w-full mx-4 border border-gray-100 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
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

          <div className="flex justify-end space-x-2 mt-6">
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
              disabled={isSubmitting}
              className="hub-btn primary"
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
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('pages.resources.title')}</h1>
          <p className="hub-sub">
            <span className="hub-num">{resources.length}</span> {t('nav.resources').toLowerCase()}
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowForm(true)} className="hub-btn primary">
            <Plus size={13} /> {t('builtinResources.add')}
          </button>
        )}
      </div>

      {error && (
        <div
          className="hub-card flex items-center justify-between gap-3 mb-4"
          style={{
            padding: '10px 14px',
            borderColor: 'oklch(0.85 0.1 25)',
            background: 'oklch(0.97 0.03 25)',
            color: 'oklch(0.4 0.18 25)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <X size={14} className="flex-shrink-0" />
            <span className="truncate text-[13px]">{error}</span>
          </div>
          <button className="hub-icon-btn sm" onClick={() => setError(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
          {t('app.loading')}
        </div>
      ) : resources.length === 0 ? (
        <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
          <div className="flex flex-col items-center gap-3">
            <div
              className="grid place-items-center"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: '1px solid var(--hub-line)',
                background: 'var(--hub-bg-2)',
              }}
            >
              <FileText size={18} />
            </div>
            <div className="font-medium" style={{ color: 'var(--hub-ink-2)', fontSize: 13 }}>
              {t('builtinResources.noResources')}
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowForm(true)}
                className="hub-btn ghost sm"
                style={{ color: 'var(--hub-accent)' }}
              >
                {t('builtinResources.addFirst')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="hub-card overflow-hidden">
          {resources.map((resource, idx) => {
            const isExpanded = expandedIds.has(resource.id);
            const enabled = resource.enabled !== false;
            return (
              <div
                key={resource.id}
                style={{ borderTop: idx === 0 ? 0 : '1px solid var(--hub-line-2)' }}
              >
                <div
                  className="flex items-center justify-between cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)]"
                  style={{ padding: '12px 16px' }}
                  onClick={() => toggleExpand(resource.id)}
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <ChevronDown
                      size={12}
                      style={{
                        color: 'var(--hub-ink-3)',
                        transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: 'transform 0.15s',
                        flexShrink: 0,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-medium truncate"
                          style={{
                            fontSize: 13.5,
                            color: enabled ? 'var(--hub-ink)' : 'var(--hub-ink-3)',
                          }}
                        >
                          {resource.name || resource.uri}
                        </span>
                        {resource.name && (
                          <span
                            className="hub-mono truncate"
                            style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}
                          >
                            {resource.uri}
                          </span>
                        )}
                        <StatusDot
                          kind={enabled ? 'ok' : 'muted'}
                          label={
                            enabled
                              ? t('builtinResources.active')
                              : t('builtinResources.inactive')
                          }
                        />
                        {resource.mimeType && (
                          <span className="hub-tag accent" style={{ fontSize: 10 }}>
                            {resource.mimeType}
                          </span>
                        )}
                      </div>
                      {resource.description && (
                        <div
                          className="truncate mt-0.5"
                          style={{ fontSize: 12, color: 'var(--hub-ink-3)' }}
                        >
                          {resource.description}
                        </div>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 ml-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingResource(resource);
                        }}
                        className="hub-icon-btn sm"
                        title={t('builtinResources.edit')}
                      >
                        <Edit size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setResourceToDelete(resource);
                        }}
                        className="hub-icon-btn sm"
                        title={t('builtinResources.delete')}
                        style={{ color: 'var(--hub-err)' }}
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <div
                    style={{
                      padding: '12px 16px 14px 38px',
                      background: 'var(--hub-bg-2)',
                      borderTop: '1px solid var(--hub-line-2)',
                    }}
                  >
                    <div className="hub-sect" style={{ marginBottom: 5 }}>
                      {t('builtinResources.content')}
                    </div>
                    <pre
                      className="hub-mono"
                      style={{
                        fontSize: 12,
                        color: 'var(--hub-ink-2)',
                        background: 'var(--hub-surface)',
                        border: '1px solid var(--hub-line)',
                        borderRadius: 7,
                        padding: 10,
                        overflowX: 'auto',
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        maxHeight: 260,
                        margin: 0,
                      }}
                    >
                      {resource.content}
                    </pre>
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
