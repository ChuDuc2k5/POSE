export type LeadClassification = 'HOT' | 'WARM' | 'COLD';

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
  role: 'user' | 'assistant' | 'system';
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

export interface ChatProcessingStage {
  name: string;
  status: 'active' | 'done' | 'pending';
}
