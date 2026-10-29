import { validOrigin, WebRequest, WebResponse } from '../../common/http.js';
import { authClient, authenticatedSession } from '../auth/session.js';

const json = (body: object, status = 200) =>
  WebResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    const { data, error } = await authClient(session.access).rpc('pose_read_my_contact_consents');
    if (error) return json({ message: 'Không thể tải cài đặt liên hệ.' }, 503);
    return json(data);
  } catch {
    return json({ message: 'Không thể tải cài đặt liên hệ.' }, 503);
  }
}

export async function POST(request: WebRequest) {
  if (!validOrigin(request)) return json({ message: 'Yêu cầu không hợp lệ.' }, 403);
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    const raw = await request.text();
    if (raw.length > 4096) return json({ message: 'Dữ liệu quá lớn.' }, 413);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ message: 'Dữ liệu không hợp lệ.' }, 400);
    }
    if (
      !input ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => !['purpose', 'granted', 'text'].includes(k)) ||
      !['Call', 'AIVoice', 'Transcript', 'Recording'].includes(String(input.purpose)) ||
      typeof input.granted !== 'boolean' ||
      (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 500))
    ) {
      return json({ message: 'Lựa chọn liên hệ không hợp lệ.' }, 400);
    }
    const { data, error } = await authClient(session.access).rpc('pose_set_my_contact_consent', {
      p_purpose: input.purpose,
      p_granted: input.granted,
      p_text: input.text || 'Cài đặt liên hệ',
    });
    if (error?.code === '22023' && error.message?.includes('PHONE_UNVERIFIED'))
      return json({ message: 'Hãy xác minh số điện thoại trước.' }, 400);
    if (error) return json({ message: 'Không thể cập nhật cài đặt liên hệ.' }, 503);
    return json(data);
  } catch {
    return json({ message: 'Không thể cập nhật cài đặt liên hệ.' }, 503);
  }
}
