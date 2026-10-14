export type LeadClassification = 'HOT' | 'WARM' | 'COLD';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
}

export interface LeadSnapshot {
  id: string;
  score: number;
  classification: LeadClassification;
  budget: string;
  productInterest: string;
  location: string;
  timeline: string;
  interestLevel: string;
  purchaseIntent: string;
  rejectionReason: string | null;
  nextFollowUp: string;
  status: string;
}

export interface MessageRecord {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
  status?: 'sending' | 'sent' | 'error';
}

export interface ConversationRecord {
  id: string;
  customer: CustomerProfile;
  lead: LeadSnapshot;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  conversationDurationMinutes: number;
  messages: MessageRecord[];
}

export interface CreateConversationInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  source?: string;
}

export interface SendMessageInput {
  content: string;
  role?: MessageRole;
  language?: 'vi' | 'en';
}

export interface ToolActivity {
  tool: string;
  input: Record<string, any>;
  result: Record<string, any>;
  durationMs: number;
  status: 'success' | 'error';
}

export interface AiProcessingState {
  stage: 'understanding' | 'intent' | 'retrieving' | 'generating';
  message: string;
  completed: boolean;
}

export interface PropertyContext {
  id?: string;
  title?: string;
  code?: string;
  price?: number;
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  location?: string;
  type?: string;
  direction?: string;
  furnishing?: string;
  amenities?: string[];
  broker?: string;
  url?: string;
}

export interface ProcessedAiMessage {
  content: string;
  intent: string;
  toolActivity?: ToolActivity;
  leadUpdate: Partial<LeadSnapshot>;
  processing: AiProcessingState[];
  propertyContext?: PropertyContext;
}
