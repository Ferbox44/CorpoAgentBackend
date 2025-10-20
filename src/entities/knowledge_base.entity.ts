import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('knowledge_base')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  tags: string;

  @Column({ type: 'text', nullable: true }) 
  raw_content: string; 
  
  @Column({ type: 'text', nullable: true }) 
  analysis_summary: string; 
  
  @Column({ type: 'varchar', length: 100, nullable: true }) 
  filename: string; 
  
  @Column({ type: 'varchar', length: 20, nullable: true }) 
  file_type: string;
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
