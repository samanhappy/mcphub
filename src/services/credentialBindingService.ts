import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { getSettingsPath } from '../config/index.js';
import { getCredentialBindingDao } from '../dao/DaoFactory.js';
import { RequestContextService } from './requestContextService.js';
import { getT } from '../utils/i18n.js';
import type { ServerConfig, StoredCredentialBinding } from '../types/index.js';
import {
  CredentialBindingError,
  credentialSlotId,
  validateCredentialTemplate,
} from '../utils/credentialTemplate.js';

export const credentialBindingEvents = new EventEmitter();

const parseEncryptionKey = (encoded: string): Buffer => {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new CredentialBindingError(
      'Invalid encryption key: MCPHUB_CREDENTIAL_ENCRYPTION_KEY or its local key file must contain 32 random bytes, base64 encoded',
    );
  }
  return key;
};

const encryptionKey = async (allowCreate = false): Promise<Buffer> => {
  const configured = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  if (configured !== undefined) return parseEncryptionKey(configured);
  const file = `${getSettingsPath()}.credentials.key`;
  const readKey = (): Buffer | undefined => {
    try {
      return parseEncryptionKey(fs.readFileSync(file, 'utf8').trim());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (error instanceof CredentialBindingError) throw error;
      throw new CredentialBindingError(
        'Unable to read the personal credential encryption key file',
      );
    }
  };
  const existing = readKey();
  if (existing) return existing;
  const missing = () =>
    new CredentialBindingError(
      'Personal credential encryption key is missing. Restore the key file or MCPHUB_CREDENTIAL_ENCRYPTION_KEY before using existing bindings',
    );
  if (!allowCreate) throw missing();
  const hasBindings = await getCredentialBindingDao().hasBindings();
  // Another process may have created the key while storage was being checked.
  const createdElsewhere = readKey();
  if (createdElsewhere) return createdElsewhere;
  if (hasBindings) throw missing();

  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
    try {
      // Publish a complete key atomically without replacing a concurrent creator's key.
      fs.linkSync(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const key = readKey();
    if (!key) throw missing();
    return key;
  } catch (error) {
    if (error instanceof CredentialBindingError) throw error;
    throw new CredentialBindingError(
      'Unable to persist the personal credential encryption key. Make the settings directory writable or configure MCPHUB_CREDENTIAL_ENCRYPTION_KEY',
    );
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};

const bindingIdentity = (serverName: string, username: string): Buffer =>
  Buffer.from(JSON.stringify([serverName, username]));

const encrypt = async (
  serverName: string,
  username: string,
  values: Record<string, string>,
): Promise<string> => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await encryptionKey(true), iv);
  cipher.setAAD(bindingIdentity(serverName, username));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
};

const decrypt = async (binding: StoredCredentialBinding): Promise<Record<string, string>> => {
  const key = await encryptionKey();
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

const requestLanguage = (): string | undefined => {
  const context = RequestContextService.getInstance();
  const configured = context.getHeader('x-language') ?? context.getHeader('accept-language');
  const language = Array.isArray(configured) ? configured[0] : configured;
  return language?.split(',')[0].split(';')[0].trim() || undefined;
};

export const missingCredentialError = (serverName: string): CredentialBindingError =>
  new CredentialBindingError(getT(requestLanguage())('credentials.missing', { serverName }));

export const getCredentialBindingStatus = async (
  serverName: string,
  username: string,
  config: ServerConfig,
) => {
  const binding = await getCredentialBindingDao().get(serverName, username);
  const slots = validateCredentialTemplate(config) || [];
  const values = binding ? await decrypt(binding) : {};
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
    encryptedValues: await encrypt(serverName, username, record as Record<string, string>),
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
  const values = await decrypt(binding);
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
