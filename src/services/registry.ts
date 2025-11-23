import { join } from 'path';
import { pathToFileURL } from 'url';

type Class<T> = new (...args: any[]) => T;

interface Service<T> {
  defaultImpl: Class<T>;
  override?: Class<T>;
}

const registry = new Map<string, Service<any>>();
const instances = new Map<string, unknown>();

async function tryLoadOverride<T>(key: string, overridePath: string): Promise<Class<T> | undefined> {
  try {
    const moduleUrl = pathToFileURL(overridePath).href;
    const mod = await import(moduleUrl);
    const override = mod[key.charAt(0).toUpperCase() + key.slice(1) + 'x'];
    if (typeof override === 'function') {
      return override as Class<T>;
    }
  } catch (error: any) {
    // Ignore not-found errors and keep trying other paths; surface other errors for visibility
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'MODULE_NOT_FOUND') {
      console.warn(`Failed to load service override from ${overridePath}:`, error);
    }
  }
  return undefined;
}

export async function registerService<T>(key: string, entry: Service<T>) {
  // Try to load override immediately during registration
  // Try multiple paths and file extensions in order
  const serviceDirs = ['src/services', 'dist/services'];
  const fileExts = ['.ts', '.js'];
  const overrideFileName = key + 'x';

  for (const serviceDir of serviceDirs) {
    for (const fileExt of fileExts) {
      const overridePath = join(process.cwd(), serviceDir, overrideFileName + fileExt);

      const override = await tryLoadOverride<T>(key, overridePath);
      if (override) {
        entry.override = override;
        break; // Found override, exit both loops
      }
    }

    // If override was found, break out of outer loop too
    if (entry.override) {
      break;
    }
  }

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
