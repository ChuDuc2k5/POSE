import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession, authClient } from '@/lib/auth-server';
import { readProfile, withAvatar } from '@/lib/account-server';
import { normalizePhone, validateProfile } from '@/lib/profile-validation';

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    const { data: history, error } = await authClient(session.access).from('account_history').select('id,action,changed_fields,created_at').order('created_at', { ascending: false }).limit(20);
    if (error) return json({ message: 'Không thể tải lịch sử hồ sơ.' }, 503);
    return json({ profile: await readProfile(session.access), history });
  } catch { return json({ message: 'Không thể tải hồ sơ. Vui lòng thử lại.' }, 503); }
}

export async function PATCH(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return json({ message: 'Yêu cầu không hợp lệ.' }, 403);
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    const raw = await request.text();
    if (raw.length > 4096) return json({ message: 'Dữ liệu quá lớn.' }, 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return json({ message: 'Dữ liệu không hợp lệ.' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ message: 'Dữ liệu không hợp lệ.' }, 400);
    const message = validateProfile(input);
    if (message) return json({ message }, 400);
    const { data, error } = await authClient(session.access).rpc('pose_update_profile', {
      p_changes: { name: (input.name as string).trim(), phone: normalizePhone(input.phone), notificationsEnabled: input.notificationsEnabled }, p_version: input.version,
    });
    if (error?.code === '40001') return json({ message: 'Hồ sơ đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu.' }, 409);
    if (error) return json({ message: 'Chưa thể lưu hồ sơ. Vui lòng thử lại.' }, 503);
    return json({ message: 'Đã cập nhật hồ sơ.', profile: await withAvatar(session.access, data) });
  } catch { return json({ message: 'Không thể cập nhật hồ sơ. Vui lòng thử lại.' }, 503); }
}
