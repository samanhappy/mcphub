import { createRequire } from 'module';
import { join } from 'path';

type Class<T> = new (...args: any[]) => T;

interface Service<T> {
  defaultImpl: Class<T>;
  override?: Class<T>;
}

const registry = new Map<string, Service<any>>();
const instances = new Map<string, unknown>();

export function registerService<T>(key: string, entry: Service<T>) {
  // Try to load override immediately during registration
  // Try multiple paths and file extensions in order
  const serviceDirs = ['src/services', 'dist/services'];
  const fileExts = ['.ts', '.js'];
  const overrideFileName = key + 'x';

  for (const serviceDir of serviceDirs) {
    for (const fileExt of fileExts) {
      const overridePath = join(process.cwd(), serviceDir, overrideFileName + fileExt);

      try {
        // Use createRequire with a stable path reference
        const require = createRequire(join(process.cwd(), 'package.json'));
        const mod = require(overridePath);
        const override = mod[key.charAt(0).toUpperCase() + key.slice(1) + 'x'];
        if (typeof override === 'function') {
          entry.override = override;
          break; // Found override, exit both loops
        }
      } catch (error) {
        // Continue trying next path/extension combination
        continue;
      }
    }

    // If override was found, break out of outer loop too
    if (entry.override) {
      break;
    }
  }

  console.log(`Service registered: ${key} with entry:`, entry);
  registry.set(key, entry);
}

export function getService<T>(key: string): T {
  if (instances.has(key)) {
    return instances.get(key) as T;
  }

  const entry = registry.get(key);
  if (!entry) throw new Error(`Service not registered for key: ${key.toString()}`);

  // Use override if available, otherwise use default
  const Impl = entry.override || entry.defaultImpl;

  const instance = new Impl();
  instances.set(key, instance);
  return instance;
}
