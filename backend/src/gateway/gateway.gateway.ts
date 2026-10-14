import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { ChatService } from '../modules/chat/chat.service.js';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
  },
})
export class GatewayGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
    client.emit('conversation:status', { connected: true, message: 'Connected to chat server.' });
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat:send_message')
  handleMessage(client: Socket, payload: any) {
    const conversationId = payload?.conversationId;
    const content = payload?.content;

    if (!conversationId || !content) {
      client.emit('conversation:error', { message: 'Conversation ID and content are required.' });
      return;
    }

    this.server.emit('conversation:typing', { conversationId, typing: true, clientId: client.id });

    try {
      const result = this.chatService.sendMessage(conversationId, { content, role: 'user', language: payload?.language ?? 'vi' });

      this.server.emit('conversation:message', {
        conversationId,
        type: 'user',
        message: result.userMessage,
      });

      this.server.emit('ai:processing', {
        conversationId,
        stages: [
          { name: 'Understanding request', status: 'done' },
          { name: 'Detecting intent', status: 'done' },
          { name: 'Searching customer data', status: 'done' },
          { name: 'Generating response', status: 'active' },
        ],
      });

      this.server.emit('ai:tool', {
        conversationId,
        tool: result.toolActivity?.tool ?? 'search_products',
        input: result.toolActivity?.input ?? { budget: 3000000000 },
        status: result.toolActivity?.status ?? 'success',
      });

      this.server.emit('conversation:message', {
        conversationId,
        type: 'assistant',
        message: result.aiMessage,
      });

      this.server.emit('conversation:status', {
        conversationId,
        status: 'active',
        lead: result.conversation.lead,
      });

      this.server.emit('ai:response', {
        conversationId,
        message: result.aiMessage,
        lead: result.conversation.lead,
      });

      this.server.emit('conversation:typing', { conversationId, typing: false, clientId: client.id });
    } catch (error) {
      this.server.emit('conversation:error', {
        conversationId,
        message: 'AI hiện không thể xử lý yêu cầu.',
      });
      this.server.emit('conversation:typing', { conversationId, typing: false, clientId: client.id });
    }
  }

  @SubscribeMessage('chat:get_conversations')
  async handleGetConversations(client: Socket) {
    client.emit('chat:conversations', this.chatService.getConversations());
  }

  @SubscribeMessage('chat:create_conversation')
  handleCreateConversation(client: Socket, payload: any) {
    const conversation = this.chatService.createConversation({
      customerName: payload?.customerName ?? 'Khách hàng mới',
      customerPhone: payload?.customerPhone ?? '+84 900 000 000',
      customerEmail: payload?.customerEmail ?? 'new.customer@example.com',
      source: payload?.source ?? 'web-chat',
    });

    client.emit('chat:conversation_created', conversation);
  }
}
