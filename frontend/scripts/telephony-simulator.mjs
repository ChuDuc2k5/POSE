/** Local demo (no phone calls): set TELEPHONY_API_KEY and TELEPHONY_WEBHOOK_SECRET,
 * then node scripts/telephony-simulator.mjs. Set TELEPHONY_API_URL=http://127.0.0.1:3509,
 * TELEPHONY_PROVIDER=simulator, TELEPHONY_CALLER_ID=simulator and APP_PUBLIC_URL
 * to your running application. All data is labelled Giả lập. PORT defaults to 3509.
 * metadata.scenario: duplicate, out_of_order, missing_final, slow_hangup, usd,
 * usd_no_fx, recording_failure, ambiguous, hold, decline, opt_out.
 */
import { createServer } from 'node:http';
import { createHmac, createHash } from 'node:crypto';
export function createSimulator({ scenarioFor } = {}) {
  const calls = new Map(),
    timers = new Set();
  let received = 0;
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      Promise.resolve(fn()).catch(() => {});
    }, ms);
    timers.add(timer);
  };
  const event = (call, type, extra = {}) => ({
    event_id: `${call.id}:${++call.seq}`,
    provider_call_id: call.id,
    type,
    occurred_at: new Date().toISOString(),
    ...extra,
  });
  async function emit(call, type, extra = {}) {
    const e = event(call, type, extra);
    if (!extra.utterance) call.latest = e;
    const body = JSON.stringify(e),
      timestamp = String(Math.floor(Date.now() / 1000)),
      signature = createHmac('sha256', process.env.TELEPHONY_WEBHOOK_SECRET || '')
        .update(`${timestamp}.${body}`)
        .digest('hex');
    let reply;
    for (let i = 0; i < (call.scenario === 'duplicate' ? 3 : 1); i++) {
      try {
        const r = await fetch(call.input.callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-terava-timestamp': timestamp,
            'x-terava-signature': signature,
          },
          body,
          signal: AbortSignal.timeout(120000),
        });
        reply = await r.json();
      } catch {}
    }
    if (reply?.text) {
      call.transcript.push({ speaker: 'AI', text: reply.text });
      console.log(`Giả lập ${call.id}: ${reply.text}`);
    }
    return reply;
  }
  async function run(call) {
    const digit = call.input.to.at(-1),
      scenario = call.scenario;
    if (scenario === 'hold' || scenario === 'slow_hangup') return;
    if (['6', '7', '8'].includes(digit) && !scenario) {
      await emit(
        call,
        digit === '6' ? 'busy' : digit === '7' ? 'no_answer' : 'failed',
        digit === '8' ? { error_code: 'WRONG_NUMBER' } : {},
      );
      return;
    }
    if (scenario === 'ambiguous' || (digit === '9' && !scenario)) {
      call.latest = event(call, 'completed', { duration_seconds: 12, cost: { amount: 100, currency: 'VND' } });
      return;
    }
    if (scenario === 'out_of_order') {
      await emit(call, 'completed');
      await emit(call, 'ringing');
      return;
    }
    await emit(call, 'ringing');
    await emit(call, 'answered');
    const utterances =
      scenario === 'decline'
        ? ['đồng ý', 'không', 'không', 'không quan tâm']
        : scenario === 'opt_out'
          ? ['đừng gọi nữa']
          : [
              'đồng ý',
              'đồng ý',
              'đồng ý',
              'Tôi muốn mua căn hộ trong 2 tháng, ngân sách 3 tỷ đồng.',
              ...(scenario === 'missing_final' ? [] : ['Cảm ơn, đủ rồi']),
            ];
    for (const text of utterances) {
      if (call.stopped) return;
      call.transcript.push({ speaker: 'Customer', text });
      const reply = await emit(call, 'answered', {
        utterance: { speaker: 'Customer', text, at: new Date().toISOString() },
      });
      if (reply?.state?.phase === 'ended') break;
    }
    if (scenario === 'missing_final') {
      call.latest = event(call, 'completed', { duration_seconds: 20 });
      return;
    }
    if (call.stopped) return;
    const bytes = Buffer.from('RIFF simulated audio; no real phone call'),
      checksum = createHash('sha256').update(bytes).digest('hex');
    await emit(call, 'completed', {
      duration_seconds: 20,
      cost:
        scenario === 'usd'
          ? { amount: 0.01, currency: 'USD', fx_rate: 25000, fx_source: 'simulator fixture' }
          : scenario === 'usd_no_fx'
            ? { amount: 0.01, currency: 'USD' }
            : { amount: 100, currency: 'VND' },
      recording: {
        bytes: bytes.toString('base64'),
        checksum: scenario === 'recording_failure' ? '0'.repeat(64) : checksum,
        mime: 'audio/wav',
      },
    });
  }
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!process.env.TELEPHONY_API_KEY || req.headers.authorization !== `Bearer ${process.env.TELEPHONY_API_KEY}`)
      return send(401, { error: 'Unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/stats')
      return send(200, {
        received,
        calls: [...calls.values()].map((c) => ({
          id: c.id,
          provider: 'simulator',
          label: 'Giả lập',
          latest: c.latest,
          transcript: c.transcript,
        })),
      });
    if (req.method === 'POST' && url.pathname === '/dispatch') {
      let input;
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        input = JSON.parse(Buffer.concat(chunks));
      } catch {
        return send(400, {});
      }
      if (!input.metadata?.call_id || !input.idempotencyKey || !/^\+[1-9][0-9]{7,14}$/.test(input.to))
        return send(400, {});
      let call = [...calls.values()].find((c) => c.input.idempotencyKey === input.idempotencyKey);
      if (call) return send(200, { providerCallId: call.id });
      received++;
      call = {
        id: input.metadata.call_id,
        input,
        seq: 0,
        scenario: input.metadata.scenario || scenarioFor?.(input),
        latest: null,
        transcript: [],
      };
      calls.set(call.id, call);
      later(() => run(call), 100);
      later(
        () => {
          if (!call.stopped && !['completed', 'busy', 'no_answer', 'failed', 'canceled'].includes(call.latest?.type)) {
            call.stopped = true;
            return emit(call, 'completed', { end_reason: 'MAX_DURATION', duration_seconds: input.maxSeconds });
          }
        },
        Math.min(300, Math.max(1, Number(input.maxSeconds) || 300)) * 1000,
      );
      if (call.scenario === 'ambiguous' || (!call.scenario && input.to.endsWith('9'))) {
        later(() => send(200, { providerCallId: call.id }), 4500);
        return;
      }
      return send(200, { providerCallId: call.id });
    }
    const match = url.pathname.match(/^\/calls\/([^/]+)(\/hangup)?$/),
      call = match && calls.get(decodeURIComponent(match[1]));
    if (!call) return send(200, null);
    if (match[2] && req.method === 'POST') {
      call.stopped = true;
      later(
        () => emit(call, call.latest?.type === 'answered' ? 'completed' : 'canceled'),
        call.scenario === 'slow_hangup' ? 4000 : 150,
      );
      return send(200, { accepted: true });
    }
    return send(200, call.latest);
  });
  const close = () => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };
  return { server, close };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  const sim = createSimulator();
  sim.server.listen(Number(process.env.PORT || 3509), '127.0.0.1', () =>
    console.log('Giả lập: telephony simulator ready'),
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => sim.close());
}
