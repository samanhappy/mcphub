import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BuiltinPrompt } from '@/types';
import {
  getBuiltinPrompts,
  createBuiltinPrompt,
  updateBuiltinPrompt,
  deleteBuiltinPrompt,
} from '@/services/builtinPromptService';

export const useBuiltinPromptData = () => {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<BuiltinPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchPrompts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getBuiltinPrompts();
      setPrompts(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching built-in prompts:', err);
      setError(err instanceof Error ? err.message : t('builtinPrompts.fetchError'));
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const addPrompt = async (prompt: Omit<BuiltinPrompt, 'id'>) => {
    try {
      const result = await createBuiltinPrompt(prompt);
      triggerRefresh();
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : t('builtinPrompts.createError');
      setError(message);
      return { success: false, message };
    }
  };

  const editPrompt = async (id: string, prompt: Partial<BuiltinPrompt>) => {
    try {
      const result = await updateBuiltinPrompt(id, prompt);
      triggerRefresh();
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : t('builtinPrompts.updateError');
      setError(message);
      return { success: false, message };
    }
  };

  const removePrompt = async (id: string) => {
    try {
      await deleteBuiltinPrompt(id);
      triggerRefresh();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : t('builtinPrompts.deleteError');
      setError(message);
      return { success: false, message };
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts, refreshKey]);

  return {
    prompts,
    loading,
    error,
    setError,
    triggerRefresh,
    addPrompt,
    editPrompt,
    removePrompt,
  };
};
