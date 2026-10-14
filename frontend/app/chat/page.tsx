'use client';

import { ProtectedRoute } from '@/components/auth/protected-route';
import { ChatLayout } from '@/components/chat/chat-layout';

export default function ChatPage() {
  return (
    <ProtectedRoute>
      <ChatLayout />
    </ProtectedRoute>
  );
}
