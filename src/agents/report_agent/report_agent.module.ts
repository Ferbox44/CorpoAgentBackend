import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportAgentService } from './report_agent.service';
import { ReportAgentController } from './report_agent.controller';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBase]),
  ],
  controllers: [ReportAgentController],
  providers: [ReportAgentService],
  exports: [ReportAgentService],
})
export class ReportAgentModule {}