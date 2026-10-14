import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { uuidPattern } from '@/lib/catalog';
import { catalogAdmin, catalogDatabaseError, catalogError, catalogJson, catalogMultipart } from '@/lib/catalog-server';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: RouteContext<'/api/admin/catalog/properties/[id]/media'>) {
  try {
    const access = await catalogAdmin(request); if (access.error) return access.error;
    if (Number(request.headers.get('content-length')) > 21*1024*1024) return catalogError('PAYLOAD_TOO_LARGE','Ảnh tối đa 10 MB; PDF tối đa 20 MB.',413);
    const {id} = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND','Không tìm thấy sản phẩm.',404);
    let form:FormData;
    try {form=await catalogMultipart(request,21*1024*1024);} catch(cause) {return catalogError('INVALID_FILE',cause instanceof Error && cause.message==='MULTIPART_TOO_LARGE' ? 'Ảnh tối đa 10 MB; PDF tối đa 20 MB.' : 'Dữ liệu tải lên không hợp lệ.',cause instanceof Error && cause.message==='MULTIPART_TOO_LARGE' ? 413 : 400);}
    if ([...form.keys()].some(key => !['file','name','visibility','sort_order','version'].includes(key))) return catalogError('INVALID_INPUT','Dữ liệu tải lên không hợp lệ.',400);
    const file = form.get('file'), name = String(form.get('name') || '').trim(), visibility = form.get('visibility');
    const sortOrder = Number(form.get('sort_order')), version = Number(form.get('version'));
    if (!form.has('version') || !form.has('sort_order') || !(file instanceof File) || !file.size || !name || name.length > 160 || !['Public','Internal'].includes(String(visibility)) || !Number.isSafeInteger(version) || version < 0 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) return catalogError('INVALID_INPUT','Kiểm tra tên tệp, phạm vi hiển thị và thứ tự.',400);
    const pdf = file.type === 'application/pdf';
    if ((!pdf && !['image/jpeg','image/png','image/webp'].includes(file.type)) || file.size > (pdf ? 20 : 10)*1024*1024) return catalogError('INVALID_FILE','Chỉ nhận ảnh JPG/PNG/WebP tối đa 10 MB hoặc PDF tối đa 20 MB.',400);
    const source = Buffer.from(await file.arrayBuffer());
    let content: Buffer;
    if (pdf) {
      // Reject non-PDF and active/embedded content; PDFs are served as attachments.
      const text = source.toString('latin1');
      const xref=text.match(/\bstartxref\s+(\d+)\s+%%EOF\s*$/), offset=xref ? Number(xref[1]) : -1;
      const crossReference=offset>=0 && offset<source.length ? text.slice(offset,offset+100) : '';
      if (!/^%PDF-(1\.[0-7]|2\.0)/.test(text) || !xref || !/^(xref\b|\d+\s+\d+\s+obj\b)/.test(crossReference) || /\/(JavaScript|JS|Launch|EmbeddedFiles|RichMedia|Encrypt|OpenAction)\b/i.test(text)) return catalogError('INVALID_FILE','PDF không hợp lệ, bị mã hóa hoặc chứa nội dung chủ động không được hỗ trợ.',400);
      content = source;
    } else {
      try {
        const image = sharp(source,{limitInputPixels:40000000}); const meta = await image.metadata();
        const expected: Record<string,string> = {'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
        if (meta.format !== expected[file.type] || (meta.pages || 1)>1) throw new Error();
        content = await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
        if (content.length > 10*1024*1024) throw new Error();
      } catch { return catalogError('INVALID_FILE','Tệp không phải ảnh hợp lệ hoặc kích thước ảnh quá lớn.',400); }
    }
    const property = await access.client.from('property_products').select('id,version').eq('id',id).maybeSingle();
    if (property.error) return catalogDatabaseError(property.error);
    if (!property.data) return catalogError('NOT_FOUND','Không tìm thấy sản phẩm.',404);
    if (property.data.version !== version) return catalogError('VERSION_CONFLICT','Sản phẩm đã thay đổi. Tải lại trước khi tải tệp.',409);
    const path = `${id}/${randomUUID()}.${pdf ? 'pdf' : 'webp'}`, mime = pdf ? 'application/pdf' : 'image/webp';
    const storage = access.client.storage.from('property-files');
    const upload = await storage.upload(path,content,{contentType:mime,upsert:false});
    if (upload.error) return catalogError('UPLOAD_FAILED','Không thể tải tệp lên. Vui lòng thử lại.',503);
    const saved = await access.client.rpc('pose_save_catalog',{p_kind:'media',p_id:null,p_version:version,p_reason:'Tải tệp sản phẩm',p_data:{property_id:id,object_key:path,name,media_type:pdf ? 'Document' : 'Image',mime_type:mime,size_bytes:content.length,checksum:createHash('sha256').update(content).digest('hex'),visibility,visible:true,sort_order:sortOrder}});
    if (saved.error) { await storage.remove([path]); return catalogDatabaseError(saved.error); }
    return catalogJson({item:saved.data,message:'Đã tải tệp và liên kết với sản phẩm.'},201);
  } catch { return catalogError('UPLOAD_FAILED','Không thể tải tệp. Vui lòng thử lại.',503); }
}
