import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession, Message, SenderType } from '../../entities';
import { UniAgentService } from '../../agents/uni-agent/uni-agent.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    private uniAgentService: UniAgentService,
  ) {}

  async getOrCreateSession(userId: string): Promise<ChatSession> {
    // Find existing session for user
    let session = await this.chatSessionRepository.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!session) {
      // Create new session
      session = this.chatSessionRepository.create({
        user: { id: userId } as any,
        title: 'New Chat Session',
        startedAt: new Date(),
        lastActivityAt: new Date(),
      });
      session = await this.chatSessionRepository.save(session);
    }

    return session;
  }

  async sendMessage(userId: string, content: string) {
    // Get or create session
    const session = await this.getOrCreateSession(userId);

    // Save user message
    const userMessage = this.messageRepository.create({
      session,
      sender: SenderType.USER,
      content,
    });
    await this.messageRepository.save(userMessage);

    // Update session activity
    session.lastActivityAt = new Date();
    await this.chatSessionRepository.save(session);

    // Process with UniAgent
    const aiResponse = await this.uniAgentService.processRequest(content);

    // Save AI response
    const aiMessage = this.messageRepository.create({
      session,
      sender: SenderType.AGENT,
      content: JSON.stringify(aiResponse),
    });
    await this.messageRepository.save(aiMessage);

    return {
      message: {
        id: aiMessage.id,
        sessionId: session.id,
        content: aiResponse,
        role: 'agent',
        timestamp: aiMessage.createdAt.toISOString()
      },
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.startedAt.toISOString(),
        updatedAt: session.lastActivityAt.toISOString(),
        messageCount: await this.messageRepository.count({ where: { session: { id: session.id } } })
      }
    };
  }

  async sendFileMessage(userId: string, file: Express.Multer.File, request?: string) {
    // Get or create session
    const session = await this.getOrCreateSession(userId);

    // Save user message (file upload)
    const userMessage = this.messageRepository.create({
      session,
      sender: SenderType.USER,
      content: `File uploaded: ${file.originalname}${request ? ` - ${request}` : ''}`,
    });
    await this.messageRepository.save(userMessage);

    // Update session activity
    session.lastActivityAt = new Date();
    await this.chatSessionRepository.save(session);

    // Process with UniAgent
    const aiResponse = await this.uniAgentService.processFileUpload(file, request || 'Process and analyze this file');

    // Save AI response
    const aiMessage = this.messageRepository.create({
      session,
      sender: SenderType.AGENT,
      content: JSON.stringify(aiResponse),
    });
    await this.messageRepository.save(aiMessage);

    return {
      message: {
        id: aiMessage.id,
        sessionId: session.id,
        content: aiResponse,
        role: 'agent',
        timestamp: aiMessage.createdAt.toISOString()
      },
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.startedAt.toISOString(),
        updatedAt: session.lastActivityAt.toISOString(),
        messageCount: await this.messageRepository.count({ where: { session: { id: session.id } } })
      }
    };
  }

  async getMessages(userId: string) {
    const session = await this.getOrCreateSession(userId);
    
    const messages = await this.messageRepository.find({
      where: { session: { id: session.id } },
      order: { createdAt: 'ASC' },
    });

    return messages.map(message => ({
      id: message.id,
      sessionId: session.id,
      content: message.sender === SenderType.USER ? message.content : JSON.parse(message.content),
      role: message.sender === SenderType.USER ? 'user' : 'agent',
      timestamp: message.createdAt.toISOString()
    }));
  }

  async getSession(userId: string) {
    const session = await this.getOrCreateSession(userId);
    const messageCount = await this.messageRepository.count({ 
      where: { session: { id: session.id } } 
    });
    
    return {
      id: session.id,
      title: session.title,
      createdAt: session.startedAt.toISOString(),
      updatedAt: session.lastActivityAt.toISOString(),
      messageCount
    };
  }

  async clearSession(userId: string) {
    const session = await this.chatSessionRepository.findOne({
      where: { user: { id: userId } },
    });

    if (session) {
      // Delete all messages first (due to foreign key constraint)
      await this.messageRepository.delete({ session: { id: session.id } });
      // Delete session
      await this.chatSessionRepository.delete(session.id);
    }

    return { message: 'Session cleared successfully' };
  }
}
