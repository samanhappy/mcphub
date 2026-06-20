import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Group entity for database storage
 */
@Entity({ name: 'groups' })
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'simple-json' })
  servers: Array<
    | string
    | {
        name: string;
        alias?: string;
        tools?: string[] | 'all';
        prompts?: string[] | 'all';
        resources?: string[] | 'all';
      }
  >;

  @Column({ type: 'varchar', length: 255, nullable: true })
  owner?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default Group;
