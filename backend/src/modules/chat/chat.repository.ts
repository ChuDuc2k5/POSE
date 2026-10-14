import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface ChatConversationRow {
  id: string;
  userId: string;
  title?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageRow[];
}

export interface ChatMessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ChatRepository {
  private readonly conversations = new Map<string, ChatConversationRow>();

  async createConversation(userId: string, input: { title?: string; source?: string }): Promise<ChatConversationRow> {
    const id = randomUUID();
    const conversation: ChatConversationRow = {
      id,
      userId,
      title: input.title ?? 'New conversation',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    this.conversations.set(id, conversation);
    return conversation;
  }

  async findUserConversations(userId: string): Promise<ChatConversationRow[]> {
    return Array.from(this.conversations.values()).filter((item) => item.userId === userId);
  }

  async findConversationById(id: string): Promise<ChatConversationRow | null> {
    return this.conversations.get(id) ?? null;
  }

  async findConversationForUser(id: string, userId: string): Promise<ChatConversationRow | null> {
    const item = await this.findConversationById(id);
    return item && item.userId === userId ? item : null;
  }

  async createMessage(conversationId: string, message: { role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, any> }): Promise<ChatMessageRow> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    const record: ChatMessageRow = {
      id: randomUUID(),
      conversationId,
      role: message.role,
      content: message.content,
      createdAt: new Date().toISOString(),
      metadata: message.metadata,
    };

    conversation.messages.push(record);
    conversation.updatedAt = new Date().toISOString();
    return record;
  }

  async findMessages(conversationId: string): Promise<ChatMessageRow[]> {
    const conversation = this.conversations.get(conversationId);
    return conversation ? conversation.messages : [];
  }
}
