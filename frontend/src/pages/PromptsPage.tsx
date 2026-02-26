import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuiltinPrompt, PromptArgument } from '@/types';
import { useBuiltinPromptData } from '@/hooks/useBuiltinPromptData';
import { useAuth } from '@/contexts/AuthContext';
import { Edit, Trash, Plus, MessageSquare, X, ChevronDown, ChevronUp } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

// Form dialog for creating/editing a built-in prompt
interface PromptFormDialogProps {
  prompt?: BuiltinPrompt | null;
  onSave: (data: Omit<BuiltinPrompt, 'id'>) => Promise<{ success: boolean; message?: string }>;
  onCancel: () => void;
}

const PromptFormDialog: React.FC<PromptFormDialogProps> = ({ prompt, onSave, onCancel }) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState(prompt?.name || '');
  const [title, setTitle] = useState(prompt?.title || '');
  const [description, setDescription] = useState(prompt?.description || '');
  const [template, setTemplate] = useState(prompt?.template || '');
  const [enabled, setEnabled] = useState(prompt?.enabled !== false);
  const [args, setArgs] = useState<PromptArgument[]>(prompt?.arguments || []);

  const handleAddArg = () => {
    setArgs([...args, { name: '', description: '', required: false }]);
  };

  const handleRemoveArg = (index: number) => {
    setArgs(args.filter((_, i) => i !== index));
  };

  const handleArgChange = (index: number, field: keyof PromptArgument, value: string | boolean) => {
    setArgs(args.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t('builtinPrompts.nameRequired'));
      return;
    }
    if (!template.trim()) {
      setError(t('builtinPrompts.templateRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onSave({
        name: name.trim(),
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        template,
        arguments: args.length > 0 ? args.filter((a) => a.name.trim()) : undefined,
        enabled,
      });
      if (!result.success) {
        setError(result.message || t('builtinPrompts.saveError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('builtinPrompts.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl max-w-2xl w-full mx-4 border border-gray-100 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
            {prompt ? t('builtinPrompts.edit') : t('builtinPrompts.addNew')}
          </h2>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md">
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinPrompts.name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('builtinPrompts.namePlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-all duration-200"
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinPrompts.title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('builtinPrompts.titlePlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinPrompts.description')}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('builtinPrompts.descriptionPlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('builtinPrompts.template')} <span className="text-red-500">*</span>
              </label>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder={t('builtinPrompts.templatePlaceholder')}
                rows={6}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm transition-all duration-200"
                required
                disabled={isSubmitting}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('builtinPrompts.templateHint')}
              </p>
            </div>

            {/* Arguments */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('builtinPrompts.arguments')}
                </label>
                <button
                  type="button"
                  onClick={handleAddArg}
                  className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                  disabled={isSubmitting}
                >
                  <Plus size={14} className="mr-1" />
                  {t('builtinPrompts.addArgument')}
                </button>
              </div>
              {args.map((arg, index) => (
                <div key={index} className="flex items-start gap-2 mb-2">
                  <input
                    type="text"
                    value={arg.name}
                    onChange={(e) => handleArgChange(index, 'name', e.target.value)}
                    placeholder={t('builtinPrompts.argName')}
                    className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isSubmitting}
                  />
                  <input
                    type="text"
                    value={arg.description || ''}
                    onChange={(e) => handleArgChange(index, 'description', e.target.value)}
                    placeholder={t('builtinPrompts.argDescription')}
                    className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isSubmitting}
                  />
                  <label className="flex items-center text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={arg.required || false}
                      onChange={(e) => handleArgChange(index, 'required', e.target.checked)}
                      className="mr-1"
                      disabled={isSubmitting}
                    />
                    {t('builtinPrompts.argRequired')}
                  </label>
                  <button
                    type="button"
                    onClick={() => handleRemoveArg(index)}
                    className="text-red-500 hover:text-red-700 p-1"
                    disabled={isSubmitting}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
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
                {t('builtinPrompts.enabled')}
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

const PromptsPage: React.FC = () => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const {
    prompts,
    loading,
    error,
    setError,
    addPrompt,
    editPrompt,
    removePrompt,
  } = useBuiltinPromptData();

  const [showForm, setShowForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<BuiltinPrompt | null>(null);
  const [promptToDelete, setPromptToDelete] = useState<BuiltinPrompt | null>(null);
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

  const handleCreate = async (data: Omit<BuiltinPrompt, 'id'>) => {
    const result = await addPrompt(data);
    if (result.success) {
      setShowForm(false);
    }
    return result;
  };

  const handleEdit = async (data: Omit<BuiltinPrompt, 'id'>) => {
    if (!editingPrompt) return { success: false, message: 'No prompt selected' };
    const result = await editPrompt(editingPrompt.id, data);
    if (result.success) {
      setEditingPrompt(null);
    }
    return result;
  };

  const handleConfirmDelete = async () => {
    if (promptToDelete) {
      await removePrompt(promptToDelete.id);
      setPromptToDelete(null);
    }
  };

  return (
    <div className="container mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('pages.prompts.title')}
        </h1>
        {isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center btn-primary transition-all duration-200 shadow-sm"
          >
            <Plus size={16} className="mr-2" />
            {t('builtinPrompts.add')}
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
      ) : prompts.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 empty-state dashboard-card">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full mb-4">
              <MessageSquare className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-lg font-medium">
              {t('builtinPrompts.noPrompts')}
            </p>
            {isAdmin && (
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 text-blue-600 hover:text-blue-800 font-medium"
              >
                {t('builtinPrompts.addFirst')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {prompts.map((prompt) => {
            const isExpanded = expandedIds.has(prompt.id);
            return (
              <div
                key={prompt.id}
                className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden dashboard-card"
              >
                <div
                  className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750"
                  onClick={() => toggleExpand(prompt.id)}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    <MessageSquare
                      size={18}
                      className={`mr-3 flex-shrink-0 ${prompt.enabled !== false ? 'text-blue-500' : 'text-gray-400'}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                          {prompt.title || prompt.name}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {prompt.name}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            prompt.enabled !== false
                              ? 'bg-green-100 text-green-800 border border-green-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                        >
                          {prompt.enabled !== false ? t('builtinPrompts.active') : t('builtinPrompts.inactive')}
                        </span>
                      </div>
                      {prompt.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {prompt.description}
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
                            setEditingPrompt(prompt);
                          }}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                          title={t('builtinPrompts.edit')}
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPromptToDelete(prompt);
                          }}
                          className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 transition-colors"
                          title={t('builtinPrompts.delete')}
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
                        {t('builtinPrompts.template')}
                      </h4>
                      <pre className="text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                        {prompt.template}
                      </pre>
                    </div>
                    {prompt.arguments && prompt.arguments.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                          {t('builtinPrompts.arguments')}
                        </h4>
                        <div className="space-y-1">
                          {prompt.arguments.map((arg, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <code className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">
                                {'{{' + arg.name + '}}'}
                              </code>
                              {arg.required && (
                                <span className="text-red-500 text-xs">*</span>
                              )}
                              {arg.description && (
                                <span className="text-gray-500 dark:text-gray-400 text-xs">
                                  — {arg.description}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add form dialog */}
      {showForm && (
        <PromptFormDialog onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {/* Edit form dialog */}
      {editingPrompt && (
        <PromptFormDialog
          prompt={editingPrompt}
          onSave={handleEdit}
          onCancel={() => setEditingPrompt(null)}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!promptToDelete}
        onClose={() => setPromptToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('builtinPrompts.confirmDelete')}
        message={t('builtinPrompts.deleteWarning', { name: promptToDelete?.name || '' })}
        variant="danger"
      />
    </div>
  );
};

export default PromptsPage;
