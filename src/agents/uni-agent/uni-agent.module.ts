import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UniAgentController } from './uni-agent.controller';
import { UniAgentService } from './uni-agent.service';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBase]),
  ],
  controllers: [UniAgentController],
  providers: [UniAgentService],
  exports: [UniAgentService],
})
export class UnifiedAgentModule {}