import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession, authClient } from '@/lib/auth-server';
import { readProfile, withAvatar } from '@/lib/account-server';

export const runtime = 'nodejs';
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return json({ message: 'Yêu cầu không hợp lệ.' }, 403);
  if (Number(request.headers.get('content-length')) > 2200000) return json({ message: 'Ảnh tối đa 2 MB.' }, 413);
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    const form = await request.formData();
    if ([...form.keys()].some(key => !['file','version'].includes(key))) return json({ message: 'Dữ liệu không hợp lệ.' }, 400);
    const file = form.get('file');
    const version = Number(form.get('version'));
    if (!(file instanceof File) || !file.size || file.size > 2097152 || !['image/jpeg','image/png','image/webp'].includes(file.type) || !Number.isSafeInteger(version) || version < 0) return json({ message: 'Chọn ảnh JPG, PNG hoặc WebP, tối đa 2 MB.' }, 400);
    let image: Buffer;
    try {
      const source = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 16000000 });
      const metadata = await source.metadata();
      if (!['jpeg','png','webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1) return json({ message: 'Định dạng ảnh không hợp lệ.' }, 400);
      image = await source.rotate().resize(256, 256, { fit: 'cover' }).png().toBuffer();
    } catch { return json({ message: 'Tệp không phải ảnh hợp lệ hoặc kích thước ảnh quá lớn.' }, 400); }
    const previous = await readProfile(session.access);
    const client = authClient(session.access);
    const storage = client.storage.from('account-avatars');
    const path = `${session.user.id}/${randomUUID()}.png`;
    const upload = await storage.upload(path, image, { contentType: 'image/png', upsert: false });
    if (upload.error) return json({ message: 'Không thể tải ảnh lên. Vui lòng thử lại.' }, 503);
    const updated = await client.rpc('pose_update_profile', { p_changes: { avatarPath: path }, p_version: version });
    if (updated.error) {
      await storage.remove([path]);
      return json({ message: updated.error.code === '40001' ? 'Hồ sơ đã thay đổi. Hãy tải lại trước khi lưu ảnh.' : 'Không thể lưu ảnh đại diện.' }, updated.error.code === '40001' ? 409 : 503);
    }
    if (previous.avatarPath) await storage.remove([previous.avatarPath]);
    return json({ message: 'Đã cập nhật ảnh đại diện.', profile: await withAvatar(session.access, updated.data) });
  } catch { return json({ message: 'Không thể cập nhật ảnh. Vui lòng thử lại.' }, 503); }
}
