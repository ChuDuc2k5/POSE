import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createCampaignDatabase } from './campaign-test-db.mjs';
import { createSimulator } from './telephony-simulator.mjs';
import { createHmac,createHash } from 'node:crypto';
import { stopProcess } from './campaign-test-process.mjs';

// The fake Supabase transport executes the real RPCs and RLS in isolated PostgreSQL.
const db=await createCampaignDatabase();
await db.exec(await readFile(new URL('../../supabase/automated-calling.sql',import.meta.url),'utf8'));
const fixture=await readFile(new URL('../../supabase/test-automated-calling.sql',import.meta.url),'utf8');
await db.exec(fixture.split('-- Calling fixtures begin.')[1].split('-- Calling fixtures end.')[0]);
await db.exec("update call_jobs j set scheduled_at=now()-interval '1 hour'+right(m.phone_e164,4)::integer*interval '1 second' from campaign_customers m where m.id=j.membership_id");
const id=(prefix,n=1)=>`f7${prefix}0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const publishedId=id('80'),productId=id('60');
const origin='http://localhost:3500',cron='m08-cron-secret-with-at-least-32-characters';
let chain=Promise.resolve();
function transaction(role,fn){const task=chain.then(async()=>{await db.exec('begin');try{await db.exec(`set local role ${role==='System' ? 'service_role':role==='Guest' ? 'anon':'authenticated'}`);const n=role==='Admin' ? 1:role==='Sales' ? 2:3;await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(role==='System' ? {role:'service_role'}:role==='Guest' ? {}:{sub:id('10',n),session_id:id('20',n),role:'authenticated'})]);const value=await fn();await db.exec('commit');return value;}catch(e){await db.exec('rollback');throw e;}});chain=task.catch(()=>{});return task;}
const files=new Map(),signed=new Map(),scenarios=new Map();let uploadFailure=false,llmCalls=0;
const quote=x=>`"${String(x).replaceAll('"','""')}"`;
const provider=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost'),token=req.headers.authorization?.replace('Bearer ',''),role=token==='fixture-service' ? 'System':token==='fixture-admin' ? 'Admin':token==='fixture-sales' ? 'Sales':token==='fixture-user' ? 'User':'Guest';
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/v1/chat/completions'){llmCalls++;return reply(200,{choices:[{message:{content:JSON.stringify({reply:'Xin vui long noi ro nhu cau cua ban.',intent:'real_estate',needs:[]})}}]});}
  if(url.pathname==='/fixture'){res.writeHead(302,{'Set-Cookie':'pose-access=fixture-admin; Path=/; HttpOnly; SameSite=Lax',Location:origin+(url.searchParams.get('path')||'/admin/calls')});res.end();return;}
  if(url.pathname.endsWith('/user')){const n=role==='Admin' ? 1:role==='Sales' ? 2:3;return role==='Guest' ? reply(401,{msg:'Invalid token'}):reply(200,{id:id('10',n),aud:'authenticated',role:'authenticated',email:`m07-${n}@example.test`,email_confirmed_at:new Date().toISOString(),app_metadata:{role},user_metadata:{role:'Admin'}});}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);const input=bytes.length&&req.headers['content-type']?.includes('application/json')?JSON.parse(bytes):{};

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
   if(!['calls','call_events','call_turns','contact_consents','campaigns','call_scripts','call_script_versions','property_products','property_public_catalog','property_projects','property_subdivisions'].includes(table))return reply(404,{});
   const values=[],where=[];
   for(const [key,value] of url.searchParams){if(['select','order','offset','limit'].includes(key))continue;const p=value.indexOf('.'),op=value.slice(0,p),v=value.slice(p+1);if(!['eq','ilike','in'].includes(op))throw Error('Unsupported fake filter');if(op==='in'){values.push(v.slice(1,-1).split(','));where.push(`${quote(key)}=any($${values.length}::uuid[])`);}else{values.push(v);where.push(`${quote(key)} ${op==='eq' ? '=':'ilike'} $${values.length}`);}}
   const result=await transaction(role,()=>db.query(`select * from public.${quote(table)}${where.length ? ' where '+where.join(' and '):''}${url.searchParams.get('order') ? ' order by '+url.searchParams.get('order').split(',').map(x=>{const [key,dir]=x.split('.');return `${quote(key)} ${dir==='desc' ? 'desc':'asc'}`;}).join(','):''}`,values));
   const offset=Number(url.searchParams.get('offset') || req.headers['range']?.split('-')[0] || 0),limit=Number(url.searchParams.get('limit') || (req.headers.range ? Number(req.headers.range.split('-')[1])-offset+1:10000));
   res.setHeader('content-range',`${offset}-${Math.max(offset,offset+limit-1)}/${result.rows.length}`);
   const rows=result.rows.slice(offset,offset+limit);
   return reply(200,req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] || null:rows);
  }
  reply(404,{});
 }catch(e){console.error('Gateway:',e.message,e.code,e.where||'');res.writeHead(e.code==='42501' ? 403:e.code==='40001' || e.code==='23505' ? 409:400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:e.code || 'XX000',message:e.message,details:e.detail || null}));}
});
let app,simulator,output='';
const cronToken=cron;
export async function startCallingFixture(){
 await new Promise(resolve=>provider.listen(3501,'127.0.0.1',resolve));
 process.env.TELEPHONY_API_KEY='fixture-telephony';process.env.TELEPHONY_WEBHOOK_SECRET='fixture-webhook-secret';
 simulator=createSimulator({scenarioFor:input=>scenarios.get(input.to)||'hold'});
 await new Promise(resolve=>simulator.server.listen(3509,'127.0.0.1',resolve));
 await db.exec('grant select on storage.objects to authenticated');
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port','3500'],{cwd:new URL('..',import.meta.url),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,SUPABASE_URL:'http://127.0.0.1:3501',SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SECRET_KEY:'fixture-service',CRON_SECRET:cronToken,TELEPHONY_PROVIDER:'simulator',TELEPHONY_API_URL:'http://127.0.0.1:3509',TELEPHONY_CALLER_ID:'simulator',APP_PUBLIC_URL:origin,AI_API_URL:'http://127.0.0.1:3501/v1',AI_MODEL:'fixture'}});
 app.stdout.on('data',x=>output+=x);app.stderr.on('data',x=>output+=x);
 for(let n=0;n<100;n++){try{if((await fetch(`${origin}/api/calls`,{headers:{Cookie:'pose-access=fixture-admin'}})).ok)return;}catch{}await delay(150);}throw Error(output);
}
export async function closeCallingFixture(){try{await stopProcess(app);}finally{await simulator?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await db.close();}}
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
export {id,origin,publishedId,productId};
