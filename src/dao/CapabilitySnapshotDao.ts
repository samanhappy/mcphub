import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSettingsPath } from '../config/index.js';
import type { CapabilitySnapshot } from '../types/index.js';

export interface CapabilitySnapshotDao {
  get(serverName: string, principal: string): Promise<CapabilitySnapshot | null>;
  save(snapshot: CapabilitySnapshot): Promise<void>;
}

// Runtime discovery data stays outside declarative settings and config exports.
export class CapabilitySnapshotDaoImpl implements CapabilitySnapshotDao {
  private read(): CapabilitySnapshot[] {
    try {
      const rows = JSON.parse(fs.readFileSync(`${getSettingsPath()}.capabilities.json`, 'utf8'));
      if (!Array.isArray(rows)) throw new Error('Invalid capability snapshot store');
      return rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async get(serverName: string, principal: string): Promise<CapabilitySnapshot | null> {
    return (
      this.read().find((row) => row.serverName === serverName && row.principal === principal) ??
      null
    );
  }

  async save(snapshot: CapabilitySnapshot): Promise<void> {
    const rows = this.read().filter(
      (row) => row.serverName !== snapshot.serverName || row.principal !== snapshot.principal,
    );
    const file = `${getSettingsPath()}.capabilities.json`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify([...rows, snapshot]), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}
