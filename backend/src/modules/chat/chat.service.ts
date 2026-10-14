import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiService } from './ai.service.js';
import {
  ConversationRecord,
  CreateConversationInput,
  LeadClassification,
  MessageRecord,
  PropertyContext,
  SendMessageInput,
} from './types.js';

@Injectable()
export class ChatService {
  private readonly conversations = new Map<string, ConversationRecord>();

  constructor(private readonly aiService: AiService) {
    this.seedDemoConversations();
  }

  createConversation(input: CreateConversationInput): ConversationRecord {
    const id = randomUUID();
    const customer = {
      id: randomUUID(),
      name: input.customerName,
      phone: input.customerPhone,
      email: input.customerEmail ?? `${input.customerName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      status: 'new',
    };

    const conversation: ConversationRecord = {
      id,
      customer,
      lead: {
        id: randomUUID(),
        score: 87,
        classification: 'HOT',
        budget: '3 tỷ',
        productInterest: 'Apartment',
        location: 'Quận 9',
        timeline: '1 tháng',
        interestLevel: 'Cao',
        purchaseIntent: 'Cao',
        rejectionReason: null,
        nextFollowUp: 'Ngày mai',
        status: 'New',
      },
      status: 'active',
      source: input.source ?? 'web-chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationDurationMinutes: 0,
      messages: [],
    };

    this.conversations.set(id, conversation);
    return conversation;
  }

  getConversations(): ConversationRecord[] {
    return Array.from(this.conversations.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getConversation(id: string): ConversationRecord | undefined {
    return this.conversations.get(id);
  }

  getMessages(id: string): MessageRecord[] {
    const conversation = this.getConversation(id);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation.messages;
  }

  sendMessage(conversationId: string, input: SendMessageInput & { propertyContext?: PropertyContext }): {
    userMessage: MessageRecord;
    aiMessage: MessageRecord;
    toolActivity: any;
    conversation: ConversationRecord;
  } {
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const userMessage: MessageRecord = {
      id: randomUUID(),
      role: input.role ?? 'user',
      content: input.content,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    conversation.messages.push(userMessage);

    const aiResponse = this.aiService.processMessage({
      content: input.content,
      customerName: conversation.customer.name,
      lead: conversation.lead,
      language: input.language ?? 'vi',
      propertyContext: input.propertyContext,
    });

    const aiMessage: MessageRecord = {
      id: randomUUID(),
      role: 'assistant',
      content: aiResponse.content,
      timestamp: new Date().toISOString(),
      metadata: {
        intent: aiResponse.intent,
        toolUsed: aiResponse.toolActivity?.tool,
        toolInput: aiResponse.toolActivity?.input,
        toolResult: aiResponse.toolActivity?.result,
        processingTime: aiResponse.toolActivity?.durationMs ?? 0,
        leadScore: aiResponse.leadUpdate.score,
        classification: aiResponse.leadUpdate.classification,
      },
      status: 'sent',
    };

    conversation.lead = {
      ...conversation.lead,
      ...aiResponse.leadUpdate,
      classification: (aiResponse.leadUpdate.classification ?? conversation.lead.classification) as LeadClassification,
    };
    conversation.updatedAt = new Date().toISOString();
    conversation.messages.push(aiMessage);

    return {
      userMessage,
      aiMessage,
      toolActivity: aiResponse.toolActivity,
      conversation,
    };
  }

  startMockCall(conversationId: string): { conversationId: string; sessionId: string; status: string; mode: string } {
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      conversationId,
      sessionId: randomUUID(),
      status: 'ready',
      mode: 'mock-caller',
    };
  }

  askAi(input: { content: string; customerName: string; propertyContext?: PropertyContext }): any {
    return this.aiService.ask(input);
  }

  searchProperties(input: { budget?: number; location?: string; propertyType?: string; bedrooms?: number }): any[] {
    return this.aiService.searchProperties(input);
  }

  calculateMortgage(input: { propertyPrice: number; downPaymentPercent: number; years: number; interestRate: number }): any {
    return this.aiService.calculateMortgage(input);
  }

  private seedDemoConversations(): void {
    if (this.conversations.size > 0) return;

    const demo1 = this.createConversation({
      customerName: 'Nguyễn Văn A',
      customerPhone: '+84 912 345 678',
      customerEmail: 'nguyenvana@example.com',
      source: 'web-chat',
    });

    this.sendMessage(demo1.id, { content: 'Bên em còn căn hộ khoảng 3 tỷ không?', role: 'user' });

    const demo2 = this.createConversation({
      customerName: 'Nguyễn Thị B',
      customerPhone: '+84 933 555 111',
      customerEmail: 'nguyenthib@example.com',
      source: 'web-chat',
    });

    this.sendMessage(demo2.id, { content: 'Cho em hỏi giá căn hộ ở Quận 7', role: 'user' });
  }
}
