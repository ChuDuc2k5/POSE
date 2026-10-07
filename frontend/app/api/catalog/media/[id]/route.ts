import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { authenticatedSession, authClient } from '@/lib/auth-server';
import { uuidPattern } from '@/lib/catalog';
import { catalogDatabaseError, catalogError } from '@/lib/catalog-server';

export async function GET(request: NextRequest, context: RouteContext<'/api/catalog/media/[id]'>) {
  try {
    const {id} = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND','Không tìm thấy tệp.',404);
    const session = await authenticatedSession();
    const client = authClient(request.nextUrl.searchParams.get('public')==='true' ? undefined:session?.access);
    const result = await client.from('property_media').select('object_key,mime_type,name,removed').eq('id',id).maybeSingle();
    if (result.error) return catalogDatabaseError(result.error);
    if (!result.data || result.data.removed) return catalogError('NOT_FOUND','Không tìm thấy tệp hoặc tệp không còn được công bố.',404);
    // RLS above is the access decision. The secret only reads the approved object;
    // it is never exposed to the client and never used for business writes.
    const secret = process.env.SUPABASE_STORAGE_SECRET_KEY;
    if (session?.role !== 'Admin' && !secret) return catalogError('STORAGE_NOT_CONFIGURED','Cổng tải tệp công khai chưa được cấu hình.',503);
    const storageClient = session?.role === 'Admin' ? client : createClient(process.env.SUPABASE_URL!,secret!,{auth:{persistSession:false,autoRefreshToken:false}});
    const file = await storageClient.storage.from('property-files').download(result.data.object_key);
    if (file.error || !file.data) return catalogError('FILE_UNAVAILABLE','Tệp tạm thời không khả dụng.',503);
    const filename = encodeURIComponent(`${result.data.name}.${result.data.mime_type === 'application/pdf' ? 'pdf' : 'webp'}`);
    return new Response(file.data,{headers:{'Content-Type':result.data.mime_type,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`${result.data.mime_type === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`}});
  } catch { return catalogError('FILE_UNAVAILABLE','Không thể mở tệp. Vui lòng thử lại.',503); }
}
