import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSettingsPath } from '../config/index.js';
import type { UserPasskey } from '../types/index.js';

export interface PasskeyDao {
  findById(id: string): Promise<UserPasskey | null>;
  findByCredentialId(credentialId: string): Promise<UserPasskey | null>;
  findByUsername(username: string): Promise<UserPasskey[]>;
  save(passkey: UserPasskey): Promise<void>;
  /**
   * Records a sign-in on an existing passkey, atomically with the signature
   * counter check: the stored counter only moves forward (see
   * `isCounterAdvance`). Returns false, and changes nothing, when the passkey
   * no longer exists or the counter does not advance, for example when a
   * concurrent sign-in already stored a higher one. Never recreates a removed
   * passkey.
   */
  recordUse(id: string, use: PasskeyUse): Promise<boolean>;
  delete(id: string): Promise<void>;
  deleteByUsername(username: string): Promise<void>;
}

export type PasskeyUse = Pick<UserPasskey, 'counter' | 'backedUp' | 'lastUsedAt'>;

/**
 * WebAuthn counter rule: a nonzero counter must exceed the stored one, while an
 * authenticator without counters (most synced passkeys) keeps reporting 0.
 */
export const isCounterAdvance = (stored: number, next: number): boolean =>
  next === 0 ? stored === 0 : next > stored;

export const getPasskeyStorePath = (): string => `${getSettingsPath()}.passkeys.json`;

// Passkeys are runtime state, never part of declarative settings or configuration exports.
// Synchronous read-modify-rename operations cannot interleave within the file-mode process.
export class PasskeyDaoImpl implements PasskeyDao {
  private read(): UserPasskey[] {
    try {
      const rows = JSON.parse(fs.readFileSync(getPasskeyStorePath(), 'utf8'));
      if (!Array.isArray(rows)) throw new Error('Invalid passkey store');
      return rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private write(rows: UserPasskey[]): void {
    const file = getPasskeyStorePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  async findById(id: string): Promise<UserPasskey | null> {
    return this.read().find((row) => row.id === id) ?? null;
  }

  async findByCredentialId(credentialId: string): Promise<UserPasskey | null> {
    return this.read().find((row) => row.credentialId === credentialId) ?? null;
  }

  async findByUsername(username: string): Promise<UserPasskey[]> {
    return this.read().filter((row) => row.username === username);
  }

  async save(passkey: UserPasskey): Promise<void> {
    const rows = this.read();
    // Mirror the unique constraint the database enforces on credentialId.
    if (rows.some((row) => row.credentialId === passkey.credentialId && row.id !== passkey.id)) {
      throw new Error('Passkey credential is already registered');
    }
    this.write([...rows.filter((row) => row.id !== passkey.id), passkey]);
  }

  async recordUse(id: string, use: PasskeyUse): Promise<boolean> {
    const rows = this.read();
    const index = rows.findIndex((row) => row.id === id);
    // Check and write without yielding, so no other update interleaves in this process
    if (index === -1 || !isCounterAdvance(rows[index].counter, use.counter)) return false;
    rows[index] = { ...rows[index], ...use };
    this.write(rows);
    return true;
  }

  async delete(id: string): Promise<void> {
    this.write(this.read().filter((row) => row.id !== id));
  }

  async deleteByUsername(username: string): Promise<void> {
    this.write(this.read().filter((row) => row.username !== username));
  }
}
