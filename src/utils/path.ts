import fs from 'fs';
import path from 'path';
import { dirname } from 'path';

// Project root directory - use process.cwd() as a simpler alternative
const rootDir = process.cwd();

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
      // check envPath is file or directory
      const stats = fs.statSync(envPath);
      if (stats.isFile()) {
        return envPath;
      }
      // if directory, return path under that directory
      return path.resolve(envPath, filename);
    }
  }

  const potentialPaths = [
    ...[
      // Prioritize process.cwd() as the first location to check
      path.resolve(process.cwd(), filename),
      // Use path relative to the root directory
      path.join(rootDir, filename),
      // If installed with npx, may need to look one level up
      path.join(dirname(rootDir), filename),
    ],
  ];

  for (const filePath of potentialPaths) {
    if (fs.existsSync(filePath)) {
      return filePath;
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
