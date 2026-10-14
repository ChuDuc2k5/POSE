'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Building2,
  MessageSquareText,
  QrCode,
  Send,
  Sparkles,
  X,
  Phone,
  HelpCircle,
} from 'lucide-react';
import { propertyMap, type PropertyRecord } from '@/lib/mock-properties';
import { useLanguage } from '@/components/providers/language-provider';

export function AIChatWidget({ property }: { property?: PropertyRecord }) {
  const { language, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([{ id: 'welcome', role: 'assistant', content: t('chatWelcome') }]);

  useEffect(() => {
    setMessages((current) => current.length === 1 && current[0].id === 'welcome'
      ? [{ id: 'welcome', role: 'assistant', content: t('chatWelcome') }]
      : current);
  }, [language]);

  const currentProperty = useMemo(() => property ?? propertyMap['prop-001'], [property]);

  const suggestions = [
    'Tìm nhà cho tôi',
    'Tôi muốn thuê nhà',
    'Tôi muốn mua căn hộ',
    'Ngân sách 3 tỷ thì mua được gì?',
    'Giúp tôi tính khoản vay',
    'Phân tích bất động sản này',
  ];

  const handleSend = (value?: string) => {
    const input = (value ?? draft).trim();
    if (!input) return;

    const userMessage = { id: `${Date.now()}-user`, role: 'user', content: input };
    const aiMessage = {
      id: `${Date.now()}-assistant`,
      role: 'assistant',
      content: currentProperty
        ? `Dạ, căn ${currentProperty.title} tại ${currentProperty.location} hiện phù hợp với nhu cầu của anh/chị. Em có thể giúp bạn so sánh giá, tính khoản vay và gợi ý các lựa chọn tương tự.`
        : 'Em đang phân tích các lựa chọn phù hợp nhất cho bạn.',
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setDraft('');
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {menuOpen && !chatOpen && (
        <div className="mb-4 flex flex-col items-end gap-2 animate-[fadeIn_0.2s_ease-out]">
          {[
            { label: 'Quét mã tải app', icon: QrCode },
            { label: 'Quan tâm Zalo', icon: Phone },
            { label: 'Chat cùng AI Agent', icon: Bot, action: () => { setMenuOpen(false); setChatOpen(true); } },
            { label: 'Trợ giúp', icon: HelpCircle },
          ].map(({ label, icon: Icon, action }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={action ?? (() => setMenuOpen(false))}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <Icon className="h-4 w-4" />
              </span>
              {label}
            </button>
          ))}
        </div>
      )}

      {chatOpen && (
        <div className="mb-4 w-[420px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)] animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Revoland AI Agent</p>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Online
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Minimize chat" className="rounded-full border border-slate-700 p-1.5 text-slate-300 transition hover:bg-slate-800" onClick={() => setChatOpen(false)}>
                <MessageSquareText className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Close chat" className="rounded-full border border-slate-700 p-1.5 text-slate-300 transition hover:bg-slate-800" onClick={() => { setChatOpen(false); setMenuOpen(false); }}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {t('chatPrompt')}
          </div>

          {currentProperty && (
            <div className="border-b border-slate-200 bg-sky-50 px-4 py-3">
              <div className="overflow-hidden rounded-2xl border border-sky-200 bg-white">
                <img src={currentProperty.image} alt={currentProperty.title} className="h-24 w-full object-cover" />
                <div className="space-y-2 p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{currentProperty.code}</p>
                  <p className="font-semibold text-slate-900">{currentProperty.title}</p>
                  <p className="text-sm text-slate-600">{currentProperty.location}</p>
                  <div className="flex items-center justify-between text-sm text-slate-700">
                    <span>{currentProperty.price.toLocaleString('vi-VN')} ₫</span>
                    <span>{currentProperty.area} m²</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="max-h-[360px] space-y-3 overflow-y-auto bg-slate-50 p-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
                  {message.content}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => handleSend(suggestion)} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700">
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <input
                aria-label="Nhập câu hỏi của bạn"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSend();
                }}
                className="flex-1 bg-transparent px-2 py-1.5 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder={t('chatPlaceholder')}
              />
              <button type="button" aria-label="Gửi tin nhắn" onClick={() => handleSend()} className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {!chatOpen && (
        <button
          type="button"
          aria-label="Open Revoland AI assistant menu"
          onClick={() => setMenuOpen((value) => !value)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-500 text-white shadow-[0_18px_40px_rgba(249,115,22,0.35)] transition hover:scale-105"
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
        </button>
      )}
    </div>
  );
}
