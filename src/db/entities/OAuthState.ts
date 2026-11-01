import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/** Short-lived OAuth state shared by replicas; bearer values are stored only as hashes. */
@Entity({ name: 'oauth_state' })
export class OAuthState {
  @PrimaryColumn({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'varchar', length: 32 })
  kind: 'authorization_code' | 'registration';

  @Column({ name: 'client_id', type: 'varchar' })
  clientId: string;

  @Column({ type: 'varchar', nullable: true })
  username?: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
