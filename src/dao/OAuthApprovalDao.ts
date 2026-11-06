import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSettingsPath } from '../config/index.js';
import type { OAuthClientApproval } from '../types/index.js';

export interface OAuthApprovalDao {
  findById(id: string): Promise<OAuthClientApproval | null>;
  findByUsername(username: string): Promise<OAuthClientApproval[]>;
  save(approval: OAuthClientApproval): Promise<void>;
  deleteByUserAndClient(username: string, clientId: string): Promise<void>;
  deleteByUsername(username: string): Promise<void>;
  deleteByClientId(clientId: string): Promise<void>;
}

// Consent is runtime state, never part of declarative settings or configuration exports.
// Synchronous read-modify-rename operations cannot interleave within the file-mode process.
export class OAuthApprovalDaoImpl implements OAuthApprovalDao {
  private read(): OAuthClientApproval[] {
    try {
      const rows = JSON.parse(fs.readFileSync(`${getSettingsPath()}.approvals.json`, 'utf8'));
      if (!Array.isArray(rows)) throw new Error('Invalid OAuth approval store');
      return rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private write(rows: OAuthClientApproval[]): void {
    const file = `${getSettingsPath()}.approvals.json`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  async findById(id: string): Promise<OAuthClientApproval | null> {
    return this.read().find((row) => row.id === id) ?? null;
  }

  async findByUsername(username: string): Promise<OAuthClientApproval[]> {
    return this.read().filter((row) => row.username === username);
  }

  async save(approval: OAuthClientApproval): Promise<void> {
    this.write([...this.read().filter((row) => row.id !== approval.id), approval]);
  }

  async deleteByUserAndClient(username: string, clientId: string): Promise<void> {
    this.write(this.read().filter((row) => row.username !== username || row.clientId !== clientId));
  }

  async deleteByClientId(clientId: string): Promise<void> {
    this.write(this.read().filter((row) => row.clientId !== clientId));
  }

  async deleteByUsername(username: string): Promise<void> {
    this.write(this.read().filter((row) => row.username !== username));
  }
}
