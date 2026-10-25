import { getAppDataSource } from '../db/connection.js';
import { CapabilitySnapshot } from '../db/entities/CapabilitySnapshot.js';
import type { CapabilitySnapshot as Snapshot } from '../types/index.js';
import type { CapabilitySnapshotDao } from './CapabilitySnapshotDao.js';

export class CapabilitySnapshotDaoDbImpl implements CapabilitySnapshotDao {
  private get repository() {
    return getAppDataSource().getRepository(CapabilitySnapshot);
  }

  async get(serverName: string, principal: string): Promise<Snapshot | null> {
    const row = await this.repository.findOneBy({ serverName, principal });
    return row ? { ...row, tools: JSON.parse(row.tools) } : null;
  }

  async save(snapshot: Snapshot): Promise<void> {
    await this.repository.upsert({ ...snapshot, tools: JSON.stringify(snapshot.tools) }, [
      'serverName',
      'principal',
    ]);
  }
}
