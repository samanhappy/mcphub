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
  // Handle both development (.ts) and production (.js) environments
  const isDev = process.env.NODE_ENV !== 'production';
  const serviceDir = isDev ? 'src/services' : 'dist/services';
  const fileExt = isDev ? '.ts' : '.js';
  const overridePath = join(process.cwd(), serviceDir, key + 'x' + fileExt);

  try {
    // Use createRequire with a stable path reference
    const require = createRequire(join(process.cwd(), 'package.json'));
    const mod = require(overridePath);
    const override = mod[key.charAt(0).toUpperCase() + key.slice(1) + 'x'];
    if (typeof override === 'function') {
      entry.override = override;
    }
  } catch (error) {
    // Silently ignore if override doesn't exist
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
