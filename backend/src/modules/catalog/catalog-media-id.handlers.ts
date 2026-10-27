import { storageClient as publicStorageClient } from '../supabase/supabase.service.js';
import { WebRequest } from '../../common/http.js';
import { authenticatedSession, authClient } from '../auth/session.js';
import { uuidPattern } from '../../common/catalog.js';
import { catalogDatabaseError, catalogError } from './catalog.service.js';

export async function GET(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy tệp.', 404);
    const session = await authenticatedSession();
    const publicView = request.nextUrl.searchParams.get('public') === 'true';
    const client = authClient(publicView ? undefined : session?.access);
    const result = await client
      .from('property_media')
      .select('object_key,mime_type,name,removed')
      .eq('id', id)
      .maybeSingle();
    if (result.error) return catalogDatabaseError(result.error);
    if (!result.data || result.data.removed)
      return catalogError('NOT_FOUND', 'Không tìm thấy tệp hoặc tệp không còn được công bố.', 404);
    // RLS above is the access decision. The secret only reads the approved object;
    // it is never exposed to the client and never used for business writes.
    const secret = process.env.SUPABASE_STORAGE_SECRET_KEY;
    // Admins read private objects with their own token, except on public views: the
    // anonymous client cannot read the private bucket, so public covers use the secret.
    const adminRead = session?.role === 'Admin' && !publicView;
    if (!adminRead && !secret)
      return catalogError('STORAGE_NOT_CONFIGURED', 'Cổng tải tệp công khai chưa được cấu hình.', 503);
    const storageClient = adminRead ? client : publicStorageClient();
    const file = await storageClient.storage.from('property-files').download(result.data.object_key);
    if (file.error || !file.data) return catalogError('FILE_UNAVAILABLE', 'Tệp tạm thời không khả dụng.', 503);
    const filename = encodeURIComponent(
      `${result.data.name}.${result.data.mime_type === 'application/pdf' ? 'pdf' : 'webp'}`,
    );
    return new Response(file.data, {
      headers: {
        'Content-Type': result.data.mime_type,
        'Cache-Control': publicView ? 'private, max-age=600' : 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Content-Disposition': `${result.data.mime_type === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`,
      },
    });
  } catch {
    return catalogError('FILE_UNAVAILABLE', 'Không thể mở tệp. Vui lòng thử lại.', 503);
  }
}
