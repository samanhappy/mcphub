import type { CredentialSlot, ServerConfig } from '../types/index.js';

export class CredentialBindingError extends Error {}

export const hasCredentialTemplate = (config?: ServerConfig): boolean =>
  Array.isArray(config?.credentialTemplate) && config.credentialTemplate.length > 0;

export const credentialSlotId = (slot: CredentialSlot): string => `${slot.target}.${slot.name}`;

export const validateCredentialTemplate = (config: ServerConfig): CredentialSlot[] | undefined => {
  const slots = config.credentialTemplate;
  if (slots === undefined || slots === null) return undefined;
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
      slot.target !== (stdio ? 'env' : 'headers') ||
      typeof slot.name !== 'string' ||
      slot.name.length > 128 ||
      !(stdio ? /^[A-Za-z_][A-Za-z0-9_]*$/ : /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).test(slot.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(slot.name.toLowerCase()) ||
      (slot.label !== undefined && (typeof slot.label !== 'string' || slot.label.length > 200))
    ) {
      throw new CredentialBindingError(
        'Invalid credential slot: use env for stdio or headers for HTTP servers',
      );
    }
    const id = stdio ? slot.name : slot.name.toLowerCase();
    if (ids.has(id)) throw new CredentialBindingError('Duplicate credential slot');
    ids.add(id);
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
