import { NextRequest, NextResponse } from 'next/server';
import { authClient, authenticatedSession, clearSession, consumeAttempt, resetAttempts, saveSession } from '@/lib/auth-server';
import { normalizeEmail, validateCredentials } from '@/lib/auth-validation';
import { roleHome } from '@/lib/roles';
import { beginRecovery, clearRecovery, readProfile, recoverySession, updateIdentity } from '@/lib/account-server';
import { validatePassword } from '@/lib/profile-validation';

export const runtime = 'nodejs';
type Context = { params: Promise<{ action: string }> };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request: NextRequest, context: Context) {
  const { action } = await context.params;
  if (!['me', 'reset-password'].includes(action)) return json({ message: 'Không tìm thấy chức năng.' }, 404);
  try {
    if (action === 'reset-password') return json({ ready: Boolean(await recoverySession()) });
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập để tiếp tục.' }, 401);
    return json({ user: { id: session.user.id, email: session.user.email, name: (await readProfile(session.access)).name, verified: true, role: session.role }, destination: roleHome(session.role) });
  } catch {
    return json({ message: 'Dịch vụ tài khoản chưa khả dụng. Vui lòng thử lại sau.' }, 503);
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return json({ message: 'Yêu cầu không hợp lệ.' }, 403);
  const { action } = await context.params;
  if (!['signup', 'signin', 'resend', 'logout', 'session', 'forgot-password', 'reset-password'].includes(action)) return json({ message: 'Không tìm thấy chức năng.' }, 404);
  try {
    const client = authClient();
    if (action === 'logout') {
      // Logout also works for suspended accounts. Refresh before revoking when
      // the access cookie has expired; do not require workspace authorization.
      const { cookies } = await import('next/headers');
      const jar = await cookies();
      const access = jar.get('pose-access')?.value;
      const refresh = jar.get('pose-refresh')?.value;
      let failed = false;
      try {
        if (refresh) {
          const { error } = await client.auth.refreshSession({ refresh_token: refresh });
          if (!error) { const result = await client.auth.signOut({ scope: 'local' }); failed = Boolean(result.error); }
          else failed = !error.status || error.status >= 500;
        } else if (access) {
          const { error } = await client.auth.admin.signOut(access, 'local');
          failed = Boolean(error && (!error.status || error.status >= 500));
        }
      } finally { await clearSession(); await clearRecovery(); }
      if (failed) return json({ message: 'Đã xóa phiên trên trình duyệt, nhưng dịch vụ chưa xác nhận thu hồi phiên. Vui lòng thử lại khi dịch vụ hoạt động.' }, 503);
      return json({ message: 'Đã đăng xuất.' });
    }
    if (Number(request.headers.get('content-length') || 0) > 16384) return json({ message: 'Dữ liệu quá lớn.' }, 413);
    const raw = await request.text();
    if (raw.length > 16384) return json({ message: 'Dữ liệu quá lớn.' }, 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return json({ message: 'Dữ liệu không hợp lệ.' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ message: 'Dữ liệu không hợp lệ.' }, 400);
    if (action === 'forgot-password') {
      const email = normalizeEmail(input.email);
      if (Object.keys(input).some(k => k !== 'email') || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ message: 'Vui lòng nhập email hợp lệ.' }, 400);
      if (!consumeAttempt(action, email, 3)) return json({ message: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.' }, 429);
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${request.nextUrl.origin}/auth/recovery` });
      if (error && (!error.status || error.status >= 500)) return json({ message: 'Dịch vụ email tạm thời chưa khả dụng.' }, 503);
      // Keep the same result for unknown accounts and provider account limits.
      return json({ message: 'Nếu email đủ điều kiện, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu. Vui lòng kiểm tra cả thư rác.' });
    }
    if (action === 'reset-password') {
      const validation = validatePassword(input);
      if (validation) return json({ message: validation }, 400);
      const recovery = await recoverySession();
      if (!recovery) { await clearRecovery(); return json({ message: 'Liên kết không hợp lệ, đã dùng hoặc hết hạn. Hãy yêu cầu liên kết mới.' }, 401); }
      const recoveryClient = authClient(recovery.access);
      const claim = await recoveryClient.rpc('pose_recovery_ticket', { p_action: 'claim' });
      if (claim.error) return json({ message: 'Chưa thể xử lý yêu cầu. Vui lòng thử lại.' }, 503);
      if (claim.data !== true) return json({ message: 'Liên kết đã được dùng. Hãy yêu cầu liên kết mới.' }, 409);
      const updated = await updateIdentity(recovery.access, { password: input.password as string });
      if (!updated.ok || updated.user?.id !== recovery.user.id) {
        await clearRecovery();
        return json({ message: 'Chưa đổi được mật khẩu. Hãy yêu cầu liên kết mới; mật khẩu mới phải khác mật khẩu cũ và đáp ứng chính sách.' }, updated.status >= 500 ? 503 : 400);
      }
      const finished = await recoveryClient.rpc('pose_recovery_ticket', { p_action: 'finish' });
      if (finished.error || finished.data !== true) {
        // Provider sign-out remains a fallback if the DB confirmation fails.
        await client.auth.admin.signOut(recovery.access, 'global');
        await clearSession(); await clearRecovery();
        return json({ message: 'Mật khẩu đã đổi nhưng chưa xác nhận đầy đủ việc thu hồi phiên. Vui lòng đăng nhập lại; liên hệ quản trị viên nếu lỗi tiếp tục.' }, 503);
      }
      // The DB revocation barrier already denies every older session in POSE,
      // even if the provider is temporarily unavailable during global sign-out.
      await client.auth.admin.signOut(recovery.access, 'global');
      await clearSession(); await clearRecovery();
      return json({ message: 'Đã đặt lại mật khẩu và thu hồi các phiên cũ. Vui lòng đăng nhập lại.' });
    }
    if (action === 'session') {
      if (typeof input.access_token !== 'string' || typeof input.refresh_token !== 'string' || input.access_token.length > 8192 || input.refresh_token.length > 2048) return json({ message: 'Liên kết xác minh không hợp lệ.' }, 400);
      const { data: identity, error: identityError } = await client.auth.getUser(input.access_token);
      if (identityError || !identity.user?.email_confirmed_at) return json({ message: 'Liên kết xác minh không hợp lệ.' }, 401);
      const { data, error } = await client.auth.refreshSession({ refresh_token: input.refresh_token });
      if (error || !data.session || data.user?.id !== identity.user.id) return json({ message: 'Liên kết xác minh không hợp lệ.' }, 401);
      if (input.type === 'recovery') {
        await beginRecovery(data.session);
        return json({ message: 'Liên kết khôi phục đã được xác minh.', destination: '/reset-password' });
      }
      await clearRecovery();
      await saveSession(data.session);
      const verifiedSession=await authenticatedSession();
      if (!verifiedSession) return json({message:'Tài khoản chưa có quyền truy cập.'},403);
      return json({ message: 'Email đã được xác minh.', destination: roleHome(verifiedSession.role) });
    }
    const email = normalizeEmail(input.email);
    const message = action === 'resend' ? (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Vui lòng nhập email hợp lệ.' : null) : validateCredentials(input, action === 'signup');
    if (message) return json({ message }, 400);
    if (!consumeAttempt(action, email, action === 'signin' ? 5 : 3)) return json({ message: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.' }, 429);
    const emailRedirectTo = `${request.nextUrl.origin}/auth/callback`;
    if (action === 'resend') {
      const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo } });
      if (error && error.status && error.status >= 500) return json({ message: 'Dịch vụ email tạm thời chưa khả dụng.' }, 503);
      return json({ message: 'Nếu email đủ điều kiện, một liên kết xác minh mới sẽ được gửi. Vui lòng kiểm tra cả thư rác.' });
    }
    if (action === 'signup') {
      const { data, error } = await client.auth.signUp({ email, password: input.password as string, options: { emailRedirectTo, data: { display_name: (input.name as string).trim(), terms_accepted_at: new Date().toISOString(), terms_version: '2026-10-05' } } });
      if (error && error.code !== 'user_already_exists') {
        if (error.status === 429) return json({ message: 'Dịch vụ đang giới hạn gửi email. Vui lòng thử lại sau.' }, 429);
        return json({ message: 'Chưa thể xử lý đăng ký. Vui lòng kiểm tra dữ liệu hoặc thử lại sau.' }, 400);
      }
      if (data.session) return json({ message: 'Dịch vụ xác thực chưa bật xác minh email. Vui lòng liên hệ quản trị viên.' }, 503);
      return json({ message: 'Nếu email đủ điều kiện, bạn sẽ nhận được liên kết xác minh để kích hoạt tài khoản. Vui lòng kiểm tra hộp thư và thư rác.' });
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password: input.password as string });
    if (error || !data.session || !data.user.email_confirmed_at) return json({ message: 'Không thể đăng nhập. Kiểm tra thông tin đăng nhập và xác minh email của bạn.' }, 401);
    await saveSession(data.session);
    await clearRecovery();
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Tài khoản đã bị vô hiệu hóa hoặc phiên không còn hợp lệ.' }, 403);
    resetAttempts(email);
    return json({ message: 'Đăng nhập thành công.', destination: roleHome(session.role) });
  } catch {
    return json({ message: 'Dịch vụ tài khoản chưa khả dụng. Vui lòng thử lại sau.' }, 503);
  }
}
