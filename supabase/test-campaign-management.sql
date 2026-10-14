-- Run via frontend/scripts/test-campaign-management-sql.mjs with PGLITE_PATH,
-- or in psql after the module migration. All fixtures are rolled back.
begin;
-- Fixtures begin (also used by the isolated HTTP test gateway).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,created_at,updated_at)
select ('f7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','m07-'||n||'@example.test',now(),jsonb_build_object('role',case n when 1 then 'Admin' when 2 then 'Sales' else 'User' end),now(),now() from generate_series(1,3) n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select ('f7200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now() from generate_series(1,3) n;
insert into public.customers(id,full_name,phone,phone_verified_at)
select ('f7300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Khách hàng '||n,'+8490123'||lpad(n::text,4,'0'),case when n<>2 then now() end from generate_series(1,12) n;
insert into public.leads(id,customer_id,status,temperature,source,archived)
select ('f7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f7300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=6 then 'LOST'::public.lead_status else 'NEW'::public.lead_status end,'HOT','Manual',n=7 from generate_series(1,12) n;
insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version)
select c.phone,c.id,l.id,p,'Granted','Sales','Fixture','Đã xác minh lựa chọn','v1' from public.customers c join public.leads l on l.customer_id=c.id cross join unnest(array['Call','AIVoice']) p where not (right(c.phone,4)='0003' and p='Call' or right(c.phone,4)='0004' and p='AIVoice');
insert into public.contact_suppressions(phone_e164,reason,source) values('+84901230005','Khách từ chối liên hệ','Customer');
insert into public.calls(phone_e164,call_type,status,created_at) values
('+84901230008','AI_AUTO_CALL','COMPLETED',now()-interval '1 hour'),
('+84901230009','AI_AUTO_CALL','FAILED',now()-interval '2 days'),
('+84901230009','SALES_CALL','COMPLETED',now()-interval '3 days'),
('+84901230009','AI_AUTO_CALL','COMPLETED',now()-interval '4 days');
insert into public.property_projects(id,code,name,location) values('f7500000-0000-4000-8000-000000000001','M07-P','Dự án thử nghiệm','Hồ Chí Minh');
insert into public.property_products(id,project_id,code,name,location,description,property_type,area,publication)
select ('f7600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f7500000-0000-4000-8000-000000000001','M07-'||n,'Căn hộ '||n,'Hồ Chí Minh','Mô tả sản phẩm đã công bố đầy đủ','Apartment',80,case when n=1 then 'Published' else 'Draft' end from generate_series(1,2) n;
insert into public.call_scripts(id,name,created_by) values('f7700000-0000-4000-8000-000000000001','Kịch bản thử nghiệm','f7100000-0000-4000-8000-000000000001');
insert into public.call_script_versions(id,script_id,version_no,status,content,checksum,created_by,published_at)
select ('f7800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f7700000-0000-4000-8000-000000000001',n,case when n=1 then 'Published' else 'Draft' end,
'{"greeting":"Xin chào","ai_disclosure":"Tôi là trợ lý AI của TERAVA","purpose":"Tư vấn bất động sản","consent_prompt":{"ai_voice":"Đồng ý thoại AI?","recording":"Đồng ý ghi âm?","transcript":"Đồng ý chép lời?"},"needs_questions":["Nhu cầu của anh/chị?"],"product_source":{"property_ids":[]},"objections":[],"opt_out":{"prompt":"Anh/chị có thể yêu cầu dừng","confirmation":"Xác nhận dừng"},"closing":"Cảm ơn"}'::jsonb,repeat('a',64),'f7100000-0000-4000-8000-000000000001',case when n=1 then now() end from generate_series(1,2) n;
-- Fixtures end.
create temp table checks(n integer not null default 0);
insert into checks default values;
grant all on checks to authenticated,service_role;
create function pg_temp.check(p_ok boolean,p_label text) returns void language plpgsql as $$begin if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if;update checks set n=n+1;end $$;
create function pg_temp.reject(p_sql text,p_code text) returns void language plpgsql as $$declare rejected boolean:=false;begin begin execute p_sql;exception when others then if sqlstate<>p_code then raise;end if;rejected:=true;end;perform pg_temp.check(rejected,'expected rejection '||p_sql);end $$;
create temp table ids(kind text primary key,id uuid);
grant all on ids to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare c jsonb;v jsonb;s jsonb;preview jsonb;content jsonb;cid uuid;ver integer;missing text;begin
 c:=public.pose_save_campaign(null,0,'{"name":"Chiến dịch đầy đủ","daily_call_limit":2,"budget_limit_vnd":300,"cost_reserve_per_call_vnd":100,"script_version_id":"f7800000-0000-4000-8000-000000000001","property_ids":["f7600000-0000-4000-8000-000000000001"]}','');cid:=(c->>'id')::uuid;insert into ids values('campaign',cid);
 perform pg_temp.check(c->>'status'='DRAFT' and c->>'timezone'='Asia/Ho_Chi_Minh','draft defaults');
 perform pg_temp.check((select count(*)=1 from public.campaign_config_versions where campaign_id=cid),'config snapshot');
 perform pg_temp.reject(format('select public.pose_save_campaign(%L,99,''{"name":"Stale"}'','''')',cid),'40001');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","actor_id":"spoof"}'','''')','22023');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","max_concurrent_calls":3}'','''')','23514');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","max_attempts":4}'','''')','23514');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","retry_after_hours":23}'','''')','23514');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","max_call_seconds":29}'','''')','23514');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","max_attempts":1.5}'','''')','22023');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","daily_call_limit":0}'','''')','23514');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","budget_limit_vnd":0}'','''')','23514');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","timezone":"Invalid/Zone"}'','''')','22023');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","weekdays":[7]}'','''')','22023');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","window_start":"17:00","window_end":"09:00"}'','''')','23514');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","property_ids":["f7600000-0000-4000-8000-000000000002"]}'','''')','22023');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Invalid","script_version_id":"f7800000-0000-4000-8000-000000000002"}'','''')','22023');
 preview:=public.pose_preview_campaign_audience(cid,'{}');
 perform pg_temp.check((preview->>'total')::integer=12 and (preview->>'eligible')::integer=4,'audience totals');
 perform pg_temp.check(preview->'skipped'='{"PHONE_UNVERIFIED":1,"NO_CALL_CONSENT":1,"NO_AI_VOICE_CONSENT":1,"SUPPRESSED":1,"LEAD_CLOSED":2}'::jsonb,'exclusion reasons');
 perform pg_temp.check(preview->'deferred'='{"DAILY_CAP":1,"WEEKLY_CAP":1}'::jsonb,'temporary reasons separated');
 perform pg_temp.check((preview->'sample')::text not like '%+849%' and jsonb_array_length(preview->'sample')<=20,'masked sample');
 perform pg_temp.check((public.pose_preview_campaign_audience(cid,'{"temperature":["HOT"],"lead_status":["NEW"],"source":["Manual"]}')->>'total')::integer=11,'audience filter');
 perform pg_temp.reject(format('select public.pose_preview_campaign_audience(%L,''{"lead_ids":["bad"]}'')',cid),'22P02');
 perform public.pose_set_campaign_audience(cid,0,'{}','');
 perform public.pose_set_campaign_audience(cid,1,'{}','');
 perform pg_temp.check((select count(*)=12 from public.campaign_customers where campaign_id=cid),'audience idempotent');
 perform pg_temp.check((select count(*)=3 from public.campaign_customers where campaign_id=cid and status='SKIPPED'),'permanent exclusions');
 perform pg_temp.check((select count(*)=3 from public.campaign_customers where campaign_id=cid and status='OPTED_OUT'),'opt-outs');
 perform pg_temp.check((select count(*)=2 from public.campaign_customers where campaign_id=cid and status='PENDING' and next_attempt_at is not null),'temporary audience retained');
 perform pg_temp.check((select bool_and(lead_id is not null and snapshot ? 'lead' and snapshot ? 'customer') from public.campaign_customers where campaign_id=cid),'audience snapshots');
 s:=public.pose_save_call_script(null,'Kịch bản mới');
 select sv.content into content from public.call_script_versions sv where id='f7800000-0000-4000-8000-000000000001';
 v:=public.pose_save_script_version((s->>'id')::uuid,null,content);
 perform pg_temp.check(v->>'status'='Draft' and length(v->>'checksum')=64,'script draft checksum');
 perform pg_temp.reject(format('select public.pose_save_script_version(%L,null,%L)',s->>'id',(content-'ai_disclosure')::text),'22023');
 perform pg_temp.reject(format('select public.pose_save_script_version(%L,null,%L)',s->>'id',jsonb_set(content,'{opt_out,prompt}','""')::text),'22023');
 perform pg_temp.reject(format('select public.pose_save_script_version(%L,null,%L)',s->>'id',(content-'consent_prompt')::text),'22023');
 v:=public.pose_publish_script_version((v->>'id')::uuid);
 perform pg_temp.check(v->>'status'='Published','publish');
 perform pg_temp.reject(format('select public.pose_save_script_version(%L,%L,%L)',s->>'id',v->>'id',content::text),'22023');
 v:=public.pose_new_script_version_from((v->>'id')::uuid);
 perform pg_temp.check(v->>'status'='Draft' and (v->>'version_no')::integer=2,'clone');
 insert into ids values('script-draft',(v->>'id')::uuid);
 perform pg_temp.reject(format('select public.pose_campaign_action(%L,2,''pause'','''',true)',cid),'22023');
 begin perform public.pose_campaign_action(cid,2,'start','',false);raise exception 'provider bypass';exception when invalid_parameter_value then get stacked diagnostics missing=pg_exception_detail;perform pg_temp.check(missing like '%TELEPHONY_NOT_CONFIGURED%','provider preflight');end;
 c:=public.pose_save_campaign(null,0,'{"name":"Thiếu cấu hình"}','');
 begin perform public.pose_campaign_action((c->>'id')::uuid,0,'start','',false);raise exception 'preflight bypass';exception when invalid_parameter_value then get stacked diagnostics missing=pg_exception_detail;perform pg_temp.check(missing::jsonb @> '["PUBLISHED_SCRIPT","ELIGIBLE_AUDIENCE","BUDGET","DAILY_LIMIT","TELEPHONY_NOT_CONFIGURED"]','preflight missing list');end;
 c:=public.pose_campaign_action(cid,2,'start','',true);
 perform pg_temp.check(c->>'status'='RUNNING','start');
 perform pg_temp.reject(format('select public.pose_set_campaign_audience(%L,3,''{}'','''')',cid),'22023');
 perform pg_temp.reject(format('select public.pose_save_campaign(%L,3,''{"max_call_seconds":60}'','''')',cid),'22023');
 c:=public.pose_save_campaign(cid,3,'{"max_call_seconds":60}','Điều chỉnh thời lượng');
 perform pg_temp.check((c->>'config_version')::integer=2 and (select count(*)=2 from public.campaign_config_versions where campaign_id=cid),'running config version');
 c:=public.pose_campaign_action(cid,4,'pause','',true);
 perform pg_temp.check(c->>'status'='PAUSED','pause');
 c:=public.pose_campaign_action(cid,5,'resume','',true);
 perform pg_temp.check(c->>'status'='RUNNING','resume');
end $$;
reset role;
do $$declare cid uuid:=(select id from ids where kind='campaign');r text;begin
 for r in select unnest(array['ai_disclosure','purpose','consent_prompt','opt_out']) loop
  update public.call_script_versions set content=content-r where id=(select id from ids where kind='script-draft');
  perform pg_temp.reject(format('select public.pose_publish_script_version(%L)',(select id from ids where kind='script-draft')),'22023');
  update public.call_script_versions set content=(select sv.content from public.call_script_versions sv where sv.id='f7800000-0000-4000-8000-000000000001') where id=(select id from ids where kind='script-draft');
 end loop;
 perform pg_temp.check(pose_private.contact_eligibility('f7400000-0000-4000-8000-000000000001',cid)->>'eligible'='true','eligible running');
 insert into public.calls(phone_e164,call_type,status) values('+84901230001','MOCK_CALL','COMPLETED');
 perform pg_temp.check(pose_private.contact_eligibility('f7400000-0000-4000-8000-000000000001',null)->>'eligible'='true','mock excluded from caps');
 insert into public.calls(phone_e164,call_type,status) values('+84901230001','AI_AUTO_CALL','UNKNOWN');
 perform pg_temp.check(pose_private.contact_eligibility('f7400000-0000-4000-8000-000000000001',null)->>'reason'='ACTIVE_CALL','unknown blocks phone');
 delete from public.calls where phone_e164='+84901230001';
 update public.campaigns set weekdays='{1,2,3,4,5}',window_start='09:00',window_end='17:00' where id=cid;
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare cid uuid:=(select id from ids where kind='campaign');begin
 perform pg_temp.check(public.pose_system_campaign_tick('2026-10-17 03:00Z')->>'jobs_created'='0','weekend excluded');
 perform pg_temp.check(public.pose_system_campaign_tick('2026-10-14 01:00Z')->>'jobs_created'='0','window excluded');
 perform pg_temp.check(public.pose_system_campaign_tick('2026-10-14 03:00Z')->>'jobs_created'='2','timezone window and daily cap');
 perform pg_temp.check(public.pose_system_campaign_tick('2026-10-14 03:00Z')->>'jobs_created'='0','repeated tick');
 perform pg_temp.check((select count(*)=2 from public.call_jobs where campaign_id=cid),'unique jobs');
end $$;
reset role;
do $$declare cid uuid:=(select id from ids where kind='campaign');begin
 update public.campaigns set daily_call_limit=10,budget_limit_vnd=200 where id=cid;
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.check(public.pose_system_campaign_tick('2026-10-15 03:00Z')->>'jobs_created'='0','pending job budget accounted across days');
reset role;
do $$declare cid uuid:=(select id from ids where kind='campaign');begin
 update public.campaigns set budget_limit_vnd=1000,status='PAUSED' where id=cid;
 insert into public.contact_suppressions(phone_e164,reason,source) values('+84901230011','Mới từ chối liên hệ','Customer');
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.check(public.pose_system_campaign_tick('2026-10-14 03:00Z')->>'jobs_created'='0','pause no jobs');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare cid uuid:=(select id from ids where kind='campaign');c jsonb;p jsonb;begin
 c:=public.pose_campaign_action(cid,(select version from public.campaigns where id=cid),'resume','',true);
 perform pg_temp.check((select status='OPTED_OUT' from public.campaign_customers where campaign_id=cid and phone_e164='+84901230011'),'resume consent recheck');
 p:=public.pose_campaign_progress(cid);
 perform pg_temp.check((select sum(value::integer) from jsonb_each_text(p->'memberships'))=(p->>'total')::integer,'progress sum');
 perform pg_temp.reject(format('select public.pose_campaign_action(%L,%s,''cancel'',''x'',true)',cid,c->>'version'),'22023');
 c:=public.pose_campaign_action(cid,(c->>'version')::integer,'cancel','Kết thúc thử nghiệm',true);
 perform pg_temp.check(c->>'status'='CANCELLED' and not exists(select 1 from public.call_jobs where campaign_id=cid and status in ('Pending','Claimed')),'cancel pending jobs');
 perform pg_temp.check(not exists(select 1 from public.campaign_customers where campaign_id=cid and status in ('PENDING','QUEUED','IN_PROGRESS','RETRYING')),'cancel memberships');
 perform pg_temp.reject(format('select public.pose_campaign_action(%L,%s,''start'','''',true)',cid,c->>'version'),'22023');
end $$;
reset role;
do $$declare cid uuid:=(select id from ids where kind='campaign');p jsonb;begin
 update public.campaigns set status='RUNNING' where id=cid;
 update public.campaign_customers set status='RETRYING',next_attempt_at=now()+interval '1 day' where campaign_id=cid and phone_e164='+84901230012';
 perform pose_private.campaign_complete(cid);perform pg_temp.check((select status='RUNNING' from public.campaigns where id=cid),'retry keeps open');
 update public.campaign_customers set status='COMPLETED' where campaign_id=cid and status='RETRYING';
 update public.call_jobs set status='Dispatched',updated_at=now()-interval '20 minutes' where id=(select id from public.call_jobs where campaign_id=cid limit 1);
 perform pose_private.campaign_complete(cid);perform pg_temp.check((select status='RUNNING' from public.campaigns where id=cid),'dispatched keeps open');
 insert into public.calls(campaign_id,phone_e164,call_type,status,updated_at) values(cid,'+84901230012','AI_AUTO_CALL','UNKNOWN',now()-interval '20 minutes');
 update public.call_jobs set status='Done' where campaign_id=cid;
 perform pose_private.campaign_complete(cid);perform pg_temp.check((select status='RUNNING' from public.campaigns where id=cid),'unknown keeps open');
 update public.calls set status='FAILED',error_code='PROCESSING_ERROR' where campaign_id=cid;
 perform pose_private.campaign_complete(cid);perform pg_temp.check((select status='COMPLETED' from public.campaigns where id=cid),'terminal completes');
 perform pg_temp.reject(format('update public.campaign_config_versions set reason=''rewrite'' where campaign_id=%L',cid),'22023');
 perform pg_temp.reject(format('insert into public.campaign_customers(campaign_id,customer_id) values(%L,''f7300000-0000-4000-8000-000000000001'')',cid),'23505');
 perform pg_temp.reject(format('insert into public.call_jobs(campaign_id,membership_id,attempt_no,scheduled_at,idempotency_key) select campaign_id,membership_id,attempt_no,scheduled_at,''duplicate'' from public.call_jobs where campaign_id=%L limit 1',cid),'23505');
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare p jsonb;begin p:=public.pose_campaign_progress((select id from ids where kind='campaign'));perform pg_temp.check(p->>'completed'='0' and jsonb_array_length(p->'errors')=1,'processing error not success');end $$;
reset role;
do $$declare cid uuid; c jsonb; s text; a text; target text; data jsonb; tick_at timestamptz:='2040-10-03 03:00Z';begin
 for s in select unnest(array['DRAFT','SCHEDULED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED','STOPPED']) loop
  foreach a in array array['schedule','start','pause','resume','cancel'] loop
   c:=public.pose_save_campaign(null,0,jsonb_build_object('name','Matrix '||s||' '||a,'script_version_id','f7800000-0000-4000-8000-000000000001','daily_call_limit',2,'budget_limit_vnd',300,'cost_reserve_per_call_vnd',100,'start_time',now()+interval '1 day'),'');cid:=(c->>'id')::uuid;
   update public.campaigns set status=s::public.campaign_status where id=cid;
   insert into public.campaign_customers(campaign_id,customer_id,lead_id,phone_e164) values(cid,'f7300000-0000-4000-8000-000000000010','f7400000-0000-4000-8000-000000000010','+84901230010');
   target:=case when a='schedule' and s='DRAFT' then 'SCHEDULED' when a='start' and s in ('DRAFT','SCHEDULED') then 'RUNNING' when a='pause' and s='RUNNING' then 'PAUSED' when a='resume' and s='PAUSED' then 'RUNNING' when a='cancel' and s in ('DRAFT','SCHEDULED','RUNNING','PAUSED') then 'CANCELLED' end;
   if target is null then perform pg_temp.reject(format('select public.pose_campaign_action(%L,0,%L,''Lý do thử'',true)',cid,a),'22023');
   else c:=public.pose_campaign_action(cid,0,a,'Lý do thử',true);perform pg_temp.check(c->>'status'=target,'matrix '||s||' '||a);end if;
   update public.campaigns set status='CANCELLED' where id=cid;
  end loop;
 end loop;
 c:=public.pose_save_campaign(null,0,jsonb_build_object('name','Scheduled activation','script_version_id','f7800000-0000-4000-8000-000000000001','daily_call_limit',2,'budget_limit_vnd',300,'cost_reserve_per_call_vnd',100,'start_time',now()+interval '1 day'),'');cid:=(c->>'id')::uuid;
 insert into public.campaign_customers(campaign_id,customer_id,lead_id,phone_e164) values(cid,'f7300000-0000-4000-8000-000000000010','f7400000-0000-4000-8000-000000000010','+84901230010');
 perform public.pose_campaign_action(cid,0,'schedule','',true);
 insert into ids values('scheduled',cid);
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.pose_system_campaign_tick('2040-10-03 03:00Z');
reset role;
do $$declare cid uuid:=(select id from ids where kind='scheduled');begin
 perform pg_temp.check((select status='RUNNING' from public.campaigns where id=cid),'schedule activates');
 update public.campaigns set status='SCHEDULED',budget_spent_vnd=300 where id=cid;
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.pose_system_campaign_tick('2040-10-03 03:00Z');
reset role;
do $$declare cid uuid:=(select id from ids where kind='scheduled');begin
 perform pg_temp.check((select status='FAILED' and status_reason like '%BUDGET%' from public.campaigns where id=cid),'scheduled preflight fails');
 update public.campaigns set status='RUNNING',budget_spent_vnd=0,budget_limit_vnd=1000,weekdays='{0,1,2,3,4,5,6}',window_start='00:00',window_end='23:59' where id=cid;
 update public.call_jobs set status='Done' where campaign_id=cid;
 update public.campaign_customers set status='RETRYING',retry_count=1,next_attempt_at='2040-10-04 03:00Z' where campaign_id=cid;
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.check(public.pose_system_campaign_tick('2040-10-03 03:00Z')->>'jobs_created'='0','future retry not queued');
select pg_temp.check(public.pose_system_campaign_tick('2040-10-04 03:00Z')->>'jobs_created'='1','due retry queued');
select pg_temp.check(public.pose_system_campaign_tick('2040-10-04 03:00Z')->>'jobs_created'='0','retry unique');
reset role;
do $$declare cid uuid:=(select id from ids where kind='scheduled');begin
 perform pg_temp.check((select count(*)=1 from public.call_jobs where campaign_id=cid and attempt_no=2),'retry attempt number');
 update public.call_jobs set status='Claimed' where campaign_id=cid and attempt_no=2;
 insert into public.calls(campaign_id,phone_e164,call_type,status,updated_at) values(cid,'+84901230010','AI_AUTO_CALL','CALLING',now()-interval '20 minutes');
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare cid uuid:=(select id from ids where kind='scheduled');c jsonb;p jsonb;begin
 p:=public.pose_campaign_progress(cid);perform pg_temp.check(jsonb_array_length(p->'reconciliation')=1,'stale calling reconciliation');
 c:=public.pose_campaign_action(cid,(select version from public.campaigns where id=cid),'cancel','Kiểm tra hủy',true);
 perform pg_temp.check(not exists(select 1 from public.call_jobs where campaign_id=cid and status='Claimed'),'claimed cancelled');
 perform pg_temp.check(exists(select 1 from public.calls where campaign_id=cid and status='CALLING'),'cancel keeps active calls');
end $$;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000002","session_id":"f7200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
 perform pg_temp.check((select count(*)=0 from public.campaigns),'sales campaigns RLS');perform pg_temp.check((select count(*)=0 from public.campaign_customers),'sales membership RLS');perform pg_temp.check((select count(*)=0 from public.call_jobs),'sales jobs RLS');
 perform pg_temp.reject('select public.pose_save_campaign(null,0,''{"name":"Forbidden"}'','''')','42501');perform pg_temp.reject('select public.pose_system_campaign_tick(now())','42501');perform pg_temp.reject('select pose_private.contact_eligibility(null,null)','42501');
end $$;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000003","session_id":"f7200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$begin
 perform pg_temp.check((select count(*)=0 from public.campaigns),'user campaigns RLS');perform pg_temp.check((select count(*)=0 from public.campaign_customers),'user membership RLS');perform pg_temp.check((select count(*)=0 from public.call_jobs),'user jobs RLS');
 perform pg_temp.reject('select public.pose_save_call_script(null,''Forbidden'')','42501');
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
savepoint temporary_contact_tests;
do $$declare t timestamptz:=now();c jsonb;cid uuid;second uuid;cfg jsonb:='{"name":"Tạm hoãn","script_version_id":"f7800000-0000-4000-8000-000000000001","daily_call_limit":10,"budget_limit_vnd":1000,"cost_reserve_per_call_vnd":100,"weekdays":[0,1,2,3,4,5,6],"window_start":"00:00","window_end":"23:59"}';e jsonb;begin
 delete from public.calls where phone_e164 in ('+84901230001','+84901230010','+84901230012');
 insert into public.calls(campaign_id,phone_e164,call_type,status,created_at) values((select id from ids where kind='campaign'),'+84901230001','AI_AUTO_CALL','COMPLETED',t-interval '23 hours');
 c:=public.pose_save_campaign(null,0,cfg,'');cid:=(c->>'id')::uuid;
 perform public.pose_set_campaign_audience(cid,0,'{"lead_ids":["f7400000-0000-4000-8000-000000000001"]}','');
 perform pg_temp.check((select status='PENDING' and skip_reason='DAILY_CAP' and next_attempt_at=t+interval '1 hour' from public.campaign_customers where campaign_id=cid),'23-hour call deferred exactly');
 perform pg_temp.check(public.pose_campaign_preflight(cid,true)='[]'::jsonb,'temporary audience passes preflight');
 perform public.pose_campaign_action(cid,1,'start','',true);
 perform public.pose_campaign_action(cid,2,'pause','',true);
 perform public.pose_campaign_action(cid,3,'resume','',true);
 perform pg_temp.check((select status='PENDING' and next_attempt_at=t+interval '1 hour' from public.campaign_customers where campaign_id=cid),'resume retains deferred membership');
 update public.campaign_customers set status='RETRYING',retry_count=1 where campaign_id=cid;
 perform pose_private.campaign_recheck(cid);
 perform pg_temp.check((select status='RETRYING' and retry_count=1 and next_attempt_at=t+interval '1 hour' from public.campaign_customers where campaign_id=cid),'temporary block preserves retry state and attempt count');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.check(public.pose_system_campaign_tick(t)->>'jobs_created'='0','pending future timestamp respected');
 perform pg_temp.check(pose_private.contact_eligibility('f7400000-0000-4000-8000-000000000001',cid,t+interval '1 hour')->>'eligible'='true','explicit eligibility clock');
 perform pg_temp.check(public.pose_system_campaign_tick(t+interval '1 hour')->>'jobs_created'='1','daily cap expiry creates job');
 perform pg_temp.check((select attempt_no=2 from public.call_jobs where campaign_id=cid),'deferred retry queues its next attempt');
 perform set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform public.pose_campaign_action(cid,(select version from public.campaigns where id=cid),'cancel','Kiểm thử xong',true);
 insert into public.calls(phone_e164,call_type,status,created_at) select '+84901230010','AI_AUTO_CALL','FAILED',t-n*interval '1 day' from generate_series(2,4) n;
 c:=public.pose_save_campaign(null,0,cfg,'');cid:=(c->>'id')::uuid;
 perform public.pose_set_campaign_audience(cid,0,'{"lead_ids":["f7400000-0000-4000-8000-000000000010"]}','');
 perform pg_temp.check((select status='PENDING' and skip_reason='WEEKLY_CAP' and next_attempt_at=t+interval '3 days' from public.campaign_customers where campaign_id=cid),'weekly deferral oldest counted call');
 perform public.pose_campaign_action(cid,1,'start','',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.check(public.pose_system_campaign_tick(t+interval '2 days')->>'jobs_created'='0','weekly cap holds');
 perform pg_temp.check(public.pose_system_campaign_tick(t+interval '3 days')->>'jobs_created'='1','weekly window frees');
 perform set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform public.pose_campaign_action(cid,(select version from public.campaigns where id=cid),'cancel','Kiểm thử xong',true);
 insert into public.calls(phone_e164,call_type,status,created_at) values('+84901230012','MOCK_CALL','ANSWERED',t);
 perform pg_temp.check(pose_private.contact_eligibility('f7400000-0000-4000-8000-000000000012',null)->>'reason'='ACTIVE_CALL','active mock blocks phone with two-argument helper');
 c:=public.pose_save_campaign(null,0,cfg,'');cid:=(c->>'id')::uuid;
 perform public.pose_set_campaign_audience(cid,0,'{"lead_ids":["f7400000-0000-4000-8000-000000000012"]}','');
 perform public.pose_campaign_action(cid,1,'start','',true);
 perform pg_temp.check((select status='PENDING' and next_attempt_at=t+interval '15 minutes' from public.campaign_customers where campaign_id=cid),'active mock deferred');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.check(public.pose_system_campaign_tick(t+interval '15 minutes')->>'jobs_created'='0','active mock prevents dispatch');
 perform pg_temp.check((select status='PENDING' and next_attempt_at=t+interval '30 minutes' from public.campaign_customers where campaign_id=cid),'active call deferral advances');
 update public.calls set status='COMPLETED' where phone_e164='+84901230012';
 perform pg_temp.check(public.pose_system_campaign_tick(t+interval '30 minutes')->>'jobs_created'='1','completed mock excluded from caps');
 perform set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform public.pose_campaign_action(cid,(select version from public.campaigns where id=cid),'cancel','Kiểm thử xong',true);
 c:=public.pose_save_campaign(null,0,cfg,'');cid:=(c->>'id')::uuid;
 perform public.pose_set_campaign_audience(cid,0,'{"lead_ids":["f7400000-0000-4000-8000-000000000012"]}','');perform public.pose_campaign_action(cid,1,'start','',true);
 c:=public.pose_save_campaign(null,0,cfg,'');second:=(c->>'id')::uuid;
 perform public.pose_set_campaign_audience(second,0,'{"lead_ids":["f7400000-0000-4000-8000-000000000012"]}','');perform public.pose_campaign_action(second,1,'start','',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.check(public.pose_system_campaign_tick(t)->>'jobs_created'='1','one phone job across campaigns');
 perform pg_temp.check((select count(*)=1 from public.campaign_customers where campaign_id in (cid,second) and status='PENDING' and skip_reason='ACTIVE_CALL' and next_attempt_at=t+interval '15 minutes'),'duplicate queue deferred');
 perform pg_temp.check(public.pose_system_campaign_tick(t)->>'jobs_created'='0','repeat collision tick idempotent');
 update public.call_jobs set status='Done' where campaign_id in (cid,second);
 perform pg_temp.check(public.pose_system_campaign_tick(t+interval '15 minutes')->>'jobs_created'='1','duplicate queue can progress after release');
end $$;
rollback to temporary_contact_tests;
rollback;
select 'PASS: M07 SQL configuration, audience, scripts, eligibility, scheduler, lifecycle, progress, immutability, uniqueness and RLS checks. Fixtures rolled back.' as result;
