import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { JWT_SECRET } from '../config/jwt.js';
import type { CredentialValues, EncryptedCredentialValues } from '../types/index.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_SALT = 'mcphub-credential-binding-v1';
const KEY_INFO = 'credential-values-at-rest';
const DECRYPTION_ERROR = 'Credential binding cannot be read';

export interface CredentialEncryptionContext {
  username: string;
}

const getEncryptionKey = (): Buffer => {
  const keyMaterial = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY || JWT_SECRET;
  return Buffer.from(hkdfSync('sha256', keyMaterial, KEY_SALT, KEY_INFO, KEY_BYTES));
};

const getAdditionalData = (context: CredentialEncryptionContext): Buffer =>
  Buffer.from(context.username, 'utf8');

export const encryptCredentialValues = (
  values: CredentialValues,
  context: CredentialEncryptionContext,
): EncryptedCredentialValues => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  cipher.setAAD(getAdditionalData(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(values), 'utf8'),
    cipher.final(),
  ]);

  return {
    version: 1,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
};

export const decryptCredentialValues = (
  encrypted: EncryptedCredentialValues,
  context: CredentialEncryptionContext,
): CredentialValues => {
  try {
    if (encrypted.version !== 1) {
      throw new Error('Unsupported credential encryption version');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      getEncryptionKey(),
      Buffer.from(encrypted.iv, 'base64url'),
    );
    decipher.setAAD(getAdditionalData(context));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    return JSON.parse(plaintext) as CredentialValues;
  } catch {
    throw new Error(DECRYPTION_ERROR);
  }
};
