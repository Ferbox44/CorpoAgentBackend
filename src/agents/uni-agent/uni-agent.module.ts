import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UniAgentService } from './uni-agent.service';
import { UniAgentController } from './uni-agent.controller';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase])],
  controllers: [UniAgentController],
  providers: [UniAgentService],
  exports: [UniAgentService],
})
export class UniAgentModule {}
