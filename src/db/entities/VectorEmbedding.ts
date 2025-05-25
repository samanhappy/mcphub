import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'vector_embeddings' })
export class VectorEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  content_type: string; // 'market_server', 'tool', 'documentation', etc.

  @Column({ type: 'varchar' })
  content_id: string; // Reference ID to the original content

  @Column('text')
  text_content: string; // The text that was embedded

  @Column('simple-json')
  metadata: Record<string, any>; // Additional metadata about the embedding

  @Column({
    type: 'float',
    array: true,
    nullable: true,
  })
  embedding: number[]; // The vector embedding - will be converted to vector type after table creation

  @Column({ type: 'int' })
  dimensions: number; // Dimensionality of the embedding vector

  @Column({ type: 'varchar' })
  model: string; // Model used to create the embedding

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

export default VectorEmbedding;
