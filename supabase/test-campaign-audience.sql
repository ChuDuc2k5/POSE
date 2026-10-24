-- Run with frontend/scripts/test-campaign-audience-sql.mjs and PGLITE_PATH.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,created_at,updated_at)
values('fa100000-0000-4000-8000-000000000001','authenticated','authenticated','audience@example.test',now(),'{"role":"Admin"}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',now(),now());
insert into public.customers(id,full_name,phone,auth_user_id,phone_verified_at) values('fa300000-0000-4000-8000-000000000001','Audience customer','+84987654321','fa100000-0000-4000-8000-000000000001',now());
insert into public.leads(id,customer_id,source,needs) values('fa400000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','Manual','{"locations":{"value":["Thu Duc"],"confirmed_by":"sales"}}');
insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version) values
 ('+84987654321','fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000001','Call','Granted','Web','Test','Audience test consent','v1'),
 ('+84987654321','fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000001','AIVoice','Granted','Web','Test','Audience test consent','v1');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000001","session_id":"fa200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare c jsonb; p jsonb; begin
  c:=public.pose_save_campaign(null,0,'{"name":"Audience test","daily_call_limit":1,"budget_limit_vnd":1000,"cost_reserve_per_call_vnd":100}','');
  p:=public.pose_preview_campaign_audience((c->>'id')::uuid,'{"match_campaign_products":true,"min_match":40,"confirmed_needs_only":true}');
  if p->>'rule_version' is not null or not (p ? 'matched') or not (p->'sample'->0 ? 'reasons') then raise exception 'MATCH_PREVIEW_SHAPE'; end if;
  perform public.pose_set_campaign_audience((c->>'id')::uuid,0,'{"match_campaign_products":true,"min_match":0}','');
  if not exists(select 1 from public.campaign_customers where campaign_id=(c->>'id')::uuid and snapshot ? 'match' and snapshot ? 'reasons') then raise exception 'MATCH_SNAPSHOT_MISSING'; end if;
  perform set_config('audience.priority_campaign',c->>'id',true);
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare cid uuid:=current_setting('audience.priority_campaign')::uuid; first_id uuid:='fa300000-0000-4000-8000-000000000001'; second_id uuid:='fa300000-0000-4000-8000-000000000002'; first_lead uuid:='fa400000-0000-4000-8000-000000000001'; second_lead uuid:='fa400000-0000-4000-8000-000000000002'; job_customer uuid;
begin
 insert into public.customers(id,full_name,phone,phone_verified_at) values(second_id,'Priority customer','+84987654322',now());
 insert into public.leads(id,customer_id,source,needs) values(second_lead,second_id,'Manual','{}');
 insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version) values('+84987654322',second_id,second_lead,'Call','Granted','Web','Test','Priority test','v1'),('+84987654322',second_id,second_lead,'AIVoice','Granted','Web','Test','Priority test','v1');
 update public.campaigns set status='RUNNING',weekdays='{3}',window_start='00:00',window_end='23:59',daily_call_limit=1,budget_limit_vnd=1000,cost_reserve_per_call_vnd=100 where id=cid;
 update public.campaign_customers set priority=10,status='PENDING',next_attempt_at=null where campaign_id=cid and customer_id=first_id;
 insert into public.campaign_customers(campaign_id,customer_id,lead_id,phone_e164,snapshot,status,priority) values(cid,second_id,second_lead,'+84987654322','{}','PENDING',90);
 perform public.pose_system_campaign_tick('2026-10-14 03:00Z');
 select m.customer_id into job_customer from public.call_jobs j join public.campaign_customers m on m.id=j.membership_id where j.campaign_id=cid order by j.id limit 1;
 if job_customer is distinct from second_id then raise exception 'PRIORITY_ORDER_FAILED'; end if;
end $$;
rollback;
