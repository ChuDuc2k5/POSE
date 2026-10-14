import { Module } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  controllers: [ChatController],
  providers: [ChatService, AiService],
  exports: [ChatService, AiService],
})
export class ChatModule {}
