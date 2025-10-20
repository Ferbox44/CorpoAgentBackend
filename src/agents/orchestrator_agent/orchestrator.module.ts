import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { DataAgentModule } from '../data_agent/data_agent.module';
import { ReportAgentModule } from '../report_agent/report_agent.module';

@Module({
  providers: [OrchestratorService],
  controllers: [OrchestratorController],
  exports: [OrchestratorService],
  imports: [DataAgentModule, ReportAgentModule],
})
export class OrchestratorModule {}
