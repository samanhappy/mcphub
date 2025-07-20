import fs from 'fs';
import path from 'path';

/**
 * Gets the package version from package.json
 * @returns The version string from package.json, or 'dev' if not found
 */
export const getPackageVersion = (): string => {
  try {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || 'dev';
  } catch (error) {
    console.error('Error reading package version:', error);
    return 'dev';
  }
};
