import { WebRequest as NextRequest } from '../../common/http.js';
import { callAccess } from './server.js';
import { catalogDatabaseError, catalogError, catalogJson } from '../catalog/catalog.service.js';
import { uuidPattern } from '../../common/catalog.js';
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await callAccess();
    if (access.error) return access.error;
    const { id } = await params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy cuộc gọi.', 404);
    const call = await access.client.from('calls').select('*').eq('id', id).maybeSingle();
    if (call.error) return catalogDatabaseError(call.error);
    if (!call.data) return catalogError('NOT_FOUND', 'Không tìm thấy cuộc gọi.', 404);
    const [events, consents, turns] = await Promise.all([
      access.client.from('call_events').select('*').eq('call_id', id).order('received_at'),
      call.data.lead_id
        ? access.client.from('contact_consents').select('*').eq('lead_id', call.data.lead_id).order('recorded_at')
        : Promise.resolve({ data: [], error: null }),
      access.client.from('call_turns').select('*').eq('call_id', id).order('seq'),
    ]);
    const error = events.error || consents.error || turns.error;
    if (error) return catalogDatabaseError(error);
    const browserConsents = (events.data || [])
      .filter((e) => e.type === 'consent')
      .map((e) => ({
        id: e.id,
        purpose: e.payload.consent?.purpose || e.payload.withdraw,
        status: e.payload.consent?.granted ? 'Granted' : 'Withdrawn',
        evidence: e.payload.answer,
      }));
    return catalogJson({
      item: call.data,
      events: events.data,
      consents: [...(consents.data?.filter((c) => c.evidence.includes(id)) || []), ...browserConsents],
      turns: turns.data,
    });
  } catch {
    return catalogError('CALLS_UNAVAILABLE', 'Không thể tải cuộc gọi.', 503);
  }
}
