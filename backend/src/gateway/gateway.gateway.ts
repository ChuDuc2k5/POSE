import { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { Request } from 'express';
import { authenticatedSession } from '../modules/auth/session.js';
import { frontendOrigins, withCookieContext } from '../common/http.js';
import { inquiryEvents } from '../common/inquiry-events.js';
import { accountEvents } from '../common/account-events.js';
@WebSocketGateway({ path: '/socket.io', addTrailingSlash: false, cors: { origin: frontendOrigins(), credentials: true } })
export class GatewayGateway {
  @WebSocketServer()
  server: Server;
  private readonly notify=()=>{void this.notifyAdmins().catch(()=>{});};
  private readonly revokeAccount=(id:string)=>{this.server.in(`user:${id}`).disconnectSockets(true);};
  private async notifyAdmins(){
    for(const client of await this.server.in('role:Admin').fetchSockets()){
      try{
        const session=await withCookieContext({headers:client.data.sessionHeaders} as Request,undefined,()=>authenticatedSession({writable:false}));
        if(session?.role==='Admin')client.emit('inquiry:received',{refresh:true});
        else client.disconnect(true);
      }catch{client.disconnect(true);}
    }
  }
  onModuleDestroy(){inquiryEvents.off('received',this.notify);accountEvents.off('revoked',this.revokeAccount);}
  afterInit(server: Server) {
    inquiryEvents.on('received',this.notify);
    accountEvents.on('revoked',this.revokeAccount);
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
  @SubscribeMessage('message')
  async handleMessage(client: Socket, _payload: unknown) {
    const session = await withCookieContext({ headers: client.data.sessionHeaders } as Request, undefined, () => authenticatedSession({ writable: false }));
    if (!session || session.role !== client.data.principal.role) { client.disconnect(true); return; }
    client.emit('message', { message: 'Hello from NestJS Backend!' });
  }
}
