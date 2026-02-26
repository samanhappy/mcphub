import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BuiltinResource } from '@/types';
import {
  getBuiltinResources,
  createBuiltinResource,
  updateBuiltinResource,
  deleteBuiltinResource,
} from '@/services/builtinResourceService';

export const useBuiltinResourceData = () => {
  const { t } = useTranslation();
  const [resources, setResources] = useState<BuiltinResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchResources = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getBuiltinResources();
      setResources(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching built-in resources:', err);
      setError(err instanceof Error ? err.message : t('builtinResources.fetchError'));
      setResources([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const addResource = async (resource: Omit<BuiltinResource, 'id'>) => {
    try {
      const result = await createBuiltinResource(resource);
      triggerRefresh();
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : t('builtinResources.createError');
      setError(message);
      return { success: false, message };
    }
  };

  const editResource = async (id: string, resource: Partial<BuiltinResource>) => {
    try {
      const result = await updateBuiltinResource(id, resource);
      triggerRefresh();
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : t('builtinResources.updateError');
      setError(message);
      return { success: false, message };
    }
  };

  const removeResource = async (id: string) => {
    try {
      await deleteBuiltinResource(id);
      triggerRefresh();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : t('builtinResources.deleteError');
      setError(message);
      return { success: false, message };
    }
  };

  useEffect(() => {
    fetchResources();
  }, [fetchResources, refreshKey]);

  return {
    resources,
    loading,
    error,
    setError,
    triggerRefresh,
    addResource,
    editResource,
    removeResource,
  };
};
