'use client';

import { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';

export default function SocketTestPage() {
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      console.log('Connected:', socket.id);
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected');
      setConnected(false);
    });

    socket.on('message', (data) => {
      console.log('Message from backend:', data);
      setMessage(data.message);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('message');

      socket.disconnect();
    };
  }, []);

  const sendMessage = () => {
    socket.emit('message', {
      message: 'Hello from Next.js Frontend!',
    });
  };

  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold">
        Socket Test
      </h1>

      <p className="mt-4">
        Status:{' '}
        {connected ? 'Connected' : 'Disconnected'}
      </p>

      <button
        onClick={sendMessage}
        className="mt-5 rounded bg-black px-4 py-2 text-white"
      >
        Send Message
      </button>

      {message && (
        <p className="mt-5">
          Backend: {message}
        </p>
      )}
    </main>
  );
}