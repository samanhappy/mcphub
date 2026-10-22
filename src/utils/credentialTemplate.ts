import type { CredentialSlot, ServerConfig } from '../types/index.js';

export class CredentialBindingError extends Error {}

// Runtime-only values must never become part of a serializable server configuration.
export const argumentCredentialBindings = new WeakMap<ServerConfig, Record<string, string>>();
const argumentSlotPattern = /\{\{args\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

export const resolveCredentialArguments = (config: ServerConfig, args: string[]): string[] =>
  args.map((arg) => {
    if (arg.replace(argumentSlotPattern, '').includes('{{args.')) {
      throw new CredentialBindingError('Invalid args credential reference');
    }
    return arg.replace(argumentSlotPattern, (_reference, name: string) => {
      const value = argumentCredentialBindings.get(config)?.[name];
      if (value === undefined) throw new CredentialBindingError('Missing args credential binding');
      return value;
    });
  });

export const hasCredentialTemplate = (config?: ServerConfig): boolean =>
  Array.isArray(config?.credentialTemplate) && config.credentialTemplate.length > 0;

export const hasPersonalAuthentication = (config?: ServerConfig): boolean =>
  hasCredentialTemplate(config) || config?.oauth?.identityMode === 'personal';

export const credentialSlotId = (slot: CredentialSlot): string => `${slot.target}.${slot.name}`;

export const hasUrlCredentialSlots = (config: ServerConfig): boolean =>
  !!config.credentialTemplate?.some((slot) => slot.target === 'url');

export const isCredentialValueAllowed = (slot: CredentialSlot, value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  (slot.target !== 'url' || !!slot.allowed?.includes(value));

// Validate raw components before URL normalization can hide separators or dot segments.
const validateUrlSlots = (config: ServerConfig, slots: CredentialSlot[]): void => {
  const url = config.url || '';
  const referenced = new Set<string>();
  if (!hasUrlCredentialSlots(config) && !url.includes('{{url.')) return;
  if (!['sse', 'streamable-http', undefined].includes(config.type))
    throw new CredentialBindingError('URL slots require an SSE or Streamable HTTP server');
  const parts = /^(https?:\/\/)([^/?#]+)([^?#]*)(.*)$/.exec(url);
  if (!parts) throw new CredentialBindingError('Invalid URL credential template');
  const checkComponent = (part: string, host: boolean): string => {
    const match = /^\{\{url\.([A-Za-z_][A-Za-z0-9_]*)\}\}$/.exec(part);
    if (!match) return part;
    const slot = slots.find((item) => item.target === 'url' && item.name === match[1]);
    if (
      !slot ||
      !slot.allowed?.every((value) =>
        host
          ? /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(value)
          : /^[A-Za-z0-9_.~-]+$/.test(value) && value !== '.' && value !== '..',
      )
    )
      throw new CredentialBindingError('URL slot values must fill one host label or path segment');
    referenced.add(slot.name);
    return 'slot';
  };
  const [, host, port = ''] = /^(.*?)(:\d+)?$/.exec(parts[2])!;
  const authority = host
    .split(/\.(?![^{}]*\}\})/)
    .map((part) => checkComponent(part, true))
    .join('.');
  const pathname = parts[3]
    .split('/')
    .map((part) => checkComponent(part, false))
    .join('/');
  const replaced = parts[1] + authority + port + pathname + parts[4];
  if (
    replaced.includes('{{url.') ||
    slots.some((slot) => slot.target === 'url' && !referenced.has(slot.name))
  )
    throw new CredentialBindingError(
      'URL slots must be referenced as complete host labels or path segments',
    );
  try {
    new URL(replaced);
  } catch {
    throw new CredentialBindingError('Invalid URL credential template');
  }
};

export const resolveCredentialUrl = (
  config: ServerConfig,
  values: Record<string, string>,
): string | undefined =>
  config.url?.replace(/\{\{url\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_reference, name: string) => {
    const slot = config.credentialTemplate?.find(
      (item) => item.target === 'url' && item.name === name,
    );
    const value = values[`url.${name}`];
    if (!slot || !isCredentialValueAllowed(slot, value))
      throw new CredentialBindingError('Invalid URL credential binding');
    return value;
  });

export const validateCredentialTemplate = (config: ServerConfig): CredentialSlot[] | undefined => {
  const slots = config.credentialTemplate ?? [];
  if (!Array.isArray(slots) || slots.length > 32) {
    throw new CredentialBindingError('Credential template must contain at most 32 slots');
  }
  const stdio = config.type === 'stdio' || (!config.type && !!config.command && !config.url);
  const ids = new Set<string>();
  for (const slot of slots) {
    if (
      !slot ||
      typeof slot !== 'object' ||
      Object.keys(slot).some(
        (key) =>
          !['target', 'name', 'label', ...(slot.target === 'url' ? ['allowed'] : [])].includes(key),
      ) ||
      !(stdio ? ['env', 'args'] : ['headers', 'url']).includes(slot.target) ||
      typeof slot.name !== 'string' ||
      slot.name.length > 128 ||
      !(
        stdio || slot.target === 'url'
          ? /^[A-Za-z_][A-Za-z0-9_]*$/
          : /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
      ).test(slot.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(slot.name.toLowerCase()) ||
      (slot.label !== undefined && (typeof slot.label !== 'string' || slot.label.length > 200))
    ) {
      throw new CredentialBindingError(
        'Invalid credential slot: use env or args for stdio, or headers/url for HTTP servers',
      );
    }
    if (
      slot.target === 'url' &&
      (!Array.isArray(slot.allowed) ||
        !slot.allowed.length ||
        slot.allowed.length > 256 ||
        slot.allowed.some(
          (value) => typeof value !== 'string' || !value.length || value.length > 256,
        ) ||
        new Set(slot.allowed).size !== slot.allowed.length)
    )
      throw new CredentialBindingError(
        'URL slots require a non-empty unique allowed list (at most 256 values)',
      );
    const id = `${slot.target}.${slot.target === 'headers' ? slot.name.toLowerCase() : slot.name}`;
    if (ids.has(id)) throw new CredentialBindingError('Duplicate credential slot');
    ids.add(id);
  }
  validateUrlSlots(config, slots);
  const referencedArgs = new Set<string>();
  for (const arg of config.args ?? []) {
    if (typeof arg !== 'string') throw new CredentialBindingError('Arguments must be strings');
    const remainder = arg.replace(argumentSlotPattern, (_reference, name: string) => {
      if (!stdio || !ids.has(`args.${name}`)) {
        throw new CredentialBindingError('Unknown args credential reference');
      }
      referencedArgs.add(name);
      return '';
    });
    if (remainder.includes('{{args.')) {
      throw new CredentialBindingError('Invalid args credential reference');
    }
  }
  if (slots.some((slot) => slot.target === 'args' && !referencedArgs.has(slot.name))) {
    throw new CredentialBindingError('Every args slot must be referenced in arguments');
  }
  // Older dashboard versions persisted the default identity label even when
  // OAuth was never configured. Only that bare shared label is harmless.
  const hasOAuthConfig =
    config.oauth &&
    Object.keys(config.oauth).some(
      (key) => key !== 'identityMode' || config.oauth?.identityMode !== 'shared',
    );
  if (slots.length && hasOAuthConfig) {
    throw new CredentialBindingError(
      'Per-user credential slots cannot be combined with shared OAuth',
    );
  }
  return slots.length
    ? slots.map(({ target, name, label, allowed }) => ({
        target,
        name,
        ...(label ? { label } : {}),
        ...(allowed ? { allowed: [...allowed] } : {}),
      }))
    : undefined;
};
