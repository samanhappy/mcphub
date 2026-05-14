import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuiltinPrompt, PromptArgument } from '@/types';
import { useBuiltinPromptData } from '@/hooks/useBuiltinPromptData';
import { useAuth } from '@/contexts/AuthContext';
import { Edit, Trash, Plus, MessageSquare, X, ChevronDown } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { StatusDot } from '@/components/ui/StatusDot';

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
      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl max-w-3xl w-full mx-4 border border-gray-100 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
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
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('pages.prompts.title')}</h1>
          <p className="hub-sub">
            <span className="hub-num">{prompts.length}</span> {t('nav.prompts').toLowerCase()}
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowForm(true)} className="hub-btn primary">
            <Plus size={13} /> {t('builtinPrompts.add')}
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
      ) : prompts.length === 0 ? (
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
              <MessageSquare size={18} />
            </div>
            <div className="font-medium" style={{ color: 'var(--hub-ink-2)', fontSize: 13 }}>
              {t('builtinPrompts.noPrompts')}
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowForm(true)}
                className="hub-btn ghost sm"
                style={{ color: 'var(--hub-accent)' }}
              >
                {t('builtinPrompts.addFirst')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="hub-card overflow-hidden">
          {prompts.map((prompt, idx) => {
            const isExpanded = expandedIds.has(prompt.id);
            const enabled = prompt.enabled !== false;
            return (
              <div
                key={prompt.id}
                style={{ borderTop: idx === 0 ? 0 : '1px solid var(--hub-line-2)' }}
              >
                <div
                  className="flex items-center justify-between cursor-pointer transition-colors hover:bg-[var(--hub-surface-hover)]"
                  style={{ padding: '12px 16px' }}
                  onClick={() => toggleExpand(prompt.id)}
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
                          {prompt.title || prompt.name}
                        </span>
                        <span
                          className="hub-mono"
                          style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}
                        >
                          {prompt.name}
                        </span>
                        <StatusDot
                          kind={enabled ? 'ok' : 'muted'}
                          label={
                            enabled
                              ? t('builtinPrompts.active')
                              : t('builtinPrompts.inactive')
                          }
                        />
                      </div>
                      {prompt.description && (
                        <div
                          className="truncate mt-0.5"
                          style={{ fontSize: 12, color: 'var(--hub-ink-3)' }}
                        >
                          {prompt.description}
                        </div>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 ml-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPrompt(prompt);
                        }}
                        className="hub-icon-btn sm"
                        title={t('builtinPrompts.edit')}
                      >
                        <Edit size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPromptToDelete(prompt);
                        }}
                        className="hub-icon-btn sm"
                        title={t('builtinPrompts.delete')}
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
                    <div>
                      <div className="hub-sect" style={{ marginBottom: 5 }}>
                        {t('builtinPrompts.template')}
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
                          whiteSpace: 'pre-wrap',
                          margin: 0,
                        }}
                      >
                        {prompt.template}
                      </pre>
                    </div>
                    {prompt.arguments && prompt.arguments.length > 0 && (
                      <div className="mt-3">
                        <div className="hub-sect" style={{ marginBottom: 5 }}>
                          {t('builtinPrompts.arguments')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {prompt.arguments.map((arg, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-[12px]">
                              <code className="hub-mono hub-tag accent" style={{ fontSize: 11 }}>
                                {'{{' + arg.name + '}}'}
                              </code>
                              {arg.required && (
                                <span style={{ color: 'var(--hub-err)', fontSize: 11 }}>*</span>
                              )}
                              {arg.description && (
                                <span style={{ color: 'var(--hub-ink-3)' }}>
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
