import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { EncryptedCredentialValues } from '../../types/index.js';

@Entity({ name: 'credential_bindings' })
@Index(['serverName', 'username'], { unique: true })
export class CredentialBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'server_name', type: 'varchar', length: 255 })
  serverName: string;

  @Column({ type: 'varchar', length: 255 })
  username: string;

  @Column({ name: 'encrypted_values', type: 'simple-json' })
  encryptedValues: EncryptedCredentialValues;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default CredentialBinding;
