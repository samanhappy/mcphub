import { useSettings } from '@/contexts/SettingsContext';

/**
 * Hook that provides access to settings data via SettingsContext.
 * This hook is a thin wrapper around useSettings to maintain backward compatibility.
 * The actual data fetching happens once in SettingsProvider, avoiding duplicate API calls.
 */
export const useSettingsData = () => {
  return useSettings();
};
