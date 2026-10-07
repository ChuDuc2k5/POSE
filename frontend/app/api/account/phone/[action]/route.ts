import { NextRequest, NextResponse } from 'next/server';
import { authClient, authenticatedSession, consumeAttempt, saveSession } from '@/lib/auth-server';
import { readProfile, updateIdentity, withAvatar } from '@/lib/account-server';
import { normalizePhone } from '@/lib/profile-validation';

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return json({ message: 'Yêu cầu không hợp lệ.' }, 403);
  const { action } = await context.params;
  if (!['send','verify'].includes(action)) return json({ message: 'Không tìm thấy chức năng.' }, 404);
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    const profile = await readProfile(session.access);
    if (!profile.phone || profile.phoneVerified) return json({ message: profile.phoneVerified ? 'Số điện thoại đã được xác minh.' : 'Hãy lưu số điện thoại trước khi xác minh.' }, 400);
    if (!consumeAttempt(`phone-${action}`, session.user.id, action === 'send' ? 3 : 5)) return json({ message: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.' }, 429);
    if (action === 'send') {
      const result = await updateIdentity(session.access, { phone: profile.phone });
      if (!result.ok) return json({ message: 'Chưa gửi được mã. Hãy kiểm tra số điện thoại hoặc liên hệ quản trị viên để kiểm tra dịch vụ SMS.' }, result.status === 429 ? 429 : 503);
      return json({ message: 'Mã xác minh đã được gửi tới số liên hệ của bạn.' });
    }
    const raw = await request.text();
    if (raw.length > 1024) return json({ message: 'Dữ liệu quá lớn.' }, 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return json({ message: 'Mã không hợp lệ.' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'token') || typeof input.token !== 'string' || !/^\d{6}$/.test(input.token)) return json({ message: 'Nhập mã xác minh gồm 6 chữ số.' }, 400);
    const { data, error } = await authClient(session.access).auth.verifyOtp({ phone: profile.phone, token: input.token, type: 'phone_change' });
    if (error || data.user?.id !== session.user.id || !data.user.phone_confirmed_at || normalizePhone('+' + data.user.phone?.replace(/^\+/, '')) !== profile.phone) return json({ message: 'Mã không đúng, đã dùng hoặc hết hạn.' }, 400);
    if (data.session) await saveSession(data.session);
    const access = data.session?.access_token || session.access;
    const recorded = await authClient(access).rpc('pose_record_phone_verification', { p_phone: profile.phone });
    if (recorded.error) return json({ message: 'Số liên hệ đã thay đổi hoặc chưa lưu được kết quả xác minh. Vui lòng tải lại hồ sơ.' }, 409);
    return json({ message: 'Đã xác minh số điện thoại.', profile: await withAvatar(access, recorded.data) });
  } catch { return json({ message: 'Dịch vụ xác minh chưa khả dụng. Vui lòng thử lại.' }, 503); }
}
