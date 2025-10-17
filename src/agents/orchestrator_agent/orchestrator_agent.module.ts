import { Module } from '@nestjs/common';
import { OrchestratorAgentService } from './orchestrator_agent.service';
import { OrchestratorAgentController } from './orchestrator_agent.controller';

@Module({
  providers: [OrchestratorAgentService],
  controllers: [OrchestratorAgentController]
})
export class OrchestratorAgentModule {}
