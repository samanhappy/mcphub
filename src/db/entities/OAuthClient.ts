import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * OAuth Client entity for database storage
 * Represents OAuth clients registered with MCPHub's authorization server
 */
@Entity({ name: 'oauth_clients' })
export class OAuthClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'varchar', length: 255, unique: true })
  clientId: string;

  @Column({ name: 'client_secret', type: 'varchar', length: 255, nullable: true })
  clientSecret?: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'redirect_uris', type: 'simple-json' })
  redirectUris: string[];

  @Column({ type: 'simple-json' })
  grants: string[];

  @Column({ type: 'simple-json', nullable: true })
  scopes?: string[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  owner?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: {
    application_type?: 'web' | 'native';
    response_types?: string[];
    token_endpoint_auth_method?: string;
    contacts?: string[];
    logo_uri?: string;
    client_uri?: string;
    policy_uri?: string;
    tos_uri?: string;
    jwks_uri?: string;
    jwks?: object;
  };

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default OAuthClient;
