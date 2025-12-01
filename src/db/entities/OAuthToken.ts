import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * OAuth Token entity for database storage
 * Represents OAuth tokens issued by MCPHub's authorization server
 */
@Entity({ name: 'oauth_tokens' })
export class OAuthToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'access_token', type: 'varchar', length: 512, unique: true })
  accessToken: string;

  @Column({ name: 'access_token_expires_at', type: 'timestamp' })
  accessTokenExpiresAt: Date;

  @Index()
  @Column({ name: 'refresh_token', type: 'varchar', length: 512, nullable: true, unique: true })
  refreshToken?: string;

  @Column({ name: 'refresh_token_expires_at', type: 'timestamp', nullable: true })
  refreshTokenExpiresAt?: Date;

  @Column({ type: 'varchar', length: 512, nullable: true })
  scope?: string;

  @Index()
  @Column({ name: 'client_id', type: 'varchar', length: 255 })
  clientId: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  username: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default OAuthToken;
