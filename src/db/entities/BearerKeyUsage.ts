import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Isolated operational usage metadata for bearer keys.
 * Kept out of `bearer_keys` so usage updates never trigger replica configuration revision bumps
 * or race with key edits/resets.
 */
@Entity({ name: 'bearer_key_usage' })
export class BearerKeyUsage {
  @PrimaryColumn({ name: 'key_id', type: 'uuid' })
  keyId: string;

  @Column({ name: 'last_used_at', type: 'timestamptz' })
  lastUsedAt: Date;
}

export default BearerKeyUsage;
