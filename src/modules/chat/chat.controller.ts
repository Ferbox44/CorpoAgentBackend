import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { SendMessageDto, SendFileMessageDto } from '../../modules/chat/dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('send')
  async sendMessage(@Body() sendMessageDto: SendMessageDto, @Request() req) {
    const userId = req.user.userId;
    return this.chatService.sendMessage(userId, sendMessageDto.content);
  }

  @Post('send-file')
  @UseInterceptors(FileInterceptor('file'))
  async sendFileMessage(
    @UploadedFile() file: Express.Multer.File,
    @Body() sendFileMessageDto: SendFileMessageDto,
    @Request() req,
  ) {
    const userId = req.user.userId;
    return this.chatService.sendFileMessage(userId, file, sendFileMessageDto.request);
  }

  @Get('messages')
  async getMessages(@Request() req) {
    const userId = req.user.userId;
    return this.chatService.getMessages(userId);
  }

  @Get('sessions')
  async getSession(@Request() req) {
    const userId = req.user.userId;
    return this.chatService.getSession(userId);
  }

  @Delete('sessions')
  async clearSession(@Request() req) {
    const userId = req.user.userId;
    return this.chatService.clearSession(userId);
  }
}
