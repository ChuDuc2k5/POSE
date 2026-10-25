-- Run after automated-calling.sql. Fixtures and assertions roll back.
begin;

-- Calling fixtures begin.

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

delete from calls;
delete from contact_suppressions;
update leads set archived=false,status='NEW';
update customers set phone_verified_at=now();
insert into contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version,recorded_at)
select c.phone,c.id,l.id,p,'Granted','Sales','Fixture','Đã xác minh lựa chọn gọi','v1',now()+interval '1 second' from customers c join leads l on l.customer_id=c.id cross join unnest(array['Call','AIVoice']) p where right(c.phone,4)<>'0003';
insert into campaigns(id,name,status,script_version_id,max_concurrent_calls,daily_call_limit,budget_limit_vnd,cost_reserve_per_call_vnd,window_start,window_end,weekdays)
values('f8900000-0000-4000-8000-000000000001','Cuộc gọi giả lập','RUNNING','f7800000-0000-4000-8000-000000000001',2,100,10000,100,'00:00','23:59:59','{0,1,2,3,4,5,6}'),
('f8900000-0000-4000-8000-000000000002','Chiến dịch khác','RUNNING','f7800000-0000-4000-8000-000000000001',2,100,10000,100,'00:00','23:59:59','{0,1,2,3,4,5,6}');
insert into campaign_customers(campaign_id,customer_id,lead_id,phone_e164,status)
select 'f8900000-0000-4000-8000-000000000001',c.id,l.id,c.phone,'QUEUED' from customers c join leads l on l.customer_id=c.id;
insert into call_jobs(campaign_id,membership_id,attempt_no,scheduled_at,idempotency_key,created_at)
select campaign_id,id,1,now()-interval '1 hour', 'fixture:'||phone_e164,now()-interval '1 hour'+right(phone_e164,4)::integer*interval '1 second' from campaign_customers;
-- Calling fixtures end.

create temp table checks(n integer default 0);insert into checks default values;grant all on checks to authenticated,service_role;
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;update checks set n=n+1;end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare a jsonb;b jsonb;e jsonb;begin
 a:=pose_system_claim_call_job('sql-worker',30,now());b:=pose_system_claim_call_job('sql-worker',30,now());
 perform pg_temp.check(a is not null and b is not null,'two slots');
 perform pg_temp.check(pose_system_claim_call_job('sql-worker',30,now()) is null,'global capacity');
 perform pg_temp.check((select budget_reserved_vnd=200 from campaigns where id='f8900000-0000-4000-8000-000000000001'),'atomic reservations');
 perform pose_system_record_dispatch((a->>'id')::uuid,'{"kind":"ambiguous"}');
 perform pg_temp.check((select status='UNKNOWN' from calls where id=(a->>'id')::uuid),'unknown no retry');
 e:=jsonb_build_object('event_id','sql-completed','provider_call_id',a->>'id','type','completed','occurred_at',now(),'cost',jsonb_build_object('amount',0.01,'currency','USD'));
 perform pose_system_apply_call_event(e);perform pose_system_apply_call_event(e);perform pose_system_apply_call_event(e||'{"event_id":"sql-late","type":"ringing"}');
 perform pg_temp.check((pose_system_apply_call_event(e||jsonb_build_object('provider_call_id',b->>'id','type','answered'))->>'ignored')::boolean,'reused event ID on another call has no effect');
 perform pg_temp.check((select status='COMPLETED' and cost_unknown from calls where id=(a->>'id')::uuid),'terminal monotonic unknown fx');
 perform pg_temp.check((select count(*)=1 from call_events where provider_event_id='sql-completed'),'event uniqueness');
 perform pg_temp.check((select budget_reserved_vnd=100 and budget_spent_vnd=100 from campaigns where id='f8900000-0000-4000-8000-000000000001'),'settle estimate exactly once');
 perform pg_temp.check((select count(*)=0 from call_turns),'no transcript without consent');
 perform pg_temp.check(not has_function_privilege('authenticated','public.pose_system_claim_call_job(text,integer,timestamptz,integer)','execute'),'worker grant');
 perform pg_temp.check(not has_function_privilege('anon','public.pose_system_apply_call_event(jsonb)','execute'),'webhook grant');
 perform pg_temp.check(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pose_system_%call%' and has_function_privilege('authenticated',p.oid,'execute')),'all system call RPCs deny authenticated');
 perform pg_temp.check(not has_table_privilege('anon','public.calls','select'),'Guest has no calls privilege');
 perform pg_temp.check((select count(*)=2 from calls),'job uniqueness after repeated claim');

 perform pose_system_record_dispatch((b->>'id')::uuid,'{"kind":"rejected","code":"TEMPORARY"}');
 perform pg_temp.check((select status='RETRYING' and retry_count=1 and next_attempt_at>=now()+interval '24 hours' from campaign_customers where id=(b->>'membership_id')::uuid),'retry spacing');
end $$;
reset role;
select pg_temp.check((select count(*)=0 from storage.buckets where id='call-recordings' and public),'private bucket');
select pg_temp.check((select count(*)=0 from pose_private.call_processing),'unconsented call never enqueues extraction');
insert into users(full_name,email,auth_user_id,role,account_status,email_verified) values('Sales','m07-2@example.test','f7100000-0000-4000-8000-000000000002','Sales','active',true);
insert into lead_assignments(lead_id,sales_id) select (select lead_id from calls limit 1),id from users where auth_user_id='f7100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000002","session_id":"f7200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.check((select count(*)=1 from calls),'assigned sales only');
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000003","session_id":"f7200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.check((select count(*)=0 from calls),'User sees no calls');
reset role;set local role anon;
reset role;
select 'PASS: '||n||' M08 SQL checks' as result from checks;
rollback;
