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

export const credentialSlotId = (slot: CredentialSlot): string => `${slot.target}.${slot.name}`;

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
      Object.keys(slot).some((key) => !['target', 'name', 'label'].includes(key)) ||
      !(stdio ? ['env', 'args'] : ['headers']).includes(slot.target) ||
      typeof slot.name !== 'string' ||
      slot.name.length > 128 ||
      !(stdio ? /^[A-Za-z_][A-Za-z0-9_]*$/ : /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).test(slot.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(slot.name.toLowerCase()) ||
      (slot.label !== undefined && (typeof slot.label !== 'string' || slot.label.length > 200))
    ) {
      throw new CredentialBindingError(
        'Invalid credential slot: use env or args for stdio, or headers for HTTP servers',
      );
    }
    const id = `${slot.target}.${stdio ? slot.name : slot.name.toLowerCase()}`;
    if (ids.has(id)) throw new CredentialBindingError('Duplicate credential slot');
    ids.add(id);
  }
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
  if (slots.length && config.oauth && Object.keys(config.oauth).length > 0) {
    throw new CredentialBindingError(
      'Per-user credential slots cannot be combined with shared OAuth',
    );
  }
  return slots.length
    ? slots.map(({ target, name, label }) => ({ target, name, ...(label ? { label } : {}) }))
    : undefined;
};
