import { fileURLToPath } from 'url';
import path from 'path';

/**
 * Get the directory of the current module
 * This is in a separate file to allow mocking in test environments
 */
export function getCurrentModuleDir(): string {
  const currentModuleFile = fileURLToPath(import.meta.url);
  return path.dirname(currentModuleFile);
}
