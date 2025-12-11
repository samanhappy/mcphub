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
  url?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  command?: string;

  @Column({ type: 'simple-json', nullable: true })
  args?: string[];

  @Column({ type: 'simple-json', nullable: true })
  env?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  headers?: Record<string, string>;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  owner?: string;

  @Column({ type: 'boolean', default: false })
  enableKeepAlive?: boolean;

  @Column({ type: 'int', nullable: true })
  keepAliveInterval?: number;

  @Column({ type: 'simple-json', nullable: true })
  tools?: Record<string, { enabled: boolean; description?: string }>;

  @Column({ type: 'simple-json', nullable: true })
  prompts?: Record<string, { enabled: boolean; description?: string }>;

  @Column({ type: 'simple-json', nullable: true })
  options?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  oauth?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  openapi?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default Server;
