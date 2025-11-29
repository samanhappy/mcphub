import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * System configuration entity for database storage
 * Using singleton pattern - only one record with id = 'default'
 */
@Entity({ name: 'system_config' })
export class SystemConfig {
  @PrimaryColumn({ type: 'varchar', length: 50, default: 'default' })
  id: string;

  @Column({ type: 'simple-json', nullable: true })
  routing?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  install?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  smartRouting?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  mcpRouter?: Record<string, any>;

  @Column({ type: 'varchar', length: 10, nullable: true })
  nameSeparator?: string;

  @Column({ type: 'simple-json', nullable: true })
  oauth?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  oauthServer?: Record<string, any>;

  @Column({ type: 'boolean', nullable: true })
  enableSessionRebuild?: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default SystemConfig;
