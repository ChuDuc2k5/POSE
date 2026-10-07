import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';

// Isolated HTTP contract fixture. Authoritative SQL/RLS checks live in
// supabase/test-property-discovery.sql and roll back on the real database.
const projectId='fe100000-0000-4000-8000-000000000001';
const firstId='fe200000-0000-4000-8000-000000000001',hiddenId='fe200000-0000-4000-8000-000000000099';
const publicImageId='fe300000-0000-4000-8000-000000000001',publicDocumentId='fe300000-0000-4000-8000-000000000002',internalDocumentId='fe300000-0000-4000-8000-000000000003';
const uid=n=>`fe000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let currentRole='User',active=true,offline=false,verified=false,products,favorites,inquiries,snapshots,leadCount=0;
const profiles={1:{name:'Minh Anh',phone:'+84912345678',phoneVerified:false,notificationsEnabled:true,avatarPath:null,version:0},2:{name:'Khách hàng khác',phone:'',phoneVerified:false,notificationsEnabled:true,avatarPath:null,version:0}};
const user=n=>({id:uid(n),aud:'authenticated',role:'authenticated',email:n===1 ? 'minhanh@example.test':'other@example.test',email_confirmed_at:'2026-10-05T00:00:00Z',user_metadata:{display_name:profiles[n].name,role:'Admin'},app_metadata:{role:currentRole},created_at:'2026-10-05T00:00:00Z'});
const illustration=`<svg width="1000" height="620" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="620" fill="#e5efe8"/><circle cx="790" cy="120" r="55" fill="#efdebc"/><path d="M0 410Q230 310 500 420T1000 360V620H0Z" fill="#b5d0bc"/><rect x="220" y="120" width="230" height="350" rx="8" fill="#668f7c"/><rect x="468" y="205" width="200" height="265" rx="8" fill="#8faf99"/><g fill="#dfebe2"><path d="M248 150h36v48h-36zm64 0h36v48h-36zm64 0h36v48h-36zm-128 79h36v48h-36zm64 0h36v48h-36zm64 0h36v48h-36zm-128 79h36v48h-36zm64 0h36v48h-36zm64 0h36v48h-36zm120-69h44v50h-44zm73 0h44v50h-44zm-73 83h44v50h-44zm73 0h44v50h-44z"/></g><path d="M170 500h580" stroke="#678c73" stroke-width="8"/><circle cx="175" cy="414" r="51" fill="#699878"/><path d="M175 444v56" stroke="#668270" stroke-width="12"/><circle cx="752" cy="432" r="38" fill="#769e7f"/><path d="M752 460v40" stroke="#668270" stroke-width="12"/></svg>`;
const image=await sharp(Buffer.from(illustration)).webp().toBuffer();
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const media=[{id:publicImageId,property_id:firstId,name:'Hình minh họa công khai',media_type:'Image',mime_type:'image/webp',object_key:`${firstId}/${publicImageId}.webp`,sort_order:0,visibility:'Public',visible:true,removed:false},{id:publicDocumentId,property_id:firstId,name:'Thông tin sản phẩm',media_type:'Document',mime_type:'application/pdf',object_key:`${firstId}/${publicDocumentId}.pdf`,sort_order:1,visibility:'Public',visible:true,removed:false},{id:internalDocumentId,property_id:firstId,name:'Tài liệu nội bộ tuyệt mật',media_type:'Document',mime_type:'application/pdf',object_key:`${firstId}/${internalDocumentId}.pdf`,sort_order:2,visibility:'Internal',visible:true,removed:false}];
function seed(){
  products=Array.from({length:16},(_,i)=>({id:`fe200000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,code:`NEX-${String(i+1).padStart(3,'0')}`,name:i===0 ? 'Căn hộ Riverside · 2 phòng ngủ':i===1 ? 'Biệt thự sân vườn':i===2 ? 'Căn hộ giá liên hệ':`Căn hộ Riverside · Tầng ${i+3}`,project_id:projectId,subdivision_id:null,project_name:'NexCall Riverside',subdivision_name:null,amenities:'Công viên, hồ bơi, khu sinh hoạt cộng đồng.',location:i===1 ? 'Đà Nẵng':'Quận 7, Thành phố Hồ Chí Minh',description:'Không gian sống thoáng sáng, thiết kế tiện nghi và kết nối thuận tiện với khu vực xung quanh. Thông tin công bố được cập nhật bởi đội ngũ quản trị.',property_type:i===1 ? 'Villa':'Apartment',area:i===1 ? 180:82.5,bedrooms:i===1 ? 4:2,price:i===2 ? null:3200000000+i*100000000,currency:'VND',publication:'Published',availability:i===1 ? 'Reserved':i===3 ? 'Sold':'Available',version:0,updated_at:`2026-10-05T00:${String(59-i).padStart(2,'0')}:00Z`,cover_id:i===0 ? publicImageId:null}));
  products.push({...products[0],id:hiddenId,code:'PRIVATE',name:'Sản phẩm bí mật',publication:'Hidden',cover_id:null});
  favorites=[];inquiries=[];snapshots=new Map();leadCount=0;verified=false;currentRole='User';active=true;offline=false;
}
seed();
const visible=p=>p.publication==='Published';
const provider=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const input=raw && req.headers['content-type']?.includes('application/json') ? JSON.parse(raw):{};
  const url=new URL(req.url,'http://localhost'),token=req.headers.authorization?.replace('Bearer ',''),n=token==='fixture-user2' ? 2:1;
  const signed=['fixture-user1','fixture-user2'].includes(token);
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(offline)return reply(503,{message:'Unavailable'});
  if(url.pathname.endsWith('/token'))return reply(200,{access_token:'fixture-user1',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:user(1)});
  if(url.pathname.endsWith('/user'))return signed ? reply(200,user(n)):reply(401,{msg:'Invalid token'});
  if(url.pathname.endsWith('/logout')){res.writeHead(204);return res.end();}
  if(url.pathname.endsWith('/rpc/pose_access_context'))return reply(200,{user_id:uid(n),role:currentRole,active,session_valid:true});
  if(url.pathname.endsWith('/rpc/pose_read_profile'))return reply(200,{...profiles[n],phoneVerified:verified});
  if(url.pathname.endsWith('/rpc/pose_search_properties')){
    const f=input.p_filters;let snap;
    if(input.p_snapshot){snap=snapshots.get(input.p_snapshot);if(!snap || JSON.stringify(snap.filters)!==JSON.stringify(f) || snap.ids.some(id=>!visible(products.find(p=>p.id===id)) || products.find(p=>p.id===id).version!==snap.versions[id]))return reply(409,{code:'40001',message:'SEARCH_CHANGED'});}
    else{
      let rows=products.filter(visible);
      if(f.q)rows=rows.filter(p=>`${p.code} ${p.name} ${p.project_name}`.toLowerCase().includes(f.q.toLowerCase()));
      if(f.location)rows=rows.filter(p=>p.location.toLowerCase().includes(f.location.toLowerCase()));
      for(const [key,column] of [['project','project_id'],['type','property_type'],['availability','availability'],['bedrooms','bedrooms']])if(f[key]!==undefined)rows=rows.filter(p=>p[column]===f[key]);
      for(const [key,column,op] of [['minPrice','price','min'],['maxPrice','price','max'],['minArea','area','min'],['maxArea','area','max']])if(f[key]!==undefined)rows=rows.filter(p=>p[column]!==null && (op==='min' ? p[column]>=f[key]:p[column]<=f[key]));
      const column=f.sort?.startsWith('price') ? 'price':f.sort?.startsWith('area') ? 'area':'updated_at',ascending=f.sort?.endsWith('Asc');
      rows.sort((a,b)=>a[column]===null ? 1:b[column]===null ? -1:(a[column]>b[column] ? 1:a[column]<b[column] ? -1:0)*(ascending ? 1:-1) || a.id.localeCompare(b.id));
      snap={id:randomUUID(),filters:f,ids:rows.map(p=>p.id),versions:Object.fromEntries(rows.map(p=>[p.id,p.version]))};snapshots.set(snap.id,snap);
    }
    return reply(200,{items:snap.ids.slice((input.p_page-1)*input.p_size,input.p_page*input.p_size).map(id=>products.find(p=>p.id===id)),total:snap.ids.length,page:input.p_page,pageSize:input.p_size,snapshot:snap.id,expiresAt:'2026-10-05T08:00:00Z'});
  }
  if(url.pathname.includes('/rpc/pose_') && /favorite|inquir/.test(url.pathname)){
    if(!signed || !active || currentRole!=='User')return reply(403,{code:'42501',message:'CUSTOMER_REQUIRED'});
    const mine=row=>row.user_id===uid(n);
    if(url.pathname.endsWith('/pose_set_favorite')){
      if(input.p_saved && !products.some(p=>p.id===input.p_property && visible(p)))return reply(404,{code:'P0002',message:'NOT_FOUND'});
      if(input.p_saved){if(!favorites.some(row=>mine(row) && row.property_id===input.p_property))favorites.push({user_id:uid(n),property_id:input.p_property,created_at:new Date().toISOString()});}
      else favorites=favorites.filter(row=>!mine(row) || row.property_id!==input.p_property);
      return reply(200,{property_id:input.p_property,saved:input.p_saved});
    }
    if(url.pathname.endsWith('/pose_read_favorites')){const rows=favorites.filter(mine);return reply(200,{items:rows.slice((input.p_page-1)*input.p_size,input.p_page*input.p_size).map(row=>({...row,property:products.find(p=>p.id===row.property_id && visible(p)) || null})),total:rows.length,page:input.p_page,pageSize:input.p_size});}
    if(url.pathname.endsWith('/pose_read_inquiries')){const rows=inquiries.filter(mine);return reply(200,{items:rows.slice((input.p_page-1)*input.p_size,input.p_page*input.p_size).map(item=>Object.fromEntries(Object.entries(item).filter(([key])=>!['request_key','payload','user_id'].includes(key)))),total:rows.length});}
    if(url.pathname.endsWith('/pose_confirm_inquiry')){const row=inquiries.find(row=>mine(row) && row.id===input.p_id);if(!row)return reply(404,{code:'P0002',message:'NOT_FOUND'});if(verified && row.status==='PendingVerification'){row.status='Received';row.phone_verified=true;leadCount ||=1;}return reply(200,{id:row.id,status:row.status,phone_verified:row.phone_verified});}
    if(url.pathname.endsWith('/pose_submit_inquiry')){
      const data=input.p_data,old=inquiries.find(row=>mine(row) && row.request_key===input.p_key);
      if(old){if(JSON.stringify(old.payload)!==JSON.stringify(data))return reply(409,{code:'40001',message:'IDEMPOTENCY_CONFLICT'});return reply(200,{id:old.id,status:old.status,phone_verified:old.phone_verified,replayed:true});}
      if(data.property_id && !products.some(p=>p.id===data.property_id && visible(p)))return reply(404,{code:'P0002',message:'NOT_FOUND'});
      const row={...data,id:randomUUID(),user_id:uid(n),request_key:input.p_key,payload:data,email:user(n).email,property_name:products.find(p=>p.id===data.property_id)?.name || null,phone_verified:verified,status:verified ? 'Received':'PendingVerification',created_at:new Date().toISOString()};inquiries.unshift(row);if(verified)leadCount ||=1;
      return reply(200,{id:row.id,status:row.status,phone_verified:row.phone_verified,replayed:false});
    }
  }
  if(url.pathname.startsWith('/rest/v1/')){
    const table=url.pathname.split('/').pop();let rows=table==='property_public_catalog' ? products.filter(visible):table==='property_projects' ? [{id:projectId,name:'NexCall Riverside',archived:false}]:table==='property_media' ? media.filter(m=>m.visible && !m.removed && products.some(p=>p.id===m.property_id && visible(p)) && (signed && currentRole==='Admin' || m.visibility==='Public')):table==='customer_property_favorites' ? favorites.filter(row=>signed && currentRole==='User' && row.user_id===uid(n)):[];
    for(const [key,value] of url.searchParams){if(value.startsWith('eq.'))rows=rows.filter(row=>String(row[key])===value.slice(3));if(value.startsWith('in.')){const ids=value.slice(3).replace(/^\(|\)$/g,'').split(',');rows=rows.filter(row=>ids.includes(row[key]));}}
    if(url.searchParams.get('order'))rows.sort((a,b)=>{for(const entry of url.searchParams.get('order').split(',')){const [key,direction]=entry.split('.');const c=a[key]>b[key] ? 1:a[key]<b[key] ? -1:0;if(c)return direction==='desc' ? -c:c;}return 0;});
    const selected=url.searchParams.get('select');if(selected && selected!=='*')rows=rows.map(row=>Object.fromEntries(selected.split(',').map(key=>[key,row[key]])));
    res.setHeader('Content-Range',`0-${Math.max(0,rows.length-1)}/${rows.length}`);
    if(req.headers.accept?.includes('application/vnd.pgrst.object+json'))return reply(200,rows[0] || null);
    return reply(200,rows);
  }
  if(url.pathname.includes('/storage/v1/object/')){
    if(token!=='fixture-storage-key' && !(signed && currentRole==='Admin'))return reply(403,{message:'Forbidden'});
    const file=media.find(m=>url.pathname.endsWith(m.object_key));if(!file)return reply(404,{});
    res.writeHead(200,{'Content-Type':file.mime_type});return res.end(file.media_type==='Image' ? image:pdf);
  }
  return reply(404,{});
});
await new Promise(resolve=>provider.listen(3231,'127.0.0.1',resolve));
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port','3230'],{cwd:new URL('..',import.meta.url),env:{...process.env,SUPABASE_URL:'http://127.0.0.1:3231',SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',SUPABASE_STORAGE_SECRET_KEY:'fixture-storage-key'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';app.stdout.on('data',chunk=>{output+=chunk;});app.stderr.on('data',chunk=>{output+=chunk;});
const origin='http://localhost:3230',cookie='pose-access=fixture-user1',other='pose-access=fixture-user2';let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const call=(path,method='GET',body,session=cookie,requestOrigin=origin)=>fetch(`${origin}${path}`,{method,redirect:'manual',headers:{...(session ? {Cookie:session}:{}),...(method!=='GET' ? {Origin:requestOrigin,'Content-Type':'application/json'}:{})},...(body!==undefined ? {body:JSON.stringify(body)}:{})});
const payload={property_id:firstId,name:' Minh Anh ',phone:'0912345678',country:'VN',channel:'Email',preferred_time:'14:00–16:00',message:'Tôi quan tâm căn hộ hai phòng ngủ.',consent:{contact:true,call:false,ai:false,transcript:false,recording:false},request_key:randomUUID()};
try{
  let ready=false;for(let i=0;i<40;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,output);
  check((await call('/properties','GET',undefined,null)).status===200,'Guest can browse');
  const guestHeader=(await (await call('/properties','GET',undefined,null)).text()).match(/<header\b[\s\S]*?<\/header>/)?.[0] || '';
  check(guestHeader.includes('href="/sign-in"') && guestHeader.includes('href="/sign-up"') && !guestHeader.includes('Đăng xuất'),'Guest first HTML contains guest navigation');
  for(const role of ['User','Sales','Admin']){
    currentRole=role;
    for(const path of ['/properties',`/properties/${firstId}`]){
      const header=(await (await call(path)).text()).match(/<header\b[\s\S]*?<\/header>/)?.[0] || '';
      const destination=role==='Admin' ? '/admin':role==='Sales' ? '/sales':'/customer';
      check(header.includes('Hồ sơ cá nhân') && header.includes('Đăng xuất') && header.includes(`href="${destination}"`) && !header.includes('href="/sign-in"') && !header.includes('href="/sign-up"'),`${role} public page ${path} has correct navigation in first HTML`);
    }
  }
  currentRole='User';
  check((await call('/customer/favorites','GET',undefined,null)).status===307,'Favorites page protected on server');
  check((await call('/customer/inquiries','GET',undefined,null)).status===307,'Inquiry list protected on server');
  for(const query of ['page=0','pageSize=51','minPrice=9&maxPrice=1','minArea=80&maxArea=20','minPrice=-1','maxPrice=Infinity','bedrooms=2.5','type=Unknown','project=invalid','sort=unknown','snapshot=invalid','publication=Hidden','q=one&q=two'])check((await call(`/api/catalog/search?${query}`,'GET',undefined,null)).status===400,`Invalid filter: ${query}`);
  const filtered=await (await call(`/api/catalog/search?type=Apartment&project=${projectId}&location=Qu%E1%BA%ADn%207&bedrooms=2&minPrice=3000000000&maxPrice=3250000000&minArea=80&maxArea=90&availability=Available`)).json();
  check(filtered.total===1 && filtered.items[0].id===firstId,'All filters combine');
  const first=await (await call('/api/catalog/search?pageSize=10')).json(),second=await (await call(`/api/catalog/search?page=2&pageSize=10&snapshot=${first.snapshot}`)).json();
  check(first.total===16 && new Set([...first.items,...second.items].map(p=>p.id)).size===16,'Stable pagination covers all without duplicates');
  const numeric=await (await call('/api/catalog/search?minPrice=0')).json();check(numeric.total===15 && numeric.items.every(p=>p.price!==null),'Unknown price excluded from numeric range');
  const literal=await (await call('/api/catalog/search?q=%25%22%29%2Cpublication.eq.Hidden')).json();check(literal.total===0,'Search punctuation stays literal');
  const detail=await call(`/api/catalog/properties/${firstId}`),details=await detail.json();
  check(detail.status===200 && details.media.length===2 && !JSON.stringify(details).includes('object_key') && !JSON.stringify(details).includes('tuyệt mật'),'Public detail excludes internal documents and storage keys');
  check((await call(`/api/catalog/properties/${hiddenId}`)).status===404,'Hidden detail API denied');
  check((await call(`/properties/${hiddenId}`)).status===404,'Hidden direct page denied');
  check((await call(`/properties/${firstId}`)).status===200,'Published detail page renders');
  currentRole='Admin';check((await call(`/api/catalog/properties/${hiddenId}`)).status===404,'Admin public preview remains public');
  check((await call(`/api/catalog/media/${internalDocumentId}?public=true`)).status===404,'Public file flag never exposes internal file to Admin');currentRole='User';
  check((await call(`/api/catalog/media/${publicDocumentId}?public=true`)).status===200,'Public document downloads through gateway');
  check((await call(`/api/customer/favorites/${firstId}`,'PUT',undefined,null)).status===401,'Guest favorite denied');
  check((await call(`/api/customer/favorites/${firstId}`,'PUT',undefined,cookie,'https://evil.example')).status===403,'Cross-origin favorite denied');
  check((await call(`/api/customer/favorites/${firstId}`,'PUT',{user_id:uid(2)})).status===400,'Favorite ownership fields rejected');
  check((await call(`/api/customer/favorites/${hiddenId}`,'PUT')).status===404,'Cannot save hidden product');
  check((await call(`/api/customer/favorites/${firstId}`,'PUT')).status===200,'Save favorite');
  await call(`/api/customer/favorites/${firstId}`,'PUT');check(favorites.length===1,'Repeated save is idempotent');
  check((await (await call('/api/customer/favorites')).json()).total===1,'Owner sees favorite');
  check((await (await call('/api/customer/favorites','GET',undefined,other)).json()).total===0,'Other customer cannot see favorite');
  check((await (await call(`/api/customer/favorites/status?ids=${firstId}`)).json()).ids[0]===firstId,'Card favorite status matches current user');
  check((await call('/api/customer/inquiries','POST',payload,null)).status===401,'Guest inquiry denied');
  check((await call('/api/customer/inquiries','POST',payload,cookie,'https://evil.example')).status===403,'Cross-origin inquiry denied');
  for(const extra of ['user_id','phone_verified','lead_id','email'])check((await call('/api/customer/inquiries','POST',{...payload,[extra]:'forged'})).status===400,`Reject forged ${extra}`);
  check((await call('/api/customer/inquiries','POST',{...payload,country:''})).status===400,'Country must be confirmed explicitly');
  check((await call('/api/customer/inquiries','POST',{...payload,consent:{...payload.consent,contact:false}})).status===400,'Processing consent required');
  check((await call('/api/customer/inquiries','POST',{...payload,channel:'Phone'})).status===400,'Phone channel requires independent call consent');
  check((await call('/api/customer/inquiries','POST',{...payload,consent:{...payload.consent,recording:'true'}})).status===400,'Consent values must be booleans');
  check((await call('/api/customer/inquiries','POST',{...payload,property_id:hiddenId})).status===404,'Inquiry cannot target hidden property');
  const submitted=await call('/api/customer/inquiries','POST',payload),inquiry=await submitted.json();
  check(submitted.status===201 && inquiry.status==='PendingVerification' && leadCount===0,'Unverified number remains pending and cannot create eligible Lead');
  check(inquiries[0].phone==='+84912345678' && inquiries[0].name==='Minh Anh' && !inquiries[0].consent.call && !inquiries[0].consent.recording,'Phone normalized and declined purposes preserved');
  check((await call('/api/customer/inquiries','POST',payload)).status===200 && inquiries.length===1,'Retry returns same inquiry');
  check((await call('/api/customer/inquiries','POST',{...payload,message:'Nội dung khác cùng mã'})).status===409,'Idempotency key cannot change payload');
  check((await (await call('/api/customer/inquiries','GET',undefined,other)).json()).total===0,'Other customer cannot read inquiries');
  check((await call(`/api/customer/inquiries/${inquiry.id}/confirm`,'POST',undefined,other)).status===404,'Other customer cannot confirm inquiry');
  verified=true;const promoted=await (await call(`/api/customer/inquiries/${inquiry.id}/confirm`,'POST')).json();
  check(promoted.status==='Received' && promoted.phone_verified && leadCount===1 && inquiries.length===1,'Verification promotes same inquiry');
  await call('/api/customer/inquiries','POST',{...payload,request_key:randomUUID(),message:'Nhu cầu mới của cùng khách hàng.'});check(leadCount===1,'Additional request reuses open Lead');
  products[0].publication='Hidden';products[0].version++;
  check((await (await call('/api/customer/favorites')).json()).items[0].property===null,'Hidden favorite redacted but retained');
  check((await call(`/api/catalog/search?page=2&pageSize=10&snapshot=${first.snapshot}`)).status===409,'Changed catalog invalidates search snapshot');
  check((await call(`/api/customer/favorites/${firstId}`,'DELETE')).status===200 && favorites.length===0,'Unavailable favorite can be removed');
  currentRole='Sales';check((await call('/api/customer/favorites')).status===403,'Current Sales role denied');check((await call('/api/customer/inquiries')).status===403,'Staff cannot use customer API');
  currentRole='User';active=false;check((await call('/api/customer/inquiries')).status===401,'Suspended customer denied');active=true;
  offline=true;check((await call('/api/catalog/search')).status===503,'Search provider failure explicit');offline=false;
  console.log(`PASS: ${checks} M03 HTTP checks; no real account, email or SMS created.`);
  if(process.argv.includes('--preview')){seed();console.log(`PREVIEW READY: ${origin}; minhanh@example.test / safe-password-123 (fake User only).`);await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
}finally{app.kill();provider.close();}
