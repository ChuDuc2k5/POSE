import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';

// HTTP/Storage contract tests use an isolated fake provider. Real constraints
// and RLS are tested separately with supabase/test-property-management.sql.
const projectId='fc100000-0000-4000-8000-000000000001', subdivisionId='fc200000-0000-4000-8000-000000000001';
const user={id:'fc000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'admin@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{display_name:'Quản trị viên NexCall',role:'Admin'},app_metadata:{role:'Admin'}};
let db,files=new Map(),currentRole='Admin',active=true,offline=false,uploadFailure=false,attachFailure=false;
const image=await sharp({create:{width:32,height:24,channels:3,background:'#387c64'}}).png().toBuffer();
const profile={name:'Quản trị viên NexCall',phone:'',phoneVerified:false,notificationsEnabled:true,avatarPath:null,version:0,updatedAt:null};
function seed(){
  const now=new Date().toISOString();
  db={property_projects:[{id:projectId,code:'NexCall-RV',name:'NexCall Riverside',location:'Thành phố Hồ Chí Minh',description:'Dự án minh họa trong môi trường kiểm thử.',amenities:'Công viên, hồ bơi, khu sinh hoạt chung',archived:false,version:0,updated_at:now}],property_subdivisions:[{id:subdivisionId,project_id:projectId,code:'BLOCK-A',name:'Riverside · Block A',location:'Thành phố Hồ Chí Minh',description:'Phân khu minh họa',amenities:'Vườn nội khu',archived:false,version:0,updated_at:now}],property_products:[],property_media:[],property_history:[]};
  for(const [i,name,code,area,price,publication,availability] of [[1,'Căn hộ 2 phòng ngủ · Block A','A-1201',82.5,3200000000,'Published','Available'],[2,'Căn hộ sân vườn','A-1602',98.5,null,'Draft','Unavailable'],[3,'Căn hộ gia đình · Block A','A-0805',105,4100000000,'Published','Sold'],[4,'Căn hộ góc, hướng công viên','A-0703',88,3500000000,'Hidden','Reserved']])db.property_products.push({id:`fc300000-0000-4000-8000-00000000000${i}`,project_id:projectId,subdivision_id:subdivisionId,code,name,area,price,publication,availability,property_type:'Apartment',bedrooms:2,currency:'VND',location:'Thành phố Hồ Chí Minh',description:'Không gian sống thoáng đãng, tiện ích đầy đủ và kết nối thuận tiện.',version:0,updated_at:now});
  files=new Map();currentRole='Admin';active=true;offline=false;uploadFailure=false;attachFailure=false;
}
seed();
const tables={projects:'property_projects',subdivisions:'property_subdivisions',properties:'property_products',media:'property_media'};
const published=p=>p?.publication==='Published' && db.property_projects.some(j=>j.id===p.project_id && !j.archived) && (!p.subdivision_id || db.property_subdivisions.some(s=>s.id===p.subdivision_id && !s.archived));
const publicMedia=m=>m.visibility==='Public' && m.visible && !m.removed && published(db.property_products.find(p=>p.id===m.property_id));
const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  const url=new URL(req.url,'http://localhost');let input={};if(bytes.length && req.headers['content-type']?.includes('application/json'))input=JSON.parse(bytes.toString());
  const token=req.headers.authorization?.replace('Bearer ',''),role=token==='fixture-access' ? currentRole : token==='fixture-User' ? 'User' : token==='fixture-Sales' ? 'Sales' : 'Guest';
  const reply=(status,body)=>{res.setHeader('Content-Type','application/json');res.writeHead(status);res.end(JSON.stringify(body));};
  if(offline)return reply(503,{message:'Unavailable'});
  if(url.pathname.endsWith('/token'))return reply(200,{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user});
  if(url.pathname.endsWith('/user'))return ['fixture-access','fixture-User','fixture-Sales'].includes(token) ? reply(200,user):reply(401,{msg:'Invalid token'});
  if(url.pathname.endsWith('/logout')){res.writeHead(204);return res.end();}
  if(url.pathname.endsWith('/rpc/pose_access_context'))return reply(200,{user_id:user.id,role,active,session_valid:active});
  if(url.pathname.endsWith('/rpc/pose_read_profile'))return reply(200,profile);
  if(url.pathname.endsWith('/rpc/pose_save_catalog')){
    if(role!=='Admin')return reply(403,{code:'42501',message:'ADMIN_REQUIRED'});
    if(attachFailure && input.p_kind==='media' && !input.p_id){attachFailure=false;return reply(409,{code:'40001',message:'VERSION_CONFLICT'});}
    const table=tables[input.p_kind],old=db[table].find(row=>row.id===input.p_id),data=input.p_data;
    if(input.p_id && !old)return reply(404,{code:'P0002',message:'NOT_FOUND'});
    if(old && old.version!==input.p_version)return reply(409,{code:'40001',message:'VERSION_CONFLICT'});
    if(data.code && db[table].some(row=>row.code===data.code && row.id!==input.p_id))return reply(409,{code:'23505',message:'DUPLICATE'});
    if(data.project_id && !db.property_projects.some(j=>j.id===data.project_id && !j.archived))return reply(400,{code:'22023',message:'PARENT_INACTIVE'});
    if(data.subdivision_id && !db.property_subdivisions.some(s=>s.id===data.subdivision_id && s.project_id===data.project_id && !s.archived))return reply(400,{code:'22023',message:'PARENT_INACTIVE'});
    if((['Hidden','Archived'].includes(data.publication) && data.publication!==old?.publication || old && data.availability && data.availability!==old.availability || data.archived && !old?.archived) && (input.p_reason || '').trim().length<3)return reply(400,{code:'22023',message:'REASON_REQUIRED'});
    const parent=input.p_kind==='media' ? db.property_products.find(p=>p.id===(old?.property_id || data.property_id)):null;
    if(input.p_kind==='media' && !old && (!parent || parent.version!==input.p_version))return reply(409,{code:'40001',message:'VERSION_CONFLICT'});
    const before=old ? {...old}:null;
    const saved={...(old || {id:randomUUID(),removed:false}),...data,version:old ? old.version+1:0,updated_at:new Date().toISOString()};
    if(saved.removed)saved.visible=false;if(old)Object.assign(old,saved);else db[table].push(saved);
    if(parent)parent.version++;
    db.property_history.unshift({id:randomUUID(),entity_kind:input.p_kind==='media' ? 'properties':input.p_kind,entity_id:parent?.id || saved.id,actor_id:user.id,action:`${input.p_kind}_${old ? 'updated':'created'}`,reason:input.p_reason,before_data:before,after_data:{...saved},created_at:new Date().toISOString()});
    return reply(200,saved);
  }
  if(url.pathname.startsWith('/rest/v1/')){
    const table=url.pathname.split('/').pop();if(!db[table])return reply(404,{});
    let rows=db[table].filter(row=>role==='Admin' || table==='property_products' && published(row) || table==='property_media' && publicMedia(row) || table==='property_projects' && !row.archived || table==='property_subdivisions' && !row.archived);
    for(const [key,value] of url.searchParams){if(value.startsWith('eq.'))rows=rows.filter(row=>String(row[key])===value.slice(3));}
    const search=url.searchParams.get('or')?.match(/code\.ilike\.%((?:\\.|[^%])*)%/)?.[1]?.replace(/\\([%_])/g,'$1');if(search)rows=rows.filter(row=>`${row.code} ${row.name}`.toLowerCase().includes(search.toLowerCase()));
    if(url.searchParams.get('order')){const order=url.searchParams.get('order').split(',');rows.sort((a,b)=>{for(const field of order){const [key,direction]=field.split('.');const comparison=a[key]>b[key] ? 1:a[key]<b[key] ? -1:0;if(comparison)return direction==='desc' ? -comparison:comparison;}return 0;});}
    const total=rows.length,offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || total || 1);rows=rows.slice(offset,offset+limit);
    const selected=url.searchParams.get('select');if(selected && selected!=='*'){const keys=selected.split(',');rows=rows.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]])));}
    res.setHeader('Content-Range',`${offset}-${Math.max(offset,offset+rows.length-1)}/${total}`);
    if(req.headers.accept?.includes('application/vnd.pgrst.object+json'))return reply(200,rows[0] || null);
    return reply(200,rows);
  }
  if(url.pathname==='/storage/v1/object/property-files' && req.method==='DELETE'){
    for(const key of input.prefixes || [])files.delete(key);return reply(200,[]);
  }
  if(url.pathname.includes('/storage/v1/object/')){
    const path=url.pathname.replace(/^\/storage\/v1\/object\/(?:authenticated\/)?property-files\//,'');
    if(req.method==='POST'){if(uploadFailure)return reply(503,{statusCode:'503',error:'Unavailable',message:'Unavailable'});files.set(path,{bytes,mime:req.headers['content-type']?.split(';')[0]});return reply(200,{Key:`property-files/${path}`});}
    const file=files.get(path);if(!file)return reply(404,{message:'Not found'});
    if(role!=='Admin' && token!=='fixture-storage-key')return reply(403,{message:'Forbidden'});
    res.setHeader('Content-Type',file.mime);res.writeHead(200);return res.end(file.bytes);
  }
  return reply(404,{});
});
await new Promise(resolve=>provider.listen(3221,'127.0.0.1',resolve));
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port','3220'],{cwd:new URL('..',import.meta.url),env:{...process.env,SUPABASE_URL:'http://127.0.0.1:3221',SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',SUPABASE_STORAGE_SECRET_KEY:'fixture-storage-key'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';app.stdout.on('data',chunk=>{output+=chunk;});app.stderr.on('data',chunk=>{output+=chunk;});
const origin='http://localhost:3220',admin='pose-access=fixture-access';let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const call=(path,method='GET',body,cookie=admin,requestOrigin=origin)=>fetch(`${origin}${path}`,{method,headers:{...(cookie ? {Cookie:cookie}:{}),...(method!=='GET' ? {Origin:requestOrigin,'Content-Type':'application/json'}:{})},...(body ? {body:JSON.stringify(body)}:{})});
const payload={code:'HTTP-PROJECT',name:'Dự án HTTP',location:'Thành phố Hồ Chí Minh',description:'Mô tả dự án kiểm thử',amenities:'Công viên',archived:false,version:0,reason:''};
const route='/api/admin/catalog';
async function upload(property,file,version=property.version,visibility='Public'){
  const form=new FormData();form.set('file',file);form.set('name','Tệp kiểm thử');form.set('visibility',visibility);form.set('sort_order','0');form.set('version',String(version));
  return fetch(`${origin}${route}/properties/${property.id}/media`,{method:'POST',headers:{Cookie:admin,Origin:origin},body:form});
}
try{
  let ready=false;for(let i=0;i<40;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,output);
  check((await call(`${route}/projects`,'GET',null,null)).status===401,'Guest denied admin catalogue');
  for(const role of ['User','Sales'])check((await call(`${route}/projects`,'GET',null,`pose-access=fixture-${role}`)).status===403,`${role} denied despite forged editable metadata`);
  check((await call(`${route}/projects`,'POST',payload,admin,'https://other.example')).status===403,'Cross-origin mutation denied');
  check((await call(`${route}/projects`,'POST',{...payload,actor_id:user.id})).status===400,'Actor spoofing denied');
  check((await call(`${route}/projects?pageSize=51`)).status===400,'Page size capped at 50');
  check((await call(`${route}/projects?page=0`)).status===400,'Invalid page denied');
  const created=await call(`${route}/projects`,'POST',payload);check(created.status===201,'Create project');const project=(await created.json()).item;
  check((await call(`${route}/projects`,'POST',payload)).status===409,'Duplicate code conflict');
  check((await call(`${route}/projects/${project.id}`,'PATCH',{...payload,name:'Tên mới'})).status===200,'Edit project');
  check((await call(`${route}/projects/${project.id}`,'PATCH',payload)).status===409,'Stale project rejected');
  check((await call(`${route}/subdivisions`,'POST',{...payload,code:'HTTP-Z',project_id:randomUUID()})).status===400,'Nonexistent project rejected');
  const subdivision=await call(`${route}/subdivisions`,'POST',{...payload,code:'HTTP-Z',project_id:project.id});check(subdivision.status===201,'Create subdivision');const zone=(await subdivision.json()).item;
  const propertyInput={code:'HTTP_P',name:'Căn hộ HTTP',project_id:project.id,subdivision_id:zone.id,location:'Hồ Chí Minh',description:'Căn hộ kiểm thử có đầy đủ thông tin giới thiệu.',property_type:'Apartment',area:85,bedrooms:2,price:null,publication:'Draft',availability:'Available',version:0,reason:''};
  for(const [field,value] of [['area',-1],['area',0],['price',0],['bedrooms',-1],['property_type','Fake']])check((await call(`${route}/properties`,'POST',{...propertyInput,[field]:value})).status===400,`Invalid ${field} denied`);
  let property=(await (await call(`${route}/properties`,'POST',propertyInput)).json()).item;check(property.price===null,'Unknown price stays null');
  const editProperty=async changes=>{const response=await call(`${route}/properties/${property.id}`,'PATCH',{...propertyInput,...property, ...changes,id:undefined,currency:undefined,updated_at:undefined,removed:undefined});const data=await response.json();if(response.ok)property=data.item;return response;};
  check((await editProperty({publication:'Published',description:'Ngắn'})).status===400,'Incomplete publication denied');
  check((await editProperty({publication:'Published'})).status===200,'Publish complete product');
  check((await editProperty({publication:'Hidden'})).status===400,'Hide needs reason');
  check((await editProperty({availability:'Sold'})).status===400,'Availability needs reason');
  check((await editProperty({availability:'Sold',reason:'Cập nhật tình trạng quản lý'})).status===200 && property.publication==='Published','Availability independent from publication');
  const filtered=await call(`${route}/properties?search=HTTP_P&project=${project.id}`);check(filtered.status===200 && (await filtered.json()).total===1,'Search preserves literal underscore in product codes and project filter');
  check((await upload(property,new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'}))).status===400,'SVG denied');
  check((await upload(property,new File(['fake'],'bad.png',{type:'image/png'}))).status===400,'Fake image content denied');
  check((await upload(property,new File([image],'mismatch.jpg',{type:'image/jpeg'}))).status===400,'MIME/content mismatch denied');
  check((await upload(property,new File([new Uint8Array(10*1024*1024+1)],'large.png',{type:'image/png'}))).status===400,'Image size limit enforced');
  check((await upload(property,new File(['not a PDF'],'bad.pdf',{type:'application/pdf'}))).status===400,'Fake PDF denied');
  check((await upload(property,new File(['%PDF-1.7\n/JavaScript\n%%EOF'],'active.pdf',{type:'application/pdf'}))).status===400,'Active PDF denied');
  const uploaded=await upload(property,new File([image],'valid.png',{type:'image/png'}));check(uploaded.status===201,'Valid image upload');const media=(await uploaded.json()).item;
  check((await upload(property,new File([image],'stale.png',{type:'image/png'}))).status===409,'Stale upload rejected before linking');
  property=(await (await call(`${route}/properties/${property.id}`)).json()).item;
  const before=files.size;attachFailure=true;check((await upload(property,new File([image],'conflict.png',{type:'image/png'}))).status===409 && files.size===before,'Failed link cleans up uploaded object');
  uploadFailure=true;check((await upload(property,new File([image],'provider.png',{type:'image/png'}))).status===503,'Storage failure reported without broken metadata');uploadFailure=false;
  const publicImage=await call(`/api/catalog/media/${media.id}`,'GET',null,null);check(publicImage.status===200 && publicImage.headers.get('cache-control').includes('no-store') && publicImage.headers.get('content-type')==='image/webp','Public gateway returns bytes, no cached/signed URL');
  let pdfText='%PDF-1.4\n';const offsets=[0];
  for(const [index,object] of ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'].entries()){offsets.push(Buffer.byteLength(pdfText));pdfText+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(pdfText);pdfText+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdf=Buffer.from(pdfText);
  const doc=await upload(property,new File([pdf],'private.pdf',{type:'application/pdf'}),property.version,'Internal');check(doc.status===201,'Internal PDF upload');const document=(await doc.json()).item;
  check((await call(`/api/catalog/media/${document.id}`,'GET',null,null)).status===404,'Guest cannot open internal document');
  check((await call(`/api/catalog/media/${document.id}`)).status===200,'Admin opens internal document');
  const mediaInput={name:media.name,visibility:'Public',visible:false,sort_order:9,removed:false,version:media.version,reason:''};
  const hidden=await call(`${route}/media/${media.id}`,'PATCH',mediaInput);check(hidden.status===200,'Reorder and hide media');
  check((await call(`/api/catalog/media/${media.id}`,'GET',null,null)).status===404,'Hidden file revoked through gateway');
  check((await call(`${route}/media/${media.id}`,'PATCH',mediaInput)).status===409,'Stale media version rejected');
  const removed=await call(`${route}/media/${media.id}`,'PATCH',{...mediaInput,removed:true,version:1});check(removed.status===200 && files.size===2,'Unlink preserves storage object');
  check((await call(`/api/catalog/media/${media.id}`)).status===404,'Removed media cannot be opened');
  const publicList=await call('/api/catalog/properties?available=true','GET',null,null);check(publicList.status===200 && (await publicList.json()).items.every(p=>p.publication==='Published' && p.availability==='Available'),'AI/public availability source excludes Sold and hidden products');
  property=(await (await call(`${route}/properties/${property.id}`)).json()).item;
  check((await editProperty({publication:'Hidden',reason:'Ẩn sản phẩm để cập nhật'})).status===200,'Hide product with audit reason');
  check(!(await (await call('/api/catalog/properties','GET',null,null)).json()).items.some(p=>p.id===property.id),'Hidden product disappears from public source immediately');
  const detail=await (await call(`${route}/properties/${property.id}`)).json();check(detail.history.length>0 && detail.media.length===1,'History and remaining media load');
  currentRole='Sales';check((await call(`${route}/projects`)).status===403,'Current role downgrade takes effect');currentRole='Admin';
  active=false;check((await call(`${route}/projects`)).status===401,'Inactive account denied');active=true;
  offline=true;check((await call(`${route}/projects`)).status===503,'Provider outage fails closed');offline=false;
  console.log(`PASS: ${checks} M02 HTTP/Storage checks; fake provider only.`);
  if(process.argv.includes('--preview')){seed();if(process.argv.includes('--preview-user')){currentRole='User';profile.name='Minh Anh';}console.log(`PREVIEW READY: ${origin}; admin@example.test / safe-password-123 (fake provider only).`);await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
}finally{app.kill();provider.close();}
