import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { getCurrentModuleDir } from './moduleDir.js';

// Project root directory - use process.cwd() as a simpler alternative
const rootDir = process.cwd();

// Cache the package root for performance
let cachedPackageRoot: string | null | undefined = undefined;

/**
 * Initialize package root by trying to find it using the module directory
 * This should be called when the module is first loaded
 */
function initializePackageRoot(): void {
  // Skip initialization in test environments
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return;
  }

  try {
    // Try to get the current module's directory
    const currentModuleDir = getCurrentModuleDir();

    // This file is in src/utils/path.ts (or dist/utils/path.js when compiled)
    // So package.json should be 2 levels up
    const possibleRoots = [
      path.resolve(currentModuleDir, '..', '..'), // dist -> package root
      path.resolve(currentModuleDir, '..'), // dist/utils -> dist -> package root
    ];

    for (const root of possibleRoots) {
      const packageJsonPath = path.join(root, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          if (pkg.name === 'mcphub' || pkg.name === '@samanhappy/mcphub') {
            cachedPackageRoot = root;
            return;
          }
        } catch {
          // Continue checking
        }
      }
    }
  } catch {
    // If initialization fails, cachedPackageRoot remains undefined
    // and findPackageRoot will search normally
  }
}

// Initialize on module load (unless in test environment)
initializePackageRoot();

/**
 * Find the package root directory (where package.json is located)
 * This works correctly when the package is installed globally or locally
 * @param startPath Starting path to search from (defaults to checking module paths)
 * @returns The package root directory path, or null if not found
 */
export const findPackageRoot = (startPath?: string): string | null => {
  // Return cached value if available and no specific start path is requested
  if (cachedPackageRoot !== undefined && !startPath) {
    return cachedPackageRoot;
  }

  const debug = process.env.DEBUG === 'true';

  // Possible locations for package.json relative to the search path
  const possibleRoots: string[] = [];

  if (startPath) {
    // When start path is provided (from fileURLToPath(import.meta.url))
    possibleRoots.push(
      // When in dist/utils (compiled code) - go up 2 levels
      path.resolve(startPath, '..', '..'),
      // When in dist/ (compiled code) - go up 1 level
      path.resolve(startPath, '..'),
      // Direct parent directories
      path.resolve(startPath),
    );
  }

  // Try to use require.resolve to find the module location (works in CommonJS and ESM with createRequire)
  try {
    // In ESM, we can use import.meta.resolve, but it's async in some versions
    // So we'll try to find the module by checking the node_modules structure

    // Check if this file is in a node_modules installation
    const currentFile = new Error().stack?.split('\n')[2]?.match(/\((.+?):\d+:\d+\)$/)?.[1];
    if (currentFile) {
      const nodeModulesIndex = currentFile.indexOf('node_modules');
      if (nodeModulesIndex !== -1) {
        // Extract the package path from node_modules
        const afterNodeModules = currentFile.substring(
          nodeModulesIndex + 'node_modules'.length + 1,
        );
        const packageNameEnd = afterNodeModules.indexOf(path.sep);
        if (packageNameEnd !== -1) {
          const packagePath = currentFile.substring(
            0,
            nodeModulesIndex + 'node_modules'.length + 1 + packageNameEnd,
          );
          possibleRoots.push(packagePath);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // Check module.filename location (works in Node.js when available)
  if (typeof __filename !== 'undefined') {
    const moduleDir = path.dirname(__filename);
    possibleRoots.push(path.resolve(moduleDir, '..', '..'), path.resolve(moduleDir, '..'));
  }

  // Check common installation locations
  possibleRoots.push(
    // Current working directory (for development/tests)
    process.cwd(),
    // Parent of cwd
    path.resolve(process.cwd(), '..'),
  );

  if (debug) {
    console.log('DEBUG: Searching for package.json from:', startPath || 'multiple locations');
    console.log('DEBUG: Checking paths:', possibleRoots);
  }

  // Remove duplicates
  const uniqueRoots = [...new Set(possibleRoots)];

  for (const root of uniqueRoots) {
    const packageJsonPath = path.join(root, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pkg.name === 'mcphub' || pkg.name === '@samanhappy/mcphub') {
          if (debug) {
            console.log(`DEBUG: Found package.json at ${packageJsonPath}`);
          }
          // Cache the result if no specific start path was requested
          if (!startPath) {
            cachedPackageRoot = root;
          }
          return root;
        }
      } catch (e) {
        // Continue to the next potential root
        if (debug) {
          console.error(`DEBUG: Failed to parse package.json at ${packageJsonPath}:`, e);
        }
      }
    }
  }

  if (debug) {
    console.warn('DEBUG: Could not find package root directory');
  }

  // Cache null result as well to avoid repeated searches
  if (!startPath) {
    cachedPackageRoot = null;
  }

  return null;
};

function getParentPath(p: string, filename: string): string {
  if (p.endsWith(filename)) {
    p = p.slice(0, -filename.length);
  }
  return path.resolve(p);
}

/**
 * Find the path to a configuration file by checking multiple potential locations.
 * @param filename The name of the file to locate (e.g., 'servers.json', 'mcp_settings.json')
 * @param description Brief description of the file for logging purposes
 * @returns The path to the file
 */
export const getConfigFilePath = (filename: string, description = 'Configuration'): string => {
  if (filename === 'mcp_settings.json') {
    const envPath = process.env.MCPHUB_SETTING_PATH;
    if (envPath) {
      // Ensure directory exists
      const dir = getParentPath(envPath, filename);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory for settings at ${dir}`);
      }

      // if full path, return as is
      if (envPath?.endsWith(filename)) {
        return envPath;
      }

      // if directory, return path under that directory
      return path.resolve(envPath, filename);
    }
  }

  const potentialPaths = [
    // Prioritize process.cwd() as the first location to check
    path.resolve(process.cwd(), filename),
    // Use path relative to the root directory
    path.join(rootDir, filename),
    // If installed with npx, may need to look one level up
    path.join(dirname(rootDir), filename),
  ];

  // Also check in the installed package root directory
  const packageRoot = findPackageRoot();
  if (packageRoot) {
    potentialPaths.push(path.join(packageRoot, filename));
  }

  for (const filePath of potentialPaths) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  // If all paths do not exist, check if we have a fallback in the package root
  // If the file exists in the package root, use it as the default
  if (packageRoot) {
    const packageConfigPath = path.join(packageRoot, filename);
    if (fs.existsSync(packageConfigPath)) {
      console.log(`Using ${description} from package: ${packageConfigPath}`);
      return packageConfigPath;
    }
  }

  // If all paths do not exist, use default path
  // Using the default path is acceptable because it ensures the application can proceed
  // even if the configuration file is missing. This fallback is particularly useful in
  // development environments or when the file is optional.
  const defaultPath = path.resolve(process.cwd(), filename);
  console.debug(
    `${description} file not found at any expected location, using default path: ${defaultPath}`,
  );
  return defaultPath;
};
