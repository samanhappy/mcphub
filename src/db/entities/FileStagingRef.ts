import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Authoritative ledger row for one staged file (#1056). The ledger is the
 * source of truth; `meta.json` next to the content is only a cache.
 *
 * `leaseId` is set before the upstream tool is called and cleared at
 * finalization. There is deliberately no runtime TTL: a crash is resolved by
 * the startup sweep, which turns leased `reserved` rows into terminal
 * `failed`, rather than by letting a second writer steal an expired lease.
 */
@Entity({ name: 'file_staging_refs' })
export class FileStagingRefEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ref: string;

  @Column({ type: 'varchar', length: 36 })
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  ownerHash: string;

  @Column({ type: 'varchar', length: 64 })
  serverId: string;

  @Column({ type: 'varchar', length: 255 })
  serverName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  toolName?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  filename?: string | null;

  @Column({ type: 'varchar', length: 16 })
  state: string;

  @Column({ type: 'integer', default: 0 })
  size: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sha256?: string | null;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'boolean', default: false })
  allowZeroByte: boolean;

  @Column({ type: 'integer', nullable: true })
  reservedBytes?: number | null;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Index()
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  leaseId?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  leaseUntil?: Date | null;

  @Column({ type: 'integer', default: 0 })
  pinCount: number;

  @Column({ type: 'timestamp', nullable: true })
  pinUntil?: Date | null;
}
