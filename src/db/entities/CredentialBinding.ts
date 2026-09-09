import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'credential_bindings' })
export class CredentialBinding {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  serverName: string;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  username: string;

  @Column({ type: 'text' })
  encryptedValues: string;

  @Column({ type: 'varchar', length: 30 })
  updatedAt: string;
}
