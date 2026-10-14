import { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { Request } from 'express';
import { authenticatedSession } from '../modules/auth/session.js';
import { frontendOrigins, withCookieContext } from '../common/http.js';
@WebSocketGateway({ path: '/socket.io', addTrailingSlash: false, cors: { origin: frontendOrigins(), credentials: true } })
export class GatewayGateway {
  @WebSocketServer()
  server: Server;
  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        const token: unknown = client.handshake.auth.token;
        const headers = { ...client.handshake.headers, ...(typeof token === 'string' ? { authorization: `Bearer ${token}` } : {}) };
        if (headers.origin && !frontendOrigins().includes(headers.origin)) throw new Error('INVALID_ORIGIN');
        const session = await withCookieContext({ headers } as Request, undefined, () => authenticatedSession({ writable: false }));
        if (!session) throw new Error('UNAUTHORIZED');
        client.data.sessionHeaders = headers;
        client.data.principal = { id: session.user.id, role: session.role };
        next();
      } catch { next(new Error('UNAUTHORIZED')); }
    });
  }
  async handleConnection(client: Socket) {
    await client.join(`user:${client.data.principal.id}`);
    await client.join(`role:${client.data.principal.role}`);
  }
  async campaignProgress(campaignIds: string[]) {
    if (!this.server || !campaignIds.length) return;
    const clients = await this.server.in('role:Admin').fetchSockets();
    await Promise.all(clients.map(async client => {
      try {
        const session = await withCookieContext({ headers: client.data.sessionHeaders } as Request, undefined, () => authenticatedSession({ writable: false }));
        if (session?.role !== 'Admin') { client.disconnect(true); return; }
        client.emit('campaign.progress', { campaignIds });
      } catch { client.disconnect(true); }
    }));
  }
  @SubscribeMessage('message')
  async handleMessage(client: Socket, _payload: unknown) {
    const session = await withCookieContext({ headers: client.data.sessionHeaders } as Request, undefined, () => authenticatedSession({ writable: false }));
    if (!session || session.role !== client.data.principal.role) { client.disconnect(true); return; }
    client.emit('message', { message: 'Hello from NestJS Backend!' });
  }
}
