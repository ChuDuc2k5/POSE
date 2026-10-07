import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { frontendUrl } from '../env.js';

@WebSocketGateway({
  cors: {
    origin: frontendUrl,
  },
})
export class GatewayGateway {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, payload: any) {
    console.log('Message from frontend:', payload);

    client.emit('message', {
      message: 'Hello from NestJS Backend!',
    });
  }
}
