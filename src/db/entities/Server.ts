import type { CredentialSlot } from '../../types/index.js';
import { emptySafeJsonTransformer } from '../transformers/emptySafeJson.js';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Server configuration entity for database storage
 */
@Entity({ name: 'servers' })
export class Server {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  type?: string; // 'stdio', 'sse', 'streamable-http', 'openapi'

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  tags?: string[];

  @Column({ type: 'text', nullable: true })
  repositoryUrl?: string;

  @Column({ type: 'text', nullable: true })
  documentationUrl?: string;

  @Column({ type: 'text', nullable: true })
  url?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  command?: string;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  args?: string[];

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  env?: Record<string, string>;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  headers?: Record<string, string>;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  owner?: string;

  // Per-server visibility for non-admin users.
  //   'private' — only the owner (or admins) can see this server. Default.
  //   'public'  — every authenticated user can see this server.
  //   'group'   — selected users and user-group members can see this server.
  // See issues #817 and #1037.
  @Column({ type: 'varchar', length: 16, default: 'private' })
  visibility: 'private' | 'group' | 'public';

  @Column({ type: 'text', array: true, nullable: true })
  sharedWithUserGroups?: string[];

  @Column({ type: 'text', array: true, nullable: true })
  sharedWithUsers?: string[];

  @Column({ type: 'boolean', default: false })
  enableKeepAlive?: boolean;

  @Column({ type: 'int', nullable: true })
  keepAliveInterval?: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  protocolNegotiation?: 'auto' | 'legacy';

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  tools?: import('../../types/index.js').ServerConfig['tools'];

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  staging?: import('../../types/index.js').ServerStagingConfig;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  prompts?: Record<string, { enabled: boolean; description?: string }>;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  resources?: Record<string, { enabled: boolean; description?: string }>;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  options?: Record<string, any>;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  oauth?: Record<string, any>;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  proxy?: Record<string, any>;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  openapi?: Record<string, any>;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  passthroughHeaders?: string[];

  @Column({ type: 'boolean', nullable: true })
  perSessionClient?: boolean;

  @Column({ type: 'text', nullable: true, transformer: emptySafeJsonTransformer })
  credentialTemplate?: CredentialSlot[];

  // Internal declaration fingerprint; never exposed through the server DAO.
  @Column({ type: 'varchar', length: 128, nullable: true })
  settingsSyncHash?: string;

  // Internal sync ownership; retained when configuration is edited through the dashboard.
  @Column({ type: 'boolean', default: false })
  settingsSyncManaged?: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default Server;
