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
import * as fs from 'fs';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
const host = process.env.DB_HOST;
@Module({
  imports: [
    AuthModule,
    ChatModule,
    UniAgentModule,
    KnowledgeBaseModule,
    TypeOrmModule.forRoot({
      //Modify for production
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: false,
      logging: true,
      ssl: { rejectUnauthorized: false }

    }),

    TypeOrmModule.forFeature([User, ChatSession, Message, KnowledgeBase]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  constructor() {
    console.log(process.env.DB_HOST);
    console.log(process.env.DB_PORT);
  console.log(process.env.DB_USER);
  console.log(process.env.DB_PASSWORD);
  console.log(process.env.DB_NAME);
  console.log(process.env.DB_SSL);
  }
  
 
}
