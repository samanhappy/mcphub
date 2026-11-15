import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One-time download token for a ready staged file (#1056). Only the SHA-256 of
 * the token is stored; the raw token never reaches the database or logs.
 */
@Entity({ name: 'file_staging_tokens' })
export class FileStagingTokenEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  ref: string;

  @Column({ type: 'varchar', length: 64 })
  ownerHash: string;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'varchar', length: 64 })
  contentHash: string;

  @Index()
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date | null;
}
