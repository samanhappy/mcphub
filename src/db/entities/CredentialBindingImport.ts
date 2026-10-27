import { Column, Entity, PrimaryColumn } from 'typeorm';

// Receipts survive binding deletion so retained source files cannot restore revoked credentials.
@Entity({ name: 'credential_binding_imports' })
export class CredentialBindingImport {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  fingerprint: string;

  @Column({ type: 'varchar', length: 30 })
  importedAt: string;
}
