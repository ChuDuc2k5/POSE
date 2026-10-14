import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ChatService } from './chat.service.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  createConversation(@Body() dto: any) {
    return this.chatService.createConversation({
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      customerEmail: dto.customerEmail,
      source: dto.source ?? 'web-chat',
    });
  }

  @Get('conversations')
  getConversations() {
    return this.chatService.getConversations();
  }

  @Get('conversations/:id')
  getConversation(@Param('id') id: string) {
    return this.chatService.getConversation(id);
  }

  @Get('conversations/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.chatService.getMessages(id);
  }

  @Post('conversations/:id/messages')
  sendMessage(@Param('id') id: string, @Body() dto: any) {
    return this.chatService.sendMessage(id, {
      content: dto.content,
      role: dto.role ?? 'user',
    });
  }

  @Post('conversations/:id/call')
  startMockCall(@Param('id') id: string) {
    return this.chatService.startMockCall(id);
  }

  @Post('ai/ask')
  askAi(@Body() dto: any) {
    return this.chatService.askAi({
      content: dto.content,
      customerName: dto.customerName ?? 'Khách hàng',
      propertyContext: dto.propertyContext,
    });
  }

  @Post('ai/search-properties')
  searchProperties(@Body() dto: any) {
    return this.chatService.searchProperties(dto);
  }

  @Post('ai/calculate-mortgage')
  calculateMortgage(@Body() dto: any) {
    return this.chatService.calculateMortgage(dto);
  }
}
