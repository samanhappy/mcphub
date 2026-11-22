import {
  useRuntimeSettings,
  useSettings,
  useSettingsActions,
} from '@/contexts/SettingsContext';

/**
 * Hook that provides access to settings data via SettingsContext.
 * Maintained for backward compatibility; prefer `useRuntimeSettings` for
 * read-only consumers and `useSettingsActions` for write operations.
 */
export const useSettingsData = () => {
  return useSettings();
};

export { useRuntimeSettings, useSettingsActions };
