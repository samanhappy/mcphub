import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getCredentialBindingDao } from '../dao/DaoFactory.js';
import type { ServerConfig, StoredCredentialBinding } from '../types/index.js';
import {
  CredentialBindingError,
  credentialSlotId,
  validateCredentialTemplate,
} from '../utils/credentialTemplate.js';

export const credentialBindingEvents = new EventEmitter();

const encryptionKey = (): Buffer => {
  const encoded = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY || '';
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new CredentialBindingError(
      'Ask an administrator to configure MCPHUB_CREDENTIAL_ENCRYPTION_KEY (32 random bytes, base64 encoded)',
    );
  }
  return key;
};

const bindingIdentity = (serverName: string, username: string): Buffer =>
  Buffer.from(JSON.stringify([serverName, username]));

const encrypt = (serverName: string, username: string, values: Record<string, string>): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(bindingIdentity(serverName, username));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
};

const decrypt = (binding: StoredCredentialBinding): Record<string, string> => {
  const key = encryptionKey();
  try {
    const [version, iv, tag, ciphertext] = binding.encryptedValues.split('.');
    if (version !== 'v1') throw new Error('Unsupported version');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(bindingIdentity(binding.serverName, binding.username));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch {
    throw new CredentialBindingError(
      'Unable to unlock personal credentials; ask an administrator to check the encryption key or replace your binding',
    );
  }
};

export const missingCredentialError = (serverName: string): CredentialBindingError =>
  new CredentialBindingError(
    `Personal credentials required for '${serverName}'. Bind all required slots in Dashboard → My Credentials.`,
  );

export const getCredentialBindingStatus = async (
  serverName: string,
  username: string,
  config: ServerConfig,
) => {
  const binding = await getCredentialBindingDao().get(serverName, username);
  const slots = validateCredentialTemplate(config) || [];
  const values = binding ? decrypt(binding) : {};
  const configuredSlots = slots
    .map(credentialSlotId)
    .filter((id) => typeof values[id] === 'string' && values[id].length > 0);
  return {
    configured: slots.length > 0 && configuredSlots.length === slots.length,
    configuredSlots,
    updatedAt: binding?.updatedAt ?? null,
  };
};

export const saveCredentialBinding = async (
  serverName: string,
  username: string,
  config: ServerConfig,
  values: unknown,
): Promise<void> => {
  const slots = validateCredentialTemplate(config) || [];
  if (!slots.length)
    throw new CredentialBindingError('This server has no per-user credential slots');
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new CredentialBindingError('Provide values for all declared credential slots');
  const record = values as Record<string, unknown>;
  const ids = slots.map(credentialSlotId);
  if (
    Object.keys(record).some((id) => !ids.includes(id)) ||
    ids.some(
      (id) =>
        typeof record[id] !== 'string' ||
        !(record[id] as string).trim() ||
        (record[id] as string).length > 16384 ||
        (record[id] as string).includes('\0') ||
        (id.startsWith('headers.') && /[\r\n]/.test(record[id] as string)),
    )
  )
    throw new CredentialBindingError(
      'Provide a non-empty value for every declared slot; undeclared slots and invalid header values are not allowed',
    );
  await getCredentialBindingDao().save({
    serverName,
    username,
    encryptedValues: encrypt(serverName, username, record as Record<string, string>),
    updatedAt: new Date().toISOString(),
  });
  credentialBindingEvents.emit('invalidate', { serverName, username });
};

export const deleteCredentialBindings = async (filter: {
  serverName?: string;
  username?: string;
}): Promise<void> => {
  await getCredentialBindingDao().delete(filter);
  credentialBindingEvents.emit('invalidate', filter);
};

export const resolveCredentialBinding = async (
  serverName: string,
  username: string,
  config: ServerConfig,
) => {
  const slots = validateCredentialTemplate(config) || [];
  const binding = await getCredentialBindingDao().get(serverName, username);
  if (!binding) throw missingCredentialError(serverName);
  const values = decrypt(binding);
  const resolved: ServerConfig = {
    ...config,
    env: { ...config.env },
    headers: { ...config.headers },
  };
  for (const slot of slots) {
    const value = values[credentialSlotId(slot)];
    if (typeof value !== 'string' || !value.length) throw missingCredentialError(serverName);
    if (slot.target === 'headers') {
      for (const name of Object.keys(resolved.headers!)) {
        if (name.toLowerCase() === slot.name.toLowerCase()) delete resolved.headers![name];
      }
    }
    resolved[slot.target]![slot.name] = value;
  }
  // Caller-supplied passthrough headers must never override a bound slot.
  const boundHeaders = new Set(
    slots.filter((slot) => slot.target === 'headers').map((slot) => slot.name.toLowerCase()),
  );
  resolved.passthroughHeaders = config.passthroughHeaders?.filter(
    (name) => !boundHeaders.has(name.toLowerCase()),
  );
  if (config.openapi)
    resolved.openapi = {
      ...config.openapi,
      passthroughHeaders: config.openapi.passthroughHeaders?.filter(
        (name) => !boundHeaders.has(name.toLowerCase()),
      ),
    };
  return { config: resolved, revision: binding.encryptedValues };
};
