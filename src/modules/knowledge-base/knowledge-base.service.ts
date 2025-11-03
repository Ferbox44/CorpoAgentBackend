import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
  ) {}

  async findAll(): Promise<KnowledgeBase[]> {
    return this.knowledgeBaseRepository.find({ order: { createdAt: 'DESC' } });
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const result = await this.knowledgeBaseRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('Knowledge base file not found');
    }
    return { success: true };
  }
}


