import { Module } from '@nestjs/common';
import { DataAgentService } from './data_agent.service';
import { DataAgentController } from './data_agent.controller';

@Module({
  providers: [DataAgentService],
  controllers: [DataAgentController],
  exports: [DataAgentService],
})
export class DataAgentModule {}
