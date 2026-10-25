import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'capability_snapshots' })
export class CapabilitySnapshot {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  serverName: string;

  // Empty for the shared runtime; personal runtimes always use their username.
  @PrimaryColumn({ type: 'varchar', length: 255 })
  principal: string;

  @Column({ type: 'text' })
  fingerprint: string;

  @Column({ type: 'varchar', length: 30 })
  capturedAt: string;

  @Column({ type: 'text' })
  tools: string;
}
