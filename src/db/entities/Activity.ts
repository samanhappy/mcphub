import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * Activity entity for tracking tool call history
 * Only available in database mode
 */
@Entity({ name: 'activities' })
@Index(['server'])
@Index(['tool'])
@Index(['status'])
@Index(['group'])
@Index(['keyId'])
@Index(['timestamp'])
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'timestamp', type: 'timestamp' })
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  server: string;

  @Column({ type: 'varchar', length: 255 })
  tool: string;

  @Column({ type: 'int' })
  duration: number;

  @Column({ type: 'varchar', length: 20 })
  status: string; // 'success' | 'error'

  @Column({ type: 'text', nullable: true })
  input?: string;

  @Column({ type: 'text', nullable: true })
  output?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'group_name' })
  group?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'key_id' })
  keyId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'key_name' })
  keyName?: string;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage?: string;
}

export default Activity;
