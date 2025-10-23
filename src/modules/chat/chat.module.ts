import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSession, Message } from '../../entities';
import { UniAgentModule } from '../../agents/uni-agent/uni-agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, Message]),
    UniAgentModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
