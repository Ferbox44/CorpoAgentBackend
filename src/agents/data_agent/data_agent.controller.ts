import { Controller, Post, Body } from '@nestjs/common';
import { DataAgentService } from './data_agent.service';

@Controller('data-agent')
export class DataAgentController {
  constructor(private readonly dataAgentService: DataAgentService) {}

  
  @Post("analyze")
  async analyze(@Body() body: { data: string }) {
    return await this.dataAgentService.analyzeData(body.data);
  }
}
