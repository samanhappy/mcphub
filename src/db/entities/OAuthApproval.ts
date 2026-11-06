import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { OAuthClientApproval } from '../../types/index.js';

@Entity({ name: 'oauth_client_approvals' })
export class OAuthApproval implements OAuthClientApproval {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  username: string;

  @Column({ type: 'varchar', length: 64 })
  sessionVersion: string;

  @Column({ type: 'text' })
  clientId: string;

  @Column({ type: 'varchar', length: 64 })
  clientFingerprint: string;

  @Column({ type: 'text' })
  redirectUri: string;

  @Column({ type: 'text' })
  resource: string;

  @Column({ type: 'simple-json' })
  scopes: string[];

  @Column({ type: 'varchar', length: 30 })
  approvedAt: string;

  @Column({ type: 'varchar', length: 30 })
  expiresAt: string;
}
