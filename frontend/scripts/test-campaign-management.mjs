// From frontend/: set PGLITE_PATH to an external @electric-sql/pglite directory;
// node scripts/test-campaign-management.mjs (requires npx next build first).
// --preview-only serves clean disposable UI fixtures; --preview keeps HTTP fixtures.
// PowerShell: $env:PGLITE_PATH='C:/Users/Admin/AppData/Local/Temp/pose-m06-pg/node_modules/@electric-sql/pglite'
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createCampaignDatabase } from './campaign-test-db.mjs';
import { stopProcess } from './campaign-test-process.mjs';

// The fake Supabase transport executes the real RPCs and RLS in isolated PostgreSQL.
const db=await createCampaignDatabase();
const fixture=await readFile(new URL('../../supabase/test-campaign-management.sql',import.meta.url),'utf8');
await db.exec(fixture.split('-- Fixtures begin (also used by the isolated HTTP test gateway).')[1].split('-- Fixtures end.')[0]);
const id=(prefix,n=1)=>`f7${prefix}0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const adminId=id('10'),publishedId=id('80'),productId=id('60');
const origin='http://localhost:3400',base='/api/admin/campaigns',cron='m07-cron-secret-with-at-least-32-characters';
let chain=Promise.resolve(),offline=false,tickNow=null,previewId='';
const previewOnly=process.argv.includes('--preview-only');
const previewReadyId='f7900000-0000-4000-8000-000000000002';
const waitPreview=()=>new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);process.once('message',resolve);});
function transaction(role,fn){const task=chain.then(async()=>{await db.exec('begin');try{await db.exec(`set local role ${role==='System' ? 'service_role':role==='Guest' ? 'anon':'authenticated'}`);const n=role==='Admin' ? 1:role==='Sales' ? 2:3;await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(role==='System' ? {role:'service_role'}:role==='Guest' ? {}:{sub:id('10',n),session_id:id('20',n),role:'authenticated'})]);const value=await fn();await db.exec('commit');return value;}catch(e){await db.exec('rollback');throw e;}});chain=task.catch(()=>{});return task;}
const quote=x=>`"${String(x).replaceAll('"','""')}"`;
const provider=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost'),token=req.headers.authorization?.replace('Bearer ',''),role=token==='fixture-service' ? 'System':token==='fixture-admin' ? 'Admin':token==='fixture-sales' ? 'Sales':token==='fixture-user' ? 'User':'Guest';
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(offline)return reply(503,{message:'Unavailable'});
  if(url.pathname==='/fixture' && (previewOnly || process.argv.includes('--preview'))){res.writeHead(302,{'Set-Cookie':'pose-access=fixture-admin; Path=/; HttpOnly; SameSite=Lax',Location:`${origin}/admin/campaigns${url.searchParams.has('detail') ? '/'+(url.searchParams.has('ready') ? previewReadyId:previewId):''}${url.searchParams.has('tab') ? '?tab='+Number(url.searchParams.get('tab')):''}`});res.end();return;}
  if(url.pathname.endsWith('/user')){const n=role==='Admin' ? 1:role==='Sales' ? 2:3;return role==='Guest' ? reply(401,{msg:'Invalid token'}):reply(200,{id:id('10',n),aud:'authenticated',role:'authenticated',email:`m07-${n}@example.test`,email_confirmed_at:new Date().toISOString(),app_metadata:{role},user_metadata:{role:'Admin'}});}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=chunks.length ? JSON.parse(Buffer.concat(chunks).toString()):{};
  if(url.pathname.includes('/rpc/')){
   const name=url.pathname.split('/').at(-1);
   if(!/^pose_[a-z_]+$/.test(name))return reply(404,{});
   if(name==='pose_system_campaign_tick' && tickNow)input.p_now=tickNow;
   const result=await transaction(role,()=>db.query(`select public.${quote(name)}(${Object.keys(input).map((k,i)=>`${quote(k)} => $${i+1}`).join(',')}) as result`,Object.values(input).map(x=>x!==null && typeof x==='object' ? JSON.stringify(x):x)));
   return reply(200,result.rows[0].result);
  }
  if(url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.split('/').at(-1);
   if(!['campaigns','call_scripts','call_script_versions','property_products','property_projects','property_subdivisions'].includes(table))return reply(404,{});
   const values=[],where=[];
   for(const [key,value] of url.searchParams){if(['select','order','offset','limit'].includes(key))continue;const p=value.indexOf('.'),op=value.slice(0,p),v=value.slice(p+1);if(!['eq','ilike'].includes(op))throw Error('Unsupported fake filter');values.push(v);where.push(`${quote(key)} ${op==='eq' ? '=':'ilike'} $${values.length}`);}
   const result=await transaction(role,()=>db.query(`select * from public.${quote(table)}${where.length ? ' where '+where.join(' and '):''}${url.searchParams.get('order') ? ' order by '+url.searchParams.get('order').split(',').map(x=>{const [key,dir]=x.split('.');return `${quote(key)} ${dir==='desc' ? 'desc':'asc'}`;}).join(','):''}`,values));
   const offset=Number(url.searchParams.get('offset') || req.headers['range']?.split('-')[0] || 0),limit=Number(url.searchParams.get('limit') || (req.headers.range ? Number(req.headers.range.split('-')[1])-offset+1:10000));
   res.setHeader('content-range',`${offset}-${Math.max(offset,offset+limit-1)}/${result.rows.length}`);
   const rows=result.rows.slice(offset,offset+limit);
   return reply(200,req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] || null:rows);
  }
  reply(404,{});
 }catch(e){res.writeHead(e.code==='42501' ? 403:e.code==='40001' || e.code==='23505' ? 409:400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:e.code || 'XX000',message:e.message,details:e.detail || null}));}
});
await new Promise(resolve=>provider.listen(3401,'127.0.0.1',resolve));
const appEnv={...process.env,SUPABASE_URL:'http://127.0.0.1:3401',SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SECRET_KEY:'fixture-service',CRON_SECRET:cron};
for(const key of ['TELEPHONY_PROVIDER','TELEPHONY_API_URL','TELEPHONY_API_KEY','TELEPHONY_CALLER_ID','TELEPHONY_WEBHOOK_SECRET'])appEnv[key]='fixture';
let app,output='';
async function start(configured=true){await stopProcess(app);output='';const env={...appEnv,...(configured ? {}:{TELEPHONY_API_KEY:''})};app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port','3400'],{cwd:new URL('..',import.meta.url),env,windowsHide:true,stdio:['ignore','pipe','pipe']});app.stdout.on('data',x=>output+=x);app.stderr.on('data',x=>output+=x);for(let i=0;i<80;i++){try{const r=await fetch(`${origin}/api/admin/campaigns`,{headers:{Cookie:'pose-access=fixture-admin'}});if(r.ok)return;}catch{}await delay(250);}throw Error(output);}
const call=(path='',method='GET',body,cookie='pose-access=fixture-admin',requestOrigin=origin)=>fetch(`${origin}${base}${path}`,{method,headers:{...(cookie ? {Cookie:cookie}:{}),...(method!=='GET' ? {Origin:requestOrigin,'Content-Type':'application/json'}:{})},...(body!==undefined ? {body:JSON.stringify(body)}:{})});
const tick=()=>fetch(`${origin}/api/system/campaigns/tick`,{method:'POST',headers:{Authorization:`Bearer ${cron}`}});
let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
async function item(response,status=200){check(response.status===status,`expected ${status}, got ${response.status}: ${await response.clone().text()}`);return (await response.json()).item;}
const save=async(c,data={},reason='')=>item(await call(`/${c.id}`,'PATCH',{...data,version:c.version,reason}));
const action=async(c,a,reason='')=>item(await call(`/${c.id}/action`,'POST',{version:c.version,action:a,reason}));
const audience=async(c,filter={})=>(await item(await call(`/${c.id}/audience`,'POST',{version:c.version,filter}))).campaign;
const config={name:'Chiến dịch HTTP',script_version_id:publishedId,property_ids:[productId],daily_call_limit:2,budget_limit_vnd:300,cost_reserve_per_call_vnd:100,version:0};
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
try {
 if(previewOnly){
  await db.exec(`insert into campaigns(id,name,status,script_version_id,daily_call_limit,budget_limit_vnd,cost_reserve_per_call_vnd,start_time) values
  ('f7900000-0000-4000-8000-000000000001','Tư vấn căn hộ — bản nháp','DRAFT','${publishedId}',10,1000000,10000,now()+interval '1 day'),
  ('${previewReadyId}','Tư vấn nhà phố — sẵn sàng','DRAFT','${publishedId}',10,1000000,10000,now()+interval '1 day'),
  ('f7900000-0000-4000-8000-000000000003','Chăm sóc khách hàng — tạm dừng','PAUSED','${publishedId}',10,1000000,10000,now()+interval '1 day');
  insert into campaign_customers(campaign_id,customer_id,lead_id,phone_e164) values('${previewReadyId}','${id('30')}','${id('40')}','+84901230001');`);
  previewId='f7900000-0000-4000-8000-000000000001';
  await start();console.log(`PREVIEW READY: ${origin}`);await waitPreview();
 }else{
 await start();
 check((await call('','GET',undefined,null)).status===401,'Guest denied');
 for(const role of ['sales','user'])check((await call('','GET',undefined,`pose-access=fixture-${role}`)).status===403,`${role} denied forged metadata`);
 check((await call('','POST',config,'pose-access=fixture-admin','https://other.test')).status===403,'origin enforced');
 check((await call('','POST',{...config,actor_id:adminId})).status===400,'field allowlist');
 for(const [key,value] of [['max_concurrent_calls',3],['max_call_seconds',29],['max_call_seconds',301],['max_attempts',4],['max_attempts',1.5],['retry_after_hours',23],['daily_call_limit',0],['budget_limit_vnd',0],['cost_reserve_per_call_vnd',-1],['timezone','Bad/Zone'],['weekdays',[7]],['start_time','2026-10-14T10:00']])check((await call('','POST',{...config,[key]:value})).status===400,`validation ${key}`);
 check((await call('','POST',{...config,property_ids:[id('60',2)]})).status===400,'Published only product');
 check((await call('','POST',{...config,script_version_id:id('80',2)})).status===400,'Published only script');
 let c=await item(await call('','POST',config),201);
 check(c.status==='DRAFT' && c.timezone==='Asia/Ho_Chi_Minh','create defaults');
 check((await call(`/${c.id}`)).headers.get('cache-control')==='no-store','no-store');
 check((await call(`/${c.id}`,'PATCH',{name:'Stale',version:99})).status===409,'version conflict');
 let preview=await item(await call(`/${c.id}/audience-preview`,'POST',{filter:{}}));
 check(preview.total===12 && preview.eligible===4,'preview counts');
 check(preview.deferred.DAILY_CAP===1 && preview.deferred.WEEKLY_CAP===1 && preview.skipped.LEAD_CLOSED===2,'temporary caps separated from exclusions');
 check(preview.sample.length<=20 && !JSON.stringify(preview.sample).includes('+849'),'masked sample');
 check((await call(`/${c.id}/audience-preview`,'POST',{filter:{lead_ids:Array(501).fill(id('40'))}})).status===400,'500 lead limit');
 c=await audience(c);c=await audience(c);
 await db.query("update campaign_customers set added_at=now()+right(phone_e164,4)::integer*interval '1 second' where campaign_id=$1 and phone_e164 is not null",[c.id]);
 check(await scalar('select count(*)::integer from campaign_customers where campaign_id=$1',[c.id])===12,'idempotent audience');
 let script=await item(await call('/scripts','POST',{name:'Kịch bản HTTP'}));
 const content=await scalar('select content from call_script_versions where id=$1',[publishedId]);
 for(const invalid of [{...content,ai_disclosure:''},{...content,ai_disclosure:'Tôi là chuyên viên'},{...content,opt_out:{prompt:'',confirmation:'Dừng'}},{...content,consent_prompt:{ai_voice:'Có?',recording:'',transcript:'Có?'}},{...content,needs_questions:[]}])check((await call(`/scripts/${script.id}/versions`,'POST',{content:invalid})).status===400,'required script section');
 let v=await item(await call(`/scripts/${script.id}/versions`,'POST',{content}));
 const before=v.checksum;v=await item(await call(`/versions/${v.id}/publish`,'POST',{}));check(v.status==='Published' && v.checksum===before,'publish checksum');
 check((await call(`/scripts/${script.id}/versions`,'POST',{version_id:v.id,content})).status===400,'published immutable');
 const clone=await item(await call(`/versions/${v.id}/clone`,'POST',{}));check(clone.status==='Draft' && clone.version_no===2,'clone next version');
 for(const invalid of [{...content,ai_disclosure:''},{...content,purpose:''},{...content,opt_out:{prompt:'',confirmation:'Dừng'}},{...content,consent_prompt:{ai_voice:'Có?',recording:'',transcript:'Có?'}}]){
  await db.query('update call_script_versions set content=$1 where id=$2',[JSON.stringify(invalid),clone.id]);
  check((await call(`/versions/${clone.id}/publish`,'POST',{})).status===400,'publish rejects missing required section in stored draft');
 }
 await db.query('update call_script_versions set content=$1 where id=$2',[JSON.stringify(content),clone.id]);
 const reordered=Object.fromEntries(Object.entries(content).reverse());
 const canonical=await item(await call(`/scripts/${script.id}/versions`,'POST',{version_id:clone.id,content:reordered}));check(canonical.checksum===before,'canonical JSON checksum');
 const render=await call(`/versions/${v.id}/preview`,'POST',{});check(render.ok && (await render.json()).turns.some(t=>t.text.includes('trợ lý AI')),'static conversation preview');
 check((await call('/scripts')).ok,'script/version list');
 let incomplete=await item(await call('','POST',{name:'Thiếu cấu hình',version:0}),201);
 let fail=await call(`/${incomplete.id}/action`,'POST',{version:0,action:'start'});check(fail.status===400 && (await fail.json()).missing.includes('ELIGIBLE_AUDIENCE'),'preflight failures list');
 const livePreflight=await item(await call(`/${incomplete.id}/preflight`));check(livePreflight.includes('BUDGET') && livePreflight.includes('PUBLISHED_SCRIPT'),'live preflight checklist');
 check((await call(`/${c.id}/action`,'POST',{version:c.version,action:'pause'})).status===400,'draft pause denied');
 check((await call(`/${c.id}/action`,'POST',{version:c.version,action:'schedule'})).status===400,'schedule requires future start');
 c=await action(c,'start');
 check((await call(`/${c.id}/audience`,'POST',{version:c.version,filter:{}})).status===400,'running audience locked');
 check((await call(`/${c.id}`,'PATCH',{version:c.version,max_call_seconds:60})).status===400,'running reason required');
 c=await save(c,{max_call_seconds:60},'Giới hạn thời lượng');check(c.config_version===2,'running config version');
 await db.query("insert into calls(campaign_id,phone_e164,call_type,status,script_version_id,created_at) values($1,'+84999999999','AI_AUTO_CALL','COMPLETED',$2,now()-interval '10 days')",[c.id,publishedId]);
 c=await save(c,{script_version_id:v.id},'Chọn kịch bản mới');check(await scalar('select script_version_id from calls where campaign_id=$1',[c.id])===publishedId,'call script snapshot retained');
 tickNow='2026-10-17T03:00:00Z';check((await item(await tick())).jobs_created===0,'weekday');
 tickNow='2026-10-14T01:00:00Z';check((await item(await tick())).jobs_created===0,'outside call window');
 tickNow='2026-10-14T03:00:00Z';check((await item(await tick())).jobs_created===2,'timezone and daily job cap');
 check((await item(await tick())).jobs_created===0,'repeat tick no duplicate');
 c=await save(c,{daily_call_limit:10,budget_limit_vnd:200},'Kiểm tra ngân sách');tickNow='2026-10-15T03:00:00Z';check((await item(await tick())).jobs_created===0,'pending budget cap across days');
 c=await action(c,'pause');c=await save(c,{budget_limit_vnd:1000});
 check((await item(await tick())).jobs_created===0,'paused creates no jobs');
 await db.exec("insert into contact_suppressions(phone_e164,reason,source) values('+84901230011','Mới từ chối','Customer')");
 c=await action(c,'resume');check(await scalar("select status from campaign_customers where campaign_id=$1 and phone_e164='+84901230011'",[c.id])==='OPTED_OUT','resume rechecks consent');
 check((await item(await tick())).jobs_created===1,'remaining eligible member queued');
 await db.query("update call_jobs set status='Claimed' where id=(select id from call_jobs where campaign_id=$1 order by id limit 1)",[c.id]);
 await db.query("update call_jobs set status='Dispatched',updated_at=now()-interval '20 minutes' where id=(select id from call_jobs where campaign_id=$1 and status='Pending' order by id limit 1)",[c.id]);
 await db.query("insert into calls(campaign_id,phone_e164,call_type,status,updated_at) values($1,'+84999999998','AI_AUTO_CALL','UNKNOWN',now()-interval '20 minutes')",[c.id]);
 let p=await item(await call(`/${c.id}/progress`));check(Object.values(p.memberships).reduce((a,b)=>a+b,0)===p.total,'progress sum');check(p.reconciliation.length===2,'stale dispatched/unknown reconciliation');check(p.completed===1 && p.connected===0,'completed separate from connected');
 check((await call(`/${c.id}/action`,'POST',{version:c.version,action:'cancel',reason:'x'})).status===400,'cancel reason');
 c=await action(c,'cancel','Dừng chiến dịch');check(await scalar("select count(*)::integer from call_jobs where campaign_id=$1 and status in ('Pending','Claimed')",[c.id])===0,'cancel pending and claimed');check(await scalar("select count(*)::integer from call_jobs where campaign_id=$1 and status='Dispatched'",[c.id])===1,'dispatched retained');check(await scalar("select count(*)::integer from calls where campaign_id=$1 and status='UNKNOWN'",[c.id])===1,'active call retained');
 await db.query("update call_jobs set status='Done' where campaign_id=$1",[c.id]);
 check((await call(`/${c.id}/action`,'POST',{version:c.version,action:'resume'})).status===400,'terminal resume denied');
 // Schedule rechecks the current consent, script and budget at activation.
 let scheduled=await item(await call('','POST',{...config,name:'Lịch tương lai',start_time:new Date(Date.now()+86400000).toISOString()}),201);scheduled=await audience(scheduled,{lead_ids:[id('40',10)]});scheduled=await action(scheduled,'schedule');check(scheduled.status==='SCHEDULED','scheduled transition');
 tickNow=new Date(Date.now()+2*86400000).toISOString();await item(await tick());check(await scalar('select status from campaigns where id=$1',[scheduled.id])==='RUNNING','scheduled activates');
 await db.query("update campaigns set status='SCHEDULED',budget_spent_vnd=300,start_time=now()-interval '1 hour' where id=$1",[scheduled.id]);await item(await tick());check(await scalar('select status from campaigns where id=$1',[scheduled.id])==='FAILED','scheduled preflight fails');
 await db.query("update call_jobs set status='Done' where campaign_id=$1",[scheduled.id]);
 // New opt-outs and caps after audience selection are checked by the tick.
 let live=await item(await call('','POST',{...config,name:'Kiểm tra lại',daily_call_limit:10,budget_limit_vnd:1000}),201);live=await audience(live,{lead_ids:[id('40'),id('40',10),id('40',12)]});live=await action(live,'start');
 await db.exec("insert into contact_consents(phone_e164,purpose,status,channel,source,evidence,policy_version,recorded_at) values('+84901230001','Call','Withdrawn','Sales','Fixture','Khách rút đồng ý','v2',now()+interval '1 second')");
 await db.query("insert into calls(campaign_id,phone_e164,call_type,status,created_at) values($1,'+84901230010','AI_AUTO_CALL','FAILED','2026-10-14 02:00Z')",[c.id]);
 await db.query("insert into calls(campaign_id,phone_e164,call_type,status,created_at) select $1,'+84901230012','AI_AUTO_CALL','FAILED','2026-10-14 03:00Z'::timestamptz-n*interval '1 day' from generate_series(2,4) n",[c.id]);
 tickNow='2026-10-14T03:00:00Z';await item(await tick());
 check(await scalar("select status from campaign_customers where campaign_id=$1 and phone_e164='+84901230001'",[live.id])==='OPTED_OUT','tick withdrawn consent');
 check(await scalar("select skip_reason from campaign_customers where campaign_id=$1 and phone_e164='+84901230010'",[live.id])==='DAILY_CAP','global daily cap across campaigns');
 check(await scalar("select skip_reason from campaign_customers where campaign_id=$1 and phone_e164='+84901230012'",[live.id])==='WEEKLY_CAP','global weekly cap across campaigns');
 check(await scalar('select status from campaigns where id=$1',[live.id])==='RUNNING','deferred members keep campaign open');
 check(await scalar("select count(*)::integer from campaign_customers where campaign_id=$1 and status='PENDING' and next_attempt_at is not null",[live.id])===2,'temporary caps retain pending members');
 live=await action(live,'cancel','Kết thúc kiểm tra');
 // Due retries create exactly the next attempt; future retries keep campaigns open.
 await db.exec("delete from calls where phone_e164='+84901230012'");
 let retry=await item(await call('','POST',{...config,name:'Thử lại'}),201);retry=await audience(retry,{lead_ids:[id('40',12)]});retry=await action(retry,'start');
 await db.query("update campaign_customers set status='RETRYING',retry_count=1,next_attempt_at='2026-10-15 03:00Z' where campaign_id=$1",[retry.id]);
 tickNow='2026-10-14T03:00:00Z';check((await item(await tick())).jobs_created===0,'future retry not queued');p=await item(await call(`/${retry.id}/progress`));check(p.campaign.status==='RUNNING','retry keeps open');
 tickNow='2026-10-15T03:00:00Z';check((await item(await tick())).jobs_created===1,'due retry queued');check(await scalar('select attempt_no from call_jobs where campaign_id=$1',[retry.id])===2,'next attempt number');check((await item(await tick())).jobs_created===0,'retry tick duplicate prevented');
 await db.query("update campaign_customers set status='COMPLETED' where campaign_id=$1",[retry.id]);p=await item(await call(`/${retry.id}/progress`));check(p.campaign.status==='RUNNING','pending job keeps open');
 await db.query("update call_jobs set status='Done' where campaign_id=$1",[retry.id]);await db.query("insert into calls(campaign_id,phone_e164,call_type,status,error_code) values($1,'+84901230012','AI_AUTO_CALL','FAILED','PROCESSING_ERROR')",[retry.id]);p=await item(await call(`/${retry.id}/progress`));check(p.campaign.status==='COMPLETED' && p.completed===0 && p.errors.length===1,'error not success and final completes');
 check((await fetch(`${origin}/api/system/campaigns/tick`,{method:'POST'})).status===401,'cron requires token');check((await fetch(`${origin}/api/system/campaigns/tick`,{method:'POST',headers:{Authorization:'Bearer wrong'}})).status===401,'cron rejects wrong token');
 offline=true;check((await call()).status===503,'provider outage fails closed');offline=false;
 await start(false);
 let noProvider=await item(await call('','POST',{...config,name:'Thiếu nhà cung cấp'}),201);noProvider=await audience(noProvider,{lead_ids:[id('40',10)]});
 const pf=await call(`/${noProvider.id}/action`,'POST',{version:noProvider.version,action:'start'});check(pf.status===400 && (await pf.json()).missing.includes('TELEPHONY_NOT_CONFIGURED'),'missing provider passed to SQL');check((await tick()).status===503,'tick missing provider');
 const page=await call('', 'GET');check(page.ok,'admin list');
 await start();
 await db.exec("update customers set phone_verified_at=now() where id='f7300000-0000-4000-8000-000000000002'");
 const transitions={DRAFT:{schedule:'SCHEDULED',start:'RUNNING',cancel:'CANCELLED'},SCHEDULED:{start:'RUNNING',cancel:'CANCELLED'},RUNNING:{pause:'PAUSED',cancel:'CANCELLED'},PAUSED:{resume:'RUNNING',cancel:'CANCELLED'},COMPLETED:{},CANCELLED:{},FAILED:{},STOPPED:{}};
 for(const [state,allowed] of Object.entries(transitions))for(const a of ['schedule','start','pause','resume','cancel']){
  const matrix=await item(await call('','POST',{...config,name:`Transition ${state} ${a}`,start_time:new Date(Date.now()+86400000).toISOString()}),201);
  await db.query('update campaigns set status=$1 where id=$2',[state,matrix.id]);
  await db.query("insert into campaign_customers(campaign_id,customer_id,lead_id,phone_e164) values($1,$2,$3,'+84901230002')",[matrix.id,id('30',2),id('40',2)]);
  const r=await call(`/${matrix.id}/action`,'POST',{version:0,action:a,reason:'Kiểm tra chuyển trạng thái'});
  check(r.status===(allowed[a] ? 200:400),`${state} ${a} allowed/denied`);
  if(allowed[a])check((await r.json()).item.status===allowed[a],`${state} ${a} target`);
 }
 // Isolate temporal scheduler checks from the lifecycle matrix above.
 await db.exec("update campaigns set status='CANCELLED' where status in ('RUNNING','PAUSED','SCHEDULED');update call_jobs set status='Cancelled' where status in ('Pending','Claimed','Dispatched');delete from calls where phone_e164='+84901230002'");
 const t=Date.parse(await scalar("select date_trunc('second',now())")),at=offset=>new Date(t+offset).toISOString(),hour=3600000,day=24*hour;
 const deferralConfig={...config,weekdays:[0,1,2,3,4,5,6],window_start:'00:00',window_end:'23:59',daily_call_limit:10,budget_limit_vnd:1000};
 const makeDeferred=async name=>{let m=await item(await call('','POST',{...deferralConfig,name}),201);m=await audience(m,{lead_ids:[id('40',2)]});return m;};
 const timedTick=async offset=>{tickNow=at(offset);return item(await tick());};
 await db.query("insert into calls(campaign_id,phone_e164,call_type,status,created_at) values($1,'+84901230002','AI_AUTO_CALL','COMPLETED',$2)",[c.id,at(-23*hour)]);
 let delayed=await makeDeferred('Trần 24 giờ');
 let member=(await db.query('select * from campaign_customers where campaign_id=$1',[delayed.id])).rows[0];
 check(member.status==='PENDING' && member.skip_reason==='DAILY_CAP' && Date.parse(member.next_attempt_at)===t+hour,'audience retains exact daily deferral');
 delayed=await action(delayed,'start');delayed=await action(delayed,'pause');delayed=await action(delayed,'resume');
 check(await scalar('select status from campaign_customers where campaign_id=$1',[delayed.id])==='PENDING','resume retains temporary blocked audience');
 check((await timedTick(0)).jobs_created===0,'PENDING future deadline not selected');
 check((await timedTick(hour)).jobs_created===1,'job after daily cap expiry using explicit clock');
 delayed=await action(delayed,'cancel','Kiểm thử xong');await db.exec("delete from calls where phone_e164='+84901230002'");
 await db.query("insert into calls(campaign_id,phone_e164,call_type,status,created_at) select $1,'+84901230002','AI_AUTO_CALL','FAILED',$2::timestamptz-n*interval '1 day' from generate_series(2,4) n",[c.id,at(0)]);
 delayed=await makeDeferred('Trần 7 ngày');member=(await db.query('select * from campaign_customers where campaign_id=$1',[delayed.id])).rows[0];
 check(member.status==='PENDING' && member.skip_reason==='WEEKLY_CAP' && Date.parse(member.next_attempt_at)===t+3*day,'weekly deadline oldest of three counted calls');
 delayed=await action(delayed,'start');check((await timedTick(2*day)).jobs_created===0,'weekly cap retains membership');check((await timedTick(3*day)).jobs_created===1,'weekly expiry queues job');
 delayed=await action(delayed,'cancel','Kiểm thử xong');await db.exec("delete from calls where phone_e164='+84901230002'");
 await db.query("insert into calls(phone_e164,call_type,status,created_at) values('+84901230002','MOCK_CALL','ANSWERED',$1)",[at(0)]);
 delayed=await makeDeferred('Cuộc gọi thử đang kết nối');delayed=await action(delayed,'start');
 member=(await db.query('select * from campaign_customers where campaign_id=$1',[delayed.id])).rows[0];check(member.status==='PENDING' && member.skip_reason==='ACTIVE_CALL','active mock defers audience');
 check((await timedTick(hour/2)).jobs_created===0,'active MOCK_CALL prevents job');
 check(Date.parse(await scalar('select next_attempt_at from campaign_customers where campaign_id=$1',[delayed.id]))===t+hour*.75,'ACTIVE_CALL defers fifteen minutes from tick');
 await db.exec("update calls set status='COMPLETED' where phone_e164='+84901230002'");check((await timedTick(hour*.75)).jobs_created===1,'completed MOCK_CALL excluded from caps');
 delayed=await action(delayed,'cancel','Kiểm thử xong');
 let sharedA=await makeDeferred('Cùng số — chiến dịch một'),sharedB=await makeDeferred('Cùng số — chiến dịch hai');sharedA=await action(sharedA,'start');sharedB=await action(sharedB,'start');
 check((await timedTick(0)).jobs_created===1,'two campaigns one phone exactly one job');
 check(await scalar("select count(*)::integer from campaign_customers where campaign_id=any($1) and status='PENDING' and skip_reason='ACTIVE_CALL'",[[sharedA.id,sharedB.id]])===1,'cross-campaign queue collision deferred');
 check((await timedTick(0)).jobs_created===0,'repeat collision tick creates no duplicate');
 await db.query("update call_jobs set status='Done' where campaign_id=any($1)",[[sharedA.id,sharedB.id]]);check((await timedTick(hour/4)).jobs_created===1,'deferred shared phone queues after release');
 console.log(`PASS: ${checks} M07 HTTP checks; fake Supabase gateway with real PostgreSQL rules.`);
 if(process.argv.includes('--preview')){previewId=noProvider.id;console.log(`PREVIEW READY: ${origin}; cookie pose-access=fixture-admin; campaign ${noProvider.id}`);await waitPreview();}
 }
}finally{try{await stopProcess(app);}finally{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await chain;await db.close();}}
