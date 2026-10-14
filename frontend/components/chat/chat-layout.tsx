'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  BadgeCheck,
  Bell,
  Briefcase,
  ChevronDown,
  Circle,
  Clock3,
  Mic,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Send,
  Sparkles,
  User,
  Volume2,
  Paperclip,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { socket } from '@/lib/socket';
import { API_BASE_URL, fetchJson } from '@/lib/chat-api';
import type { ChatProcessingStage, ConversationRecord, MessageRecord } from '@/lib/chat-types';
import { useLanguage } from '@/components/providers/language-provider';

const demoConversation = {
  id: 'demo-conversation-1',
  customer: {
    id: 'demo-customer',
    name: 'Nguyễn Văn A',
    phone: '+84 912 345 678',
    email: 'nguyenvana@example.com',
    status: 'HOT',
  },
  lead: {
    id: 'demo-lead',
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
  source: 'web-chat',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  conversationDurationMinutes: 19,
  messages: [
    { id: 'm1', role: 'user', content: 'Bên em còn căn hộ khoảng 3 tỷ không?', timestamp: new Date().toISOString(), status: 'sent' },
    { id: 'm2', role: 'assistant', content: 'Dạ hiện bên em có sản phẩm khoảng 2.8 tỷ và 3.1 tỷ. Anh/chị đang quan tâm khu vực nào để em tìm chính xác hơn ạ?', timestamp: new Date().toISOString(), metadata: { toolUsed: 'search_products', toolInput: { budget: 3000000000 }, toolResult: { totalFound: 2 } }, status: 'sent' },
  ],
} as ConversationRecord;

const statusColors: Record<string, string> = {
  HOT: 'bg-rose-100 text-rose-700 ring-rose-200',
  WARM: 'bg-amber-100 text-amber-700 ring-amber-200',
  COLD: 'bg-slate-200 text-slate-700 ring-slate-300',
};

export function ChatLayout() {
  const { language } = useLanguage();
  const [conversations, setConversations] = useState<ConversationRecord[]>([demoConversation]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>(demoConversation.id);
  const [messages, setMessages] = useState<MessageRecord[]>(demoConversation.messages);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<ChatProcessingStage[]>([
    { name: 'Understanding request', status: 'done' },
    { name: 'Detecting intent', status: 'done' },
    { name: 'Searching customer data', status: 'done' },
    { name: 'Generating response', status: 'active' },
  ]);
  const [searchValue, setSearchValue] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? conversations[0],
    [conversations, selectedConversationId]
  );

  useEffect(() => {
    socket.connect();
    setIsConnected(true);

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    const handleMessage = (payload: any) => {
      if (!payload?.conversationId || payload.conversationId !== selectedConversationId) return;
      setMessages((current) => {
        const exists = current.some((message) => message.id === payload.message.id);
        if (exists) return current;
        return [...current, payload.message];
      });
    };
    const handleTyping = (payload: any) => {
      if (payload.conversationId !== selectedConversationId) return;
      if (payload.typing) {
        setProcessing((current) => current.map((stage) => ({ ...stage, status: stage.name === 'Generating response' ? 'active' : stage.status })));
      }
    };
    const handleProcessing = (payload: any) => {
      if (payload.conversationId !== selectedConversationId) return;
      setProcessing(payload.stages ?? processing);
    };
    const handleStatus = (payload: any) => {
      if (!payload?.conversationId || payload.conversationId !== selectedConversationId) return;
      setConversations((current) => current.map((item) => item.id === payload.conversationId ? { ...item, lead: payload.lead ?? item.lead, status: payload.status ?? item.status } : item));
    };
    const handleError = (payload: any) => {
      setError(payload?.message ?? 'Không thể kết nối tới máy chủ.');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('conversation:message', handleMessage);
    socket.on('conversation:typing', handleTyping);
    socket.on('ai:processing', handleProcessing);
    socket.on('conversation:status', handleStatus);
    socket.on('conversation:error', handleError);

    void loadConversations();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('conversation:message', handleMessage);
      socket.off('conversation:typing', handleTyping);
      socket.off('ai:processing', handleProcessing);
      socket.off('conversation:status', handleStatus);
      socket.off('conversation:error', handleError);
      socket.disconnect();
    };
  }, [selectedConversationId]);

  useEffect(() => {
    if (selectedConversation) {
      setMessages(selectedConversation.messages ?? []);
    }
  }, [selectedConversation]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, processing]);

  const loadConversations = async () => {
    try {
      const result = (await fetchJson<any[]>(`${API_BASE_URL}/chat/conversations`)) ?? [demoConversation];
      setConversations(result);
      if (result.length > 0) {
        setSelectedConversationId(result[0].id);
        setMessages(result[0].messages ?? []);
      }
    } catch {
      setConversations([demoConversation]);
      setSelectedConversationId(demoConversation.id);
      setMessages(demoConversation.messages);
    }
  };

  const filteredConversations = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) => conversation.customer.name.toLowerCase().includes(query));
  }, [conversations, searchValue]);

  const handleSend = async () => {
    if (!draft.trim() || !selectedConversation) return;

    const nextMessage = draft.trim();
    setIsSending(true);
    setError(null);
    setDraft('');

    try {
      socket.emit('chat:send_message', {
        conversationId: selectedConversation.id,
        content: nextMessage,
        language,
      });

      setMessages((current) => [
        ...current,
        {
          id: `${selectedConversation.id}-user-${Date.now()}`,
          role: 'user',
          content: nextMessage,
          timestamp: new Date().toISOString(),
          status: 'sent',
        },
      ]);
    } catch {
      setError('AI hiện không thể xử lý yêu cầu.');
    } finally {
      setIsSending(false);
    }
  };

  const lead = selectedConversation?.lead ?? demoConversation.lead;

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900">
      <aside className="hidden w-[320px] border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">CRM</p>
            <h1 className="text-xl font-semibold">Conversations</h1>
          </div>
          <Button variant="outline" size="icon-sm" className="rounded-full">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-4 pb-3 pt-4">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              placeholder="Search conversation"
            />
          </label>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
          {filteredConversations.map((conversation) => {
            const last = conversation.messages[conversation.messages.length - 1];
            const isActive = conversation.id === selectedConversationId;

            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedConversationId(conversation.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
                  isActive ? 'border-sky-200 bg-sky-50 shadow-sm' : 'border-transparent bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
                  {conversation.customer.name
                    .split(' ')
                    .slice(-2)
                    .map((part) => part[0])
                    .join('')}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-slate-900">{conversation.customer.name}</p>
                    <span className="text-[10px] text-slate-400">2m</span>
                  </div>

                  <p className="mt-1 truncate text-sm text-slate-500">{last?.content ?? 'No messages yet'}</p>

                  <div className="mt-2 flex items-center justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusColors[conversation.lead.classification] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
                      {conversation.lead.classification}
                    </span>
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
              {selectedConversation?.customer.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">{selectedConversation?.customer.name}</h2>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusColors[lead.classification]}`}>
                  {lead.classification}
                </span>
              </div>
              <p className="text-sm text-slate-500">{selectedConversation?.customer.phone}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
              <Circle className={`h-2.5 w-2.5 fill-current ${isConnected ? 'text-emerald-500' : 'text-amber-500'}`} />
              {isConnected ? 'Connected' : 'Reconnecting'}
            </div>

            <Button variant="outline" size="sm" className="gap-2 rounded-xl">
              <Phone className="h-4 w-4" />
              Mock Call
            </Button>
            <Button variant="ghost" size="icon-sm" className="rounded-full">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-6">
          <div className="mb-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                <BadgeCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Lead score</p>
                <p className="text-xs text-slate-500">{lead.score}/100 — {lead.classification}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Clock3 className="h-3.5 w-3.5" />
              {selectedConversation?.conversationDurationMinutes ?? 19} min
            </div>
          </div>

          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <div key={message.id} className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                  <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                    {!isUser && (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                        AI
                      </div>
                    )}
                    <div className={`rounded-2xl px-4 py-3 shadow-sm ${isUser ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
                      <p className="text-sm leading-6">{message.content}</p>
                    </div>
                  </div>

                  {message.metadata?.toolUsed && (
                    <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                      <p className="font-medium">Tool used</p>
                      <p>{message.metadata.toolUsed}</p>
                      <p className="mt-1 text-sky-700">Budget: {message.metadata.toolInput?.budget ?? 'N/A'}</p>
                    </div>
                  )}

                  <div className={`mt-1 flex items-center gap-2 text-[10px] ${isUser ? 'justify-end text-slate-400' : 'text-slate-400'}`}>
                    <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {message.status === 'sent' && <span>Delivered</span>}
                  </div>
                </div>
              </div>
            );
          })}

          {processing.some((stage) => stage.status === 'active') && (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                <Sparkles className="h-4 w-4 text-sky-600" />
                AI is processing...
              </div>
              <div className="space-y-2">
                {processing.map((stage) => (
                  <div key={stage.name} className="flex items-center gap-2 text-xs">
                    <span className={`h-2.5 w-2.5 rounded-full ${stage.status === 'done' ? 'bg-emerald-500' : stage.status === 'active' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                    <span className={stage.status === 'done' ? 'text-slate-700' : stage.status === 'active' ? 'text-slate-900 font-medium' : 'text-slate-400'}>{stage.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <div className="flex flex-1 flex-col">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type your message..."
                rows={1}
                className="max-h-28 min-h-10 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Voice call">
                <Mic className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Attachment">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button onClick={() => void handleSend()} disabled={isSending || !draft.trim()} className="rounded-xl">
                {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </main>

      <aside className="hidden w-[340px] border-l border-slate-200 bg-white xl:block">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Lead</p>
            <h3 className="text-lg font-semibold">Information</h3>
          </div>
          <Button variant="ghost" size="icon-sm" className="rounded-full">
            <Bell className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 p-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Customer</p>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <div className="flex justify-between gap-3"><span>Name</span><span className="font-medium text-slate-900">{selectedConversation?.customer.name}</span></div>
              <div className="flex justify-between gap-3"><span>Phone</span><span className="font-medium text-slate-900">{selectedConversation?.customer.phone}</span></div>
              <div className="flex justify-between gap-3"><span>Email</span><span className="font-medium text-slate-900">{selectedConversation?.customer.email}</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Lead</p>
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <div className="flex justify-between"><span>Score</span><span className="font-semibold text-slate-900">{lead.score}/100</span></div>
              <div className="flex justify-between"><span>Classification</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusColors[lead.classification]}`}>{lead.classification}</span></div>
              <div className="flex justify-between"><span>Budget</span><span className="font-medium text-slate-900">{lead.budget}</span></div>
              <div className="flex justify-between"><span>Product</span><span className="font-medium text-slate-900">{lead.productInterest}</span></div>
              <div className="flex justify-between"><span>Location</span><span className="font-medium text-slate-900">{lead.location}</span></div>
              <div className="flex justify-between"><span>Timeline</span><span className="font-medium text-slate-900">{lead.timeline}</span></div>
              <div className="flex justify-between"><span>Interest</span><span className="font-medium text-slate-900">{lead.interestLevel}</span></div>
              <div className="flex justify-between"><span>Purchase intent</span><span className="font-medium text-slate-900">{lead.purchaseIntent}</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">AI Activity</p>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <div className="flex items-center justify-between"><span>Intent detection</span><span className="text-emerald-600">✓</span></div>
              <div className="flex items-center justify-between"><span>Tool calling</span><span className="text-emerald-600">✓</span></div>
              <div className="flex items-center justify-between"><span>Database retrieval</span><span className="text-emerald-600">✓</span></div>
              <div className="flex items-center justify-between"><span>Response generation</span><span className="text-amber-500">•</span></div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <Button variant="secondary" className="justify-center rounded-xl">Call again</Button>
            <Button variant="outline" className="justify-center rounded-xl">Add note</Button>
            <Button variant="default" className="justify-center rounded-xl sm:col-span-2 xl:col-span-1">Schedule follow-up</Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
