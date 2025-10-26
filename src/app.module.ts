import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/users.entity';
import { ChatSession } from './entities/chat_session.entity';
import { Message } from './entities/message.entity';
import { KnowledgeBase } from './entities/knowledge_base.entity';

import { UniAgentModule } from './agents/uni-agent/uni-agent.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';

@Module({
  imports: [
    AuthModule,
    ChatModule,
    UniAgentModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT!) || 5432,
      username: process.env.DB_USER || 'admin',
      password: process.env.DB_PASSWORD || 'admin',
      database: process.env.DB_NAME || 'corpoagent',
      autoLoadEntities: true,
      synchronize: false, // Disable in production
      logging: true,
    }),

    TypeOrmModule.forFeature([User, ChatSession, Message, KnowledgeBase]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
