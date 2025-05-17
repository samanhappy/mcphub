import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Gets the package version from package.json
 * @returns The version string from package.json, or 'dev' if not found
 */
export const getPackageVersion = (): string => {
  try {
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || 'dev';
  } catch (error) {
    console.error('Error reading package version:', error);
    return 'dev';
  }
};
