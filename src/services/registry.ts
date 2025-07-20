type Class<T> = new (...args: any[]) => T;

interface Service<T> {
  defaultImpl: Class<T>;
}

const registry = new Map<string, Service<any>>();
const instances = new Map<string, unknown>();

export function registerService<T>(key: string, entry: Service<T>) {
  registry.set(key, entry);
}

export function getService<T>(key: string): T {
  if (instances.has(key)) {
    return instances.get(key) as T;
  }

  const entry = registry.get(key);
  if (!entry) throw new Error(`Service not registered for key: ${key.toString()}`);

  let Impl = entry.defaultImpl;

  const overridePath = './' + key + 'x.js';
  import(overridePath)
    .then((mod) => {
      const override = mod[key.charAt(0).toUpperCase() + key.slice(1) + 'x'] ?? Impl.name;
      if (typeof override === 'function') {
        Impl = override;
      }
    })
    .catch(() => {});

  const instance = new Impl();
  instances.set(key, instance);
  return instance;
}
