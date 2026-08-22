import fs from 'fs';
import path from 'path';
import { findPackageRoot } from './path.js';
import { logger } from './logger.js';

/**
 * Gets the package version from package.json
 * @param searchPath Optional path to start searching from (defaults to cwd)
 * @returns The version string from package.json, or 'dev' if not found
 */
export const getPackageVersion = (searchPath?: string): string => {
  try {
    // Use provided path or fallback to current working directory
    const startPath = searchPath || process.cwd();

    const packageRoot = findPackageRoot(startPath);
    if (!packageRoot) {
      logger.warn('Could not find package root, using default version');
      return 'dev';
    }

    const packageJsonPath = path.join(packageRoot, 'package.json');
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || 'dev';
  } catch (error) {
    logger.error('Error reading package version:', error);
    return 'dev';
  }
};
