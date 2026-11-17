import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { UserPasskey } from '../../types/index.js';

// WebAuthn signature counters are unsigned 32-bit values, beyond PostgreSQL integer.
const counterTransformer = {
  to: (value: number) => value,
  from: (value: string | number | null) => Number(value ?? 0),
};

@Entity({ name: 'user_passkeys' })
export class Passkey implements UserPasskey {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Index('IDX_user_passkeys_username')
  @Column({ type: 'varchar', length: 255 })
  username: string;

  @Index('IDX_user_passkeys_credential', { unique: true })
  @Column({ type: 'text' })
  credentialId: string;

  @Column({ type: 'text' })
  publicKey: string;

  @Column({ type: 'bigint', default: 0, transformer: counterTransformer })
  counter: number;

  @Column({ type: 'simple-json', nullable: true })
  transports?: string[] | null;

  @Column({ type: 'varchar', length: 128 })
  userHandle: string;

  @Column({ type: 'varchar', length: 255 })
  rpId: string;

  @Column({ type: 'varchar', length: 64 })
  sessionVersion: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  deviceType: 'singleDevice' | 'multiDevice';

  @Column({ type: 'boolean', default: false })
  backedUp: boolean;

  @Column({ type: 'varchar', length: 30 })
  createdAt: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  lastUsedAt?: string | null;
}
