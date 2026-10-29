import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import type { Request } from 'express';
import { authenticatedSession, authClient } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { frontendOrigins, withCookieContext } from '../../common/http.js';
import { uuidPattern } from '../../common/catalog.js';
import { converse, initialConversation, type Conversation, type Script } from './conversation.js';
import type { Evidence } from '../ai/guard.js';
import { CallingScheduler } from './calling.scheduler.js';

type VoiceSession = {
  id: string;
  actor: string;
  script: Script;
  properties: Evidence[];
  state: Conversation;
  interrupted: boolean;
};
@WebSocketGateway({
  namespace: 'voice',
  path: '/socket.io',
  addTrailingSlash: false,
  cors: { origin: frontendOrigins(), credentials: true },
})
export class VoiceGateway implements OnApplicationShutdown {
  private readonly logger = new Logger('VoiceGateway');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly scheduler: CallingScheduler) {}
  afterInit(server: Namespace) {
    server.use(async (client, next) => {
      try {
        const token: unknown = client.handshake.auth.token;
        const headers = {
          ...client.handshake.headers,
          ...(typeof token === 'string' ? { authorization: `Bearer ${token}` } : {}),
        };
        if (headers.origin && !frontendOrigins().includes(headers.origin)) throw Error('INVALID_ORIGIN');
        client.data.sessionHeaders = headers;
        await this.session(client);
        next();
      } catch {
        next(Error('UNAUTHORIZED'));
      }
    });
  }
  private async session(client: Socket) {
    const session = await withCookieContext({ headers: client.data.sessionHeaders } as Request, undefined, () =>
      authenticatedSession({ writable: false }),
    );
    if (session?.role !== 'Admin') throw Error('FORBIDDEN');
    if (client.data.voice && client.data.voice.actor !== session.user.id) throw Error('FORBIDDEN');
    return session;
  }
  private async update(voice: VoiceSession, event: string, input = '', result: object = {}) {
    const r = await systemClient().rpc('pose_system_voice_update', {
      p_call: voice.id,
      p_actor: voice.actor,
      p_event: event,
      p_input: input,
      p_result: result,
    });
    if (r.error) throw Error(r.error.message);
    return r.data;
  }
  @SubscribeMessage('start')
  async start(client: Socket, input: { script_version_id?: string; property_id?: string }) {
    if (client.data.starting) return this.error(Error('Đang bắt đầu cuộc gọi.'));
    client.data.starting = true;
    try {
      const session = await this.session(client);
      if (client.data.processing) throw Error('Trợ lý đang xử lý.');
      if (
        !input ||
        !uuidPattern.test(input.script_version_id || '') ||
        (input.property_id && !uuidPattern.test(input.property_id))
      )
        throw Error('Chọn kịch bản và sản phẩm hợp lệ.');
      if (client.data.voice) await this.end(client);
      const db = authClient(session.access);
      const script = await db
        .from('call_script_versions')
        .select('content')
        .eq('id', input.script_version_id)
        .eq('status', 'Published')
        .maybeSingle();
      if (script.error || !script.data) throw Error('Kịch bản chưa công bố.');
      const ids: string[] = input.property_id
        ? [input.property_id]
        : script.data.content.product_source?.property_ids || [];
      const products = ids.length
        ? await authClient()
            .from('property_public_catalog')
            .select('id,code,name,price,availability,updated_at,location,property_type,transaction_type,price_period')
            .in('id', ids)
        : { data: [], error: null };
      if (products.error) throw Error('Không thể tải sản phẩm.');
      const created = await db.rpc('pose_voice_start', {
        p_script: input.script_version_id,
        p_property: input.property_id || null,
      });
      if (created.error) throw Error(created.error.message);
      if (!client.connected) {
        await systemClient().rpc('pose_system_voice_finish', { p_call: created.data.id, p_reason: 'CLOSED' });
        await this.scheduler.notify(created.data.id);
        throw Error('Kết nối phiên thoại đã đóng.');
      }
      const voice: VoiceSession = {
        id: created.data.id,
        actor: session.user.id,
        script: script.data.content,
        properties: (products.data || []).map((p) => ({ ...p, price: p.price == null ? null : Number(p.price) })),
        state: initialConversation(),
        interrupted: false,
      };
      client.data.voice = voice;
      await client.join(`voice:${voice.id}`);
      this.timers.set(
        client.id,
        setTimeout(() => {
          void this.update(voice, 'end', '', { end_reason: 'MAX_DURATION' })
            .then(() => {
              voice.state = { ...voice.state, phase: 'ended', end_reason: 'MAX_DURATION' };
              client.emit('reply', {
                state: voice.state,
                text: 'Đã đạt thời lượng mô phỏng tối đa.',
                call_id: voice.id,
                latency_ms: 0,
                interrupted: false,
              });
              return this.scheduler.notify(voice.id);
            })
            .catch(() => this.logger.warn('Chưa thể kết thúc phiên mô phỏng.'));
        }, 300000),
      );
      await this.turn(client, '');
      return { call_id: voice.id, label: 'Mô phỏng — không có cuộc gọi thật' };
    } catch (error) {
      return this.error(error);
    } finally {
      client.data.starting = false;
    }
  }
  private error(error: unknown) {
    return { error: error instanceof Error ? error.message : 'Không thể mô phỏng hội thoại.' };
  }
  private async turn(client: Socket, text: string, mediaFailure = false) {
    await this.session(client);
    const voice = client.data.voice as VoiceSession | undefined;
    if (!voice || voice.state.phase === 'ended') throw Error('Cuộc gọi đã kết thúc.');
    if (client.data.processing) throw Error('Trợ lý đang xử lý.');
    client.data.processing = true;
    const started = performance.now();
    try {
      const result = await converse(
        voice.state,
        voice.script,
        { text, speaking: voice.interrupted, mediaFailure },
        voice.properties,
      );
      const saved = await this.update(voice, 'turn', text, result);
      if (!saved.state) {
        voice.state = { ...voice.state, phase: 'ended', end_reason: saved.end_reason || 'CLOSED' };
        return {
          state: voice.state,
          text: '',
          interrupted: true,
          call_id: voice.id,
          latency_ms: Math.round(performance.now() - started),
        };
      }
      voice.state = saved.state;
      voice.interrupted = false;
      if (voice.state.phase === 'ended') {
        clearTimeout(this.timers.get(client.id));
        this.timers.delete(client.id);
      }
      const reply = { ...saved, call_id: voice.id, latency_ms: Math.round(performance.now() - started) };
      this.logger.log(JSON.stringify({ call_id: voice.id, turn: voice.state.turns, latency_ms: reply.latency_ms }));
      client.emit('reply', reply);
      await this.scheduler.notify(voice.id);
      return reply;
    } finally {
      client.data.processing = false;
    }
  }
  @SubscribeMessage('utterance')
  async utterance(client: Socket, input: { text?: unknown; mediaFailure?: boolean }) {
    try {
      if (!input || typeof input.text !== 'string' || input.text.length > 2000) throw Error('Nhập tối đa 2.000 ký tự.');
      return await this.turn(client, input.text, input.mediaFailure === true);
    } catch (error) {
      return this.error(error);
    }
  }
  @SubscribeMessage('silence')
  async silence(client: Socket) {
    try {
      return await this.turn(client, '');
    } catch (error) {
      return this.error(error);
    }
  }
  @SubscribeMessage('barge_in')
  async bargeIn(client: Socket) {
    try {
      await this.session(client);
      const voice = client.data.voice as VoiceSession | undefined;
      if (!voice || voice.state.phase === 'ended') throw Error('Cuộc gọi đã kết thúc.');
      voice.interrupted = true;
      await this.update(voice, 'barge_in');
      return { interrupted: true };
    } catch (error) {
      return this.error(error);
    }
  }
  @SubscribeMessage('end')
  async end(client: Socket) {
    try {
      await this.session(client);
      const voice = client.data.voice as VoiceSession | undefined;
      clearTimeout(this.timers.get(client.id));
      this.timers.delete(client.id);
      if (voice) {
        await this.update(voice, 'end');
        voice.state.phase = 'ended';
        voice.state.end_reason ||= 'CLOSED';
        await this.scheduler.notify(voice.id);
      }
      return { end_reason: voice?.state.end_reason || 'CLOSED' };
    } catch (error) {
      return this.error(error);
    }
  }
  async handleDisconnect(client: Socket) {
    clearTimeout(this.timers.get(client.id));
    this.timers.delete(client.id);
    const voice = client.data.voice as VoiceSession | undefined;
    if (voice)
      try {
        await this.update(voice, 'end');
        await this.scheduler.notify(voice.id);
      } catch {
        this.logger.warn('Chưa thể kết thúc phiên mô phỏng.');
      }
  }
  onApplicationShutdown() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
