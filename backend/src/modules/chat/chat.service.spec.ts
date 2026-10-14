import { describe, expect, it } from 'vitest';
import { AiService } from './ai.service.js';
import { ChatService } from './chat.service.js';

describe('ChatService', () => {
  it('creates a conversation with a lead snapshot', () => {
    const service = new ChatService(new AiService());

    const conversation = service.createConversation({
      customerName: 'Nguyễn Văn A',
      customerPhone: '+84 912 345 678',
      customerEmail: 'nguyenvana@example.com',
      source: 'web-chat',
    });

    expect(conversation.id).toBeTruthy();
    expect(conversation.customer.name).toBe('Nguyễn Văn A');
    expect(conversation.lead.score).toBeGreaterThan(0);
    expect(conversation.messages).toHaveLength(0);
  });

  it('sends a customer message and receives an AI response with tool metadata', () => {
    const service = new ChatService(new AiService());
    const conversation = service.createConversation({
      customerName: 'Nguyễn Văn A',
      customerPhone: '+84 912 345 678',
      customerEmail: 'nguyenvana@example.com',
      source: 'web-chat',
    });

    const result = service.sendMessage(conversation.id, {
      content: 'Bên em còn căn hộ khoảng 3 tỷ không?',
      role: 'user',
    });

    expect(result.userMessage.content).toContain('3 tỷ');
    expect(result.aiMessage.content).toContain('2.8');
    expect(result.toolActivity.tool).toBe('search_products');
    expect(result.conversation.lead.classification).toBe('HOT');
  });

  it('updates lead analysis and classification from a follow-up message', () => {
    const service = new ChatService(new AiService());
    const conversation = service.createConversation({
      customerName: 'Nguyễn Thị B',
      customerPhone: '+84 933 555 111',
      customerEmail: 'nguyenthib@example.com',
      source: 'web-chat',
    });

    service.sendMessage(conversation.id, {
      content: 'Em không thích quận 9, em muốn ở quận 7 thôi.',
      role: 'user',
    });

    const updated = service.getConversation(conversation.id);
    expect(updated?.lead.location).toContain('Quận 7');
    expect(['HOT', 'WARM', 'COLD']).toContain(updated?.lead.classification);
  });
});
