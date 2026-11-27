import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { BearerKey } from './BearerKey.js';

/**
 * Isolated operational usage metadata for bearer keys.
 * Kept out of `bearer_keys` so usage updates never trigger replica configuration revision bumps
 * or race with key edits/resets.
 */
@Entity({ name: 'bearer_key_usage' })
export class BearerKeyUsage {
  @PrimaryColumn({ name: 'key_id', type: 'uuid' })
  keyId: string;

  @OneToOne(() => BearerKey, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_id', referencedColumnName: 'id' })
  bearerKey?: BearerKey;

  @Column({ name: 'last_used_at', type: 'timestamptz' })
  lastUsedAt: Date;
}

export default BearerKeyUsage;
