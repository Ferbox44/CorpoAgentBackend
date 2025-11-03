import { Controller, Get, Delete, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { KnowledgeBaseService } from './knowledge-base.service';

@Controller('knowledge-base')
@UseGuards(JwtAuthGuard)
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Get()
  async list() {
    return this.knowledgeBaseService.findAll();
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.knowledgeBaseService.remove(id);
  }
}


