import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { startStack } from './test-stack.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { createCampaignDatabase } from './campaign-test-db.mjs';
import { createSimulator } from './telephony-simulator.mjs';
import { createHmac,createHash } from 'node:crypto';

// The fake Supabase transport executes the real RPCs and RLS in isolated PostgreSQL.
const db=await createCampaignDatabase();
await db.exec(await readFile(new URL('../../supabase/automated-calling.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/browser-voice.sql',import.meta.url),'utf8'));
const fixture=await readFile(new URL('../../supabase/test-automated-calling.sql',import.meta.url),'utf8');
const id=(prefix,n=1)=>`f7${prefix}0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const publishedId=id('80'),productId=id('60');
await db.exec(fixture.split('-- Calling fixtures begin.')[1].split('-- Calling fixtures end.')[0].replace('"property_ids":[]',`"property_ids":["${productId}"]`));
await db.exec("update call_jobs j set scheduled_at=now()-interval '1 hour'+right(m.phone_e164,4)::integer*interval '1 second' from campaign_customers m where m.id=j.membership_id");
const origin='http://localhost:3500',cron='m08-cron-secret-with-at-least-32-characters';
let chain=Promise.resolve();
function transaction(role,fn){const task=chain.then(async()=>{await db.exec('begin');try{await db.exec(`set local role ${role==='System' ? 'service_role':role==='Guest' ? 'anon':'authenticated'}`);const n=role==='Admin' ? 1:role==='Sales' ? 2:3;await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(role==='System' ? {role:'service_role'}:role==='Guest' ? {}:{sub:id('10',n),session_id:id('20',n),role:'authenticated'})]);const value=await fn();await db.exec('commit');return value;}catch(e){await db.exec('rollback');throw e;}});chain=task.catch(()=>{});return task;}
const files=new Map(),signed=new Map(),scenarios=new Map();let uploadFailure=false,llmCalls=0,modelDelay=0,lastModelInput;
const quote=x=>`"${String(x).replaceAll('"','""')}"`;
const provider=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost'),token=req.headers.authorization?.replace('Bearer ',''),role=token==='fixture-service' ? 'System':token==='fixture-admin' ? 'Admin':token==='fixture-sales' ? 'Sales':token==='fixture-user' ? 'User':'Guest';
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/fixture'){const fixtureRole=url.searchParams.get('role')==='sales'?'sales':'admin';res.writeHead(302,{'Set-Cookie':`pose-access=fixture-${fixtureRole}; Path=/; HttpOnly; SameSite=Lax`,Location:origin+(url.searchParams.get('path')||'/admin/calls')});res.end();return;}
  if(url.pathname.endsWith('/user')){const n=role==='Admin' ? 1:role==='Sales' ? 2:3;return role==='Guest' ? reply(401,{msg:'Invalid token'}):reply(200,{id:id('10',n),aud:'authenticated',role:'authenticated',email:`m07-${n}@example.test`,email_confirmed_at:new Date().toISOString(),app_metadata:{role},user_metadata:{role:'Admin'}});}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);const input=bytes.length&&req.headers['content-type']?.includes('application/json')?JSON.parse(bytes):{};
  if(url.pathname==='/v1/chat/completions'){llmCalls++;lastModelInput=JSON.parse(input.messages.at(-1).content.split('\n').slice(1,-1).join('\n'));if(modelDelay)await delay(modelDelay);return reply(200,{choices:[{message:{content:JSON.stringify({reply:'Xin vui lòng nói rõ nhu cầu của bạn.',intent:'real_estate',needs:[]})}}]});}

  if(req.method==='POST'&&url.pathname.startsWith('/storage/v1/object/sign/call-recordings/')){
   const key=decodeURIComponent(url.pathname.split('/call-recordings/')[1]);
   const allowed=await transaction(role,()=>db.query('select name from storage.objects where bucket_id=$1 and name=$2',['call-recordings',key]));
   if(!allowed.rows.length)return reply(403,{});
   const sig=createHash('sha256').update(key+Date.now()).digest('hex');signed.set(sig,{key,expires:Date.now()+input.expiresIn*1000});
   return reply(200,{signedURL:'/object/sign/call-recordings/'+key+'?token='+sig});
  }
  if(url.pathname.startsWith('/storage/v1/object/sign/')){
   const entry=signed.get(url.searchParams.get('token'));if(!entry||entry.expires<Date.now())return reply(403,{message:'Expired'});
   res.writeHead(200,{'Content-Type':'audio/wav'});return res.end(files.get(entry.key));
  }
  if(url.pathname.startsWith('/storage/v1/object/call-recordings/')){
   if(role!=='System')return reply(403,{});if(uploadFailure)return reply(503,{message:'Upload failed'});
   const key=decodeURIComponent(url.pathname.split('/call-recordings/')[1]);files.set(key,bytes);
   await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['call-recordings',key]);return reply(200,{Key:key});
  }

  if(url.pathname.includes('/rpc/')){
   const name=url.pathname.split('/').at(-1);
   if(!/^pose_[a-z_]+$/.test(name))return reply(404,{});
   const result=await transaction(role,()=>db.query(`select public.${quote(name)}(${Object.keys(input).map((k,i)=>`${quote(k)} => $${i+1}`).join(',')}) as result`,Object.values(input).map(x=>x!==null && typeof x==='object' ? JSON.stringify(x):x)));
   return reply(200,result.rows[0].result);
  }
  if(url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.split('/').at(-1);
   if(!['account_history','lead_tasks','calls','call_events','call_turns','contact_consents','campaigns','call_scripts','call_script_versions','property_products','property_public_catalog','property_projects','property_subdivisions'].includes(table))return reply(404,{});
   const values=[],where=[];
   for(const [key,value] of url.searchParams){if(['select','order','offset','limit'].includes(key))continue;const p=value.indexOf('.'),op=value.slice(0,p),v=value.slice(p+1);if(!['eq','ilike','in','gte','lte','gt','lt'].includes(op))throw Error('Unsupported fake filter');if(op==='in'){values.push(v.slice(1,-1).split(','));where.push(`${quote(key)}=any($${values.length}::${key==='id'||key.endsWith('_id')?'uuid':'text'}[])`);}else{values.push(v);where.push(`${quote(key)} ${({eq:'=',ilike:'ilike',gte:'>=',lte:'<=',gt:'>',lt:'<'})[op]} $${values.length}`);}}
   const result=await transaction(role,()=>db.query(`select * from public.${quote(table)}${where.length ? ' where '+where.join(' and '):''}${url.searchParams.get('order') ? ' order by '+url.searchParams.get('order').split(',').map(x=>{const [key,dir]=x.split('.');return `${quote(key)} ${dir==='desc' ? 'desc':'asc'}`;}).join(','):''}`,values));
   if(table==='lead_tasks')for(const task of result.rows){
    const lead=await transaction(role,()=>db.query('select l.*,jsonb_build_object(\'full_name\',c.full_name) customers from leads l join customers c on c.id=l.customer_id where l.id=$1',[task.lead_id]));task.leads=lead.rows[0]||null;
   }
   const offset=Number(url.searchParams.get('offset') || req.headers['range']?.split('-')[0] || 0),limit=Number(url.searchParams.get('limit') || (req.headers.range ? Number(req.headers.range.split('-')[1])-offset+1:10000));
   res.setHeader('content-range',`${offset}-${Math.max(offset,offset+limit-1)}/${result.rows.length}`);
   const selected=url.searchParams.get('select'),columns=selected?.split(',');
   const rows=result.rows.slice(offset,offset+limit).map(row=>columns?.every(key=>/^[a-z_]+$/.test(key))?Object.fromEntries(columns.map(key=>[key,row[key]])):row);
   return reply(200,req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] || null:rows);
  }
  reply(404,{});
 }catch(e){console.error('Gateway:',e.message,e.code,e.where||'');res.writeHead(e.code==='42501' ? 403:e.code==='40001' || e.code==='23505' ? 409:400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:e.code || 'XX000',message:e.message,details:e.detail || null}));}
});
let app,stack,simulator,output='';
const cronToken=cron;
export async function startCallingFixture(options={}){
 await new Promise(resolve=>provider.listen(3501,'127.0.0.1',resolve));
 process.env.TELEPHONY_API_KEY='fixture-telephony';process.env.TELEPHONY_WEBHOOK_SECRET='fixture-webhook-secret';
 simulator=createSimulator({scenarioFor:input=>scenarios.get(input.to)||'hold'});
 await new Promise(resolve=>simulator.server.listen(3509,'127.0.0.1',resolve));
 await db.exec('grant select on storage.objects to authenticated');
 stack=await startStack(3500,{...process.env,SUPABASE_URL:'http://127.0.0.1:3501',SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SECRET_KEY:'fixture-service',CRON_SECRET:cronToken,TELEPHONY_PROVIDER:'simulator',TELEPHONY_API_URL:'http://127.0.0.1:3509',TELEPHONY_CALLER_ID:'simulator',APP_PUBLIC_URL:origin,AI_API_URL:options.aiUrl||'http://127.0.0.1:3501/v1',AI_MODEL:options.model||'fixture'},{build:false,backendPort:3503});app=stack.app;
 app.stdout.on('data',x=>output+=x);app.stderr.on('data',x=>output+=x);
 for(let n=0;n<100;n++){try{if((await fetch(`${origin}/api/calls`,{headers:{Cookie:'pose-access=fixture-admin'}})).ok)return;}catch{}await delay(150);}throw Error(output);
}
export async function closeCallingFixture(){try{await stack?.close();}finally{await simulator?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await db.close();}}
export const sql=(query,params=[])=>transaction('Owner',()=>db.query(query,params));
export const owner=(query,params=[])=>{const task=chain.then(()=>db.query(query,params));chain=task.catch(()=>{});return task;};
export const scalar=async(query,params=[])=>Object.values((await owner(query,params)).rows[0])[0];
export const system=(name,args)=>transaction('System',async()=>{const result=await db.query(`select public.${quote(name)}(${Object.keys(args).map((k,i)=>`${quote(k)}=>$${i+1}`).join(',')}) result`,Object.values(args).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));return result.rows[0].result;});
export const call=(path,method='GET',body,role='admin',requestOrigin=origin)=>fetch(`${origin}${path}`,{method,headers:{...(role?{Cookie:`pose-access=fixture-${role}`} : {}),...(method!=='GET'?{Origin:requestOrigin,'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
export const cronCall=path=>fetch(`${origin}/api/system/calls/${path}`,{method:'POST',headers:{Authorization:`Bearer ${cronToken}`}});
export const stats=()=>fetch('http://127.0.0.1:3509/stats',{headers:{Authorization:'Bearer fixture-telephony'}}).then(r=>r.json());
export async function postEvent(event,{bad=false,stale=false}={}){
 const body=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000)-(stale?301:0)),sig=createHmac('sha256','fixture-webhook-secret').update(`${timestamp}.${body}`).digest('hex');
 return fetch(`${origin}/api/webhooks/telephony`,{method:'POST',headers:{'Content-Type':'application/json','x-terava-timestamp':timestamp,'x-terava-signature':bad?'0'.repeat(64):sig},body});
}
export const setScenario=(phone,scenario)=>scenarios.set(phone,scenario);
export const setUploadFailure=value=>{uploadFailure=value;};
export const expireSigned=()=>{for(const entry of signed.values())entry.expires=0;};
export const modelCount=()=>llmCalls;
export const modelInput=()=>lastModelInput;
export async function seedCallingUi(){
 modelDelay=1000;
 await owner("update auth.users set raw_user_meta_data=jsonb_build_object('display_name',case when id=$1 then 'Minh Anh' else 'Thanh Lam' end) where id in ($1,$2)",[id('10',2),id('10')]);
 await owner("insert into users(full_name,email,auth_user_id,role,account_status,email_verified) values('Minh Anh','m07-2@example.test',$1,'Sales','active',true)",[id('10',2)]);
 await owner('insert into lead_assignments(lead_id,sales_id) select l.id,u.id from leads l cross join users u where u.auth_user_id=$1 and l.id=any($2::uuid[])',[id('10',2),[id('40'),id('40',2),id('40',4),id('40',5)]]);
 const first=(await owner("select * from calls where lead_id=$1",[id('40')])).rows[0];
 for(const type of ['ringing','answered','completed'])await system('pose_system_apply_call_event',{p_event:{event_id:`preview:${first.id}:${type}`,provider_call_id:first.id,type,occurred_at:new Date().toISOString(),duration_seconds:84,cost:{amount:0.01,currency:'USD',fx_rate:25000,fx_source:'Tỷ giá giả lập'}}});
 await owner("update calls set created_at=now()+interval '1 second',started_at=now()-interval '84 seconds',end_reason='CLOSED',cost_estimated_vnd=3500000,conversation=$2,recording_status='Available',transcript_status='Available' where id=$1",[first.id,JSON.stringify({phase:'ended',silences:0,turns:5,consents:{AIVoice:true,Recording:true,Transcript:true},end_reason:'CLOSED'})]);
 await owner("insert into contact_consents(phone_e164,lead_id,customer_id,purpose,status,channel,source,evidence,policy_version) select phone_e164,lead_id,customer_id,p,'Granted','Call','Call','Đồng ý | call:'||id,'call.v1' from calls cross join unnest(array['AIVoice','Recording','Transcript']) p where id=$1",[first.id]);
 await owner("insert into call_transcripts(call_id,transcript,language) values($1,'Customer: Tôi cần tư vấn căn hộ. AI: Chuyên viên sẽ liên hệ theo yêu cầu.','vi')",[first.id]);
 const key=first.id+'/preview.wav',bytes=Buffer.from('simulated recording; no real call');files.set(key,bytes);
 await owner("insert into storage.objects(bucket_id,name) values('call-recordings',$1)",[key]);
 await owner("insert into call_recordings(call_id,recording_url,checksum,size_bytes,mime_type) values($1,$2,$3,$4,'audio/wav')",[first.id,key,createHash('sha256').update(bytes).digest('hex'),bytes.length]);
 for(const [n,state]of [[4,'Processing'],[5,'Failed'],[6,'NotConsented']])await owner("insert into calls(customer_id,lead_id,campaign_id,phone_e164,script_version_id,provider,call_type,status,started_at,ended_at,duration_seconds,end_reason,recording_status,transcript_status) select c.id,l.id,$2,c.phone,$3,'simulator','MOCK_CALL','COMPLETED',now()-interval '2 minutes',now(),120,'CLOSED',$4,$4 from leads l join customers c on c.id=l.customer_id where l.id=$1",[id('40',n),first.campaign_id,publishedId,state]);
 await owner("insert into lead_tasks(lead_id,kind,summary,source,idempotency_key,assignee_id) select $1,'Handoff','Khách cần chuyên viên tư vấn căn hộ','AI','preview-handoff',id from users where auth_user_id=$2",[id('40'),id('10',2)]);
}
export {id,origin,publishedId,productId};
