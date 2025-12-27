import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Bearer authentication key entity
 * Stores multiple bearer keys with per-key enable/disable and scoped access control
 */
@Entity({ name: 'bearer_keys' })
export class BearerKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 512 })
  token: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 20, default: 'all' })
  accessType: 'all' | 'groups' | 'servers' | 'custom';

  @Column({ type: 'simple-json', nullable: true })
  allowedGroups?: string[];

  @Column({ type: 'simple-json', nullable: true })
  allowedServers?: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default BearerKey;
