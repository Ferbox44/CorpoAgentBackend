import { Module } from '@nestjs/common';
import { DataAgentService } from './data_agent.service';
import { DataAgentController } from './data_agent.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';
@Module({
  providers: [DataAgentService],
  controllers: [DataAgentController],
  exports: [DataAgentService],
  imports: [TypeOrmModule.forFeature([KnowledgeBase])],
})
export class DataAgentModule {}
