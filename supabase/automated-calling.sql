-- Apply after campaign-management.sql.
begin;
alter table public.calls add column conversation jsonb not null default '{"phase":"start","silences":0,"turns":0,"consents":{}}',
 add column cost_unknown boolean not null default true,
 add column reservation_released boolean not null default false,
 add column conversation_version integer not null default 0;
create table public.call_events (
 id uuid primary key default gen_random_uuid(),provider text not null,provider_event_id text not null,
 call_id uuid not null references public.calls(id),type text not null,payload jsonb not null,
 occurred_at timestamptz not null,received_at timestamptz not null default now(),unique(provider,provider_event_id)
);
create trigger call_events_immutable before update or delete on public.call_events for each row execute function pose_private.campaign_immutable();
create table public.call_turns(call_id uuid not null references public.calls(id),seq integer not null,speaker text not null check(speaker in ('AI','Customer')),text text not null,interrupted boolean not null default false,created_at timestamptz not null default now(),primary key(call_id,seq));
create table pose_private.call_processing(call_id uuid primary key references public.calls(id),status text not null default 'Pending',lease_until timestamptz,error text);
create table pose_private.call_responses(call_id uuid references public.calls(id),event_id text,reply jsonb not null,primary key(call_id,event_id));
alter table public.call_events enable row level security;
alter table public.call_turns enable row level security;
revoke all on public.call_events,public.call_turns from public,anon,authenticated;
grant select on public.call_events,public.call_turns to authenticated;
create policy call_events_staff on public.call_events for select to authenticated using(exists(select 1 from public.calls c where c.id=call_id));
create policy call_turns_staff on public.call_turns for select to authenticated using(exists(select 1 from public.calls c where c.id=call_id and c.conversation->'consents'->>'Transcript'='true'));
create policy call_transcripts_sales on public.call_transcripts for select to authenticated using(exists(select 1 from public.calls c where c.id=call_id and pose_private.staff_role()='Sales' and pose_private.lead_assigned_to_me(c.lead_id) and c.conversation->'consents'->>'Transcript'='true'));
create policy call_recordings_sales on public.call_recordings for select to authenticated using(exists(select 1 from public.calls c where c.id=call_id and pose_private.staff_role()='Sales' and pose_private.lead_assigned_to_me(c.lead_id) and c.conversation->'consents'->>'Recording'='true'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('call-recordings','call-recordings',false,20971520,array['audio/wav','audio/mpeg','audio/ogg']);

create function pose_private.call_system() returns void language plpgsql security definer set search_path='' as $$
begin if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if; end $$;

create function pose_private.claim_call_job(p_worker text,p_lease_seconds integer,p_now timestamptz,p_global integer default 2) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.call_jobs;m public.campaign_customers;c public.campaigns;a public.calls;reason text;local_now timestamp;
begin
 perform pose_private.call_system();
 if p_now is null or length(coalesce(p_worker,'')) not between 1 and 160 or p_lease_seconds not between 5 and 300 or p_global not between 1 and 2 then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 -- Global admission lock also serializes reservation checks across campaigns.
 perform pg_advisory_xact_lock(808,1);
 for j in select * from public.call_jobs where status='Pending' and scheduled_at<=p_now order by scheduled_at,id for update skip locked loop
  select * into m from public.campaign_customers where id=j.membership_id for update;
  perform pg_advisory_xact_lock(hashtextextended(m.phone_e164,7));
  select * into c from public.campaigns where id=j.campaign_id for update;
  reason:=pose_private.contact_eligibility(m.lead_id,c.id,p_now)->>'reason';
  if m.phone_e164 is distinct from (select phone from public.customers where id=m.customer_id) then reason:='PHONE_UNVERIFIED';end if;
  if reason is not null then
   perform pose_private.campaign_contact_block(m.id,reason,p_now);
   update public.call_jobs set status='Cancelled',cancel_reason=reason,updated_at=p_now where id=j.id;
   if pose_private.contact_block_kind(reason)='Temporary' then update public.campaign_customers set status='RETRYING' where id=m.id;end if;
   continue;
  end if;
  local_now:=p_now at time zone c.timezone;
  if not(extract(dow from local_now)::smallint=any(c.weekdays)) or local_now::time<c.window_start or local_now::time>=c.window_end or c.start_time>p_now or c.end_time<=p_now then continue;end if;
  if (select count(*) from public.calls where campaign_id=c.id and call_type<>'MOCK_CALL' and (created_at at time zone c.timezone)::date=local_now::date)>=coalesce(c.daily_call_limit,0) then continue;end if;
  if (select count(*) from public.calls where status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN'))>=p_global or (select count(*) from public.calls where campaign_id=c.id and status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN'))>=c.max_concurrent_calls then return null;end if;
  if c.budget_limit_vnd is null or c.cost_reserve_per_call_vnd is null or c.budget_limit_vnd-c.budget_spent_vnd-c.budget_reserved_vnd<c.cost_reserve_per_call_vnd then
   update public.campaigns set status='PAUSED',status_reason='BUDGET_EXHAUSTED',updated_at=p_now where id=c.id;
   insert into public.campaign_events(campaign_id,action,reason,snapshot) values(c.id,'budget_alert','BUDGET_EXHAUSTED',to_jsonb(c));continue;
  end if;
  insert into public.calls(job_id,membership_id,lead_id,customer_id,campaign_id,phone_e164,script_version_id,provider,call_type,status,cost_estimated_vnd,started_at,created_at,updated_at)
   values(j.id,m.id,m.lead_id,m.customer_id,c.id,m.phone_e164,c.script_version_id,'simulator','AI_AUTO_CALL','CALLING',c.cost_reserve_per_call_vnd,p_now,p_now,p_now) returning * into a;
  update public.campaigns set budget_reserved_vnd=budget_reserved_vnd+c.cost_reserve_per_call_vnd where id=c.id;
  update public.call_jobs set status='Claimed',lease_owner=p_worker,lease_until=p_now+make_interval(secs=>p_lease_seconds),updated_at=p_now where id=j.id;
  update public.campaign_customers set last_attempt_at=p_now where id=m.id;
  return to_jsonb(a)||jsonb_build_object('max_seconds',c.max_call_seconds,'idempotency_key',j.idempotency_key);
 end loop;return null;
end $$;

create function pose_private.call_retry(p_call uuid,p_now timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare a public.calls;c public.campaigns;m public.campaign_customers;reason text;n integer;
begin
 select * into a from public.calls where id=p_call;
 if a.membership_id is null then return;end if;
 select * into c from public.campaigns where id=a.campaign_id;
 select * into m from public.campaign_customers where id=a.membership_id for update;
 if m.status in ('OPTED_OUT','CANCELLED') then return;end if;
 reason:=pose_private.contact_eligibility(a.lead_id,null,p_now)->>'reason';
 select attempt_no into n from public.call_jobs where id=a.job_id;
 update public.campaign_customers set status=case
  when pose_private.phone_suppressed(a.phone_e164) or pose_private.contact_block_kind(reason)='OptOut' then 'OPTED_OUT'
  when a.status='COMPLETED' then 'COMPLETED'
  when a.status in ('BUSY','NO_ANSWER') or a.status='FAILED' and a.error_code in ('HTTP_429','TEMPORARY','UNAVAILABLE','TIMEOUT') then
   case when n<c.max_attempts and (reason is null or pose_private.contact_block_kind(reason)='Temporary') then 'RETRYING' else 'EXHAUSTED' end
  else 'FAILED' end,
  retry_count=least(coalesce(n,1),3),next_attempt_at=greatest(p_now+make_interval(hours=>c.retry_after_hours),pose_private.contact_defer_until(a.phone_e164,reason,p_now)),updated_at=p_now,version=version+1 where id=m.id;
 update public.call_jobs set status='Done',lease_until=null,updated_at=p_now where id=a.job_id;
end $$;

create function pose_private.apply_call_event(p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls;target public.call_status;v_cost numeric;cost jsonb:=p_event->'cost';is_terminal boolean;event_uuid uuid;
begin
 perform pose_private.call_system();
 select * into a from public.calls where provider='simulator' and (provider_call_id=p_event->>'provider_call_id' or id::text=p_event->>'provider_call_id') for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 -- Unconsented speech/media never enters the immutable event log.
 insert into public.call_events(provider,provider_event_id,call_id,type,payload,occurred_at)
 values('simulator',p_event->>'event_id',a.id,p_event->>'type',p_event-'utterance'-'recording'-'transcript_turns',(p_event->>'occurred_at')::timestamptz)
 on conflict(provider,provider_event_id) do nothing returning id into event_uuid;
 if event_uuid is null then return jsonb_build_object('duplicate',true,'call_id',a.id,'ignored',exists(select 1 from public.call_events where provider='simulator' and provider_event_id=p_event->>'event_id' and call_id<>a.id));end if;
 target:=upper(p_event->>'type')::public.call_status;
 if a.status in ('COMPLETED','BUSY','NO_ANSWER','FAILED','CANCELED') then return jsonb_build_object('ignored',true,'call_id',a.id);end if;
 is_terminal:=target in ('COMPLETED','BUSY','NO_ANSWER','FAILED','CANCELED');
 if not is_terminal and (a.status='ENDING' or a.status='ANSWERED' and target='RINGING') then return jsonb_build_object('ignored',true,'call_id',a.id);end if;
 if cost is not null and (cost->>'amount')::numeric>=0 then
  if cost->>'currency'='VND' then v_cost:=(cost->>'amount')::numeric;
  elsif (cost->>'fx_rate')::numeric>0 and length(cost->>'fx_source')>0 then v_cost:=(cost->>'amount')::numeric*(cost->>'fx_rate')::numeric;end if;
 end if;
 update public.calls set status=target,provider_call_id=coalesce(provider_call_id,p_event->>'provider_call_id'),updated_at=now(),answered_at=case when target='ANSWERED' then coalesce(answered_at,(p_event->>'occurred_at')::timestamptz) else answered_at end,
 ended_at=case when is_terminal then (p_event->>'occurred_at')::timestamptz end,
 end_reason=case when is_terminal then coalesce(end_reason,p_event->>'end_reason',target::text) else end_reason end,
 duration_seconds=case when is_terminal then greatest(0,coalesce((p_event->>'duration_seconds')::integer,0)) else duration_seconds end,
 error_code=coalesce(p_event->>'error_code',error_code),
 cost_actual=case when is_terminal then (cost->>'amount')::numeric else cost_actual end,cost_currency=case when is_terminal then cost->>'currency' else cost_currency end,
 fx_rate=case when is_terminal then (cost->>'fx_rate')::numeric else fx_rate end,fx_source=case when is_terminal then cost->>'fx_source' else fx_source end,
 cost_unknown=case when is_terminal then v_cost is null else cost_unknown end,reservation_released=is_terminal where id=a.id;
 if is_terminal then
  if not a.reservation_released and a.campaign_id is not null then update public.campaigns set budget_reserved_vnd=greatest(0,budget_reserved_vnd-coalesce(a.cost_estimated_vnd,0)),budget_spent_vnd=budget_spent_vnd+coalesce(v_cost,a.cost_estimated_vnd,0) where id=a.campaign_id;end if;
  perform pose_private.call_retry(a.id,now());
  if a.conversation->'consents'->>'Transcript'='true' then
   insert into public.call_transcripts(call_id,transcript,language) select a.id,string_agg(speaker||': '||text,E'\n' order by seq),'vi' from public.call_turns where call_id=a.id having count(*)>0;
   update public.calls set transcript_status=case when exists(select 1 from public.call_transcripts where call_id=a.id) then 'Available' else 'Failed' end where id=a.id;
   insert into pose_private.call_processing(call_id) values(a.id) on conflict do nothing;
  end if;
  insert into public.lead_events(lead_id,actor_kind,action,reason,after_data) select a.lead_id,'System','call_ended',coalesce(a.end_reason,target::text),jsonb_build_object('call_id',a.id) where a.lead_id is not null;
 end if;
 return jsonb_build_object('call_id',a.id,'terminal',is_terminal);
end $$;

create function pose_private.record_dispatch(p_call uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls;
begin
 perform pose_private.call_system();select * into a from public.calls where id=p_call for update;
 if a.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'CALLING' then
  if p_result->>'kind'='success' and a.status in ('RINGING','ANSWERED','UNKNOWN','ENDING') then
   update public.calls set provider_call_id=coalesce(provider_call_id,p_result->>'providerCallId') where id=a.id;
   update public.call_jobs set status='Dispatched',lease_until=null where id=a.job_id and status='Claimed';
   update public.campaign_customers set status='IN_PROGRESS' where id=a.membership_id and status='QUEUED';
  end if;
  return (select to_jsonb(c) from public.calls c where id=a.id);
 end if;
 if p_result->>'kind'='rejected' then
  update public.calls set provider_call_id=coalesce(provider_call_id,id::text),error_code=p_result->>'code' where id=a.id;
  perform pose_private.apply_call_event(jsonb_build_object('event_id','dispatch:'||a.id,'provider_call_id',a.id,'type','failed','occurred_at',now(),'error_code',p_result->>'code','cost',jsonb_build_object('amount',0,'currency','VND')));
 elsif p_result->>'kind'='ambiguous' then update public.calls set status='UNKNOWN',provider_call_id=coalesce(provider_call_id,id::text),updated_at=now() where id=a.id;
 elsif p_result->>'kind'='success' and length(p_result->>'providerCallId')>0 then
  update public.calls set provider_call_id=p_result->>'providerCallId',updated_at=now() where id=a.id;
  update public.call_jobs set status='Dispatched',lease_until=null,updated_at=now() where id=a.job_id;
  update public.campaign_customers set status='IN_PROGRESS',updated_at=now() where id=a.membership_id and status<>'OPTED_OUT';
 else raise exception 'INVALID_INPUT' using errcode='22023';end if;
 return (select to_jsonb(c) from public.calls c where id=a.id);
end $$;

create function pose_private.call_opt_out(p_phone text,p_reason text,p_source text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare role text;actor uuid;a public.calls;l public.leads;live jsonb;
begin
 if auth.role()='service_role' then role:='System';else actor:=pose_private.require_account();role:=pose_private.staff_role();end if;
 if role is null or role='Sales' and not exists(select 1 from public.leads ld join public.customers c on c.id=ld.customer_id where c.phone=p_phone and pose_private.lead_assigned_to_me(ld.id)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,7));
 insert into public.contact_suppressions(phone_e164,reason,source,actor_id) values(p_phone,p_reason,case when role='System' then 'Call' else role end,actor) on conflict do nothing;
 update public.call_jobs j set status='Cancelled',cancel_reason='OPT_OUT',updated_at=now() from public.campaign_customers m where j.membership_id=m.id and m.phone_e164=p_phone and j.status in ('Pending','Claimed');
 update public.campaign_customers set status='OPTED_OUT',skip_reason='SUPPRESSED',next_attempt_at=null,updated_at=now() where phone_e164=p_phone;
 for l in select ld.* from public.leads ld join public.customers c on c.id=ld.customer_id where c.phone=p_phone loop
  insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version,recorded_by)
  select p_phone,l.customer_id,l.id,p,'Withdrawn','Call',coalesce(p_source,role),p_reason,'call.v1',actor from unnest(array['Call','AIVoice']) p;
  insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason) values(l.id,actor,role,'call_opt_out',p_reason);
 end loop;
 for a in select * from public.calls where phone_e164=p_phone and status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN') for update loop
  update public.calls set status='ENDING',end_reason='OPT_OUT',updated_at=now() where id=a.id;
  insert into public.call_events(provider,provider_event_id,call_id,type,payload,occurred_at) values(coalesce(a.provider,'simulator'),'opt-out:'||a.id,a.id,'hangup_requested',jsonb_build_object('reason',p_reason),now()) on conflict do nothing;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into live from public.calls c where phone_e164=p_phone and status='ENDING';return live;
end $$;

create function pose_private.stop_call(p_call uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls;role text;
begin
 if auth.role()='service_role' then role:='System';else perform pose_private.require_account();role:=pose_private.staff_role();end if;
 select * into a from public.calls where id=p_call for update;
 if role is null or role='Sales' and not pose_private.lead_assigned_to_me(a.lead_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if a.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 if a.status not in ('COMPLETED','FAILED','BUSY','NO_ANSWER','CANCELED') then
  update public.calls set status='ENDING',end_reason=p_reason,updated_at=now() where id=a.id;
  insert into public.call_events(provider,provider_event_id,call_id,type,payload,occurred_at) values(coalesce(a.provider,'simulator'),'stop:'||a.id,a.id,'hangup_requested',jsonb_build_object('reason',p_reason),now()) on conflict do nothing;
  insert into public.lead_events(lead_id,actor_kind,action,reason) select a.lead_id,role,'call_stop_requested',p_reason where a.lead_id is not null;
 end if;return (select to_jsonb(c) from public.calls c where id=a.id);
end $$;

create function pose_private.call_context(p_call uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls;
begin perform pose_private.call_system();select * into a from public.calls where id=p_call;
 return to_jsonb(a)||jsonb_build_object('suppressed',pose_private.phone_suppressed(a.phone_e164),'script',(select content from public.call_script_versions where id=a.script_version_id),'lead',(select jsonb_build_object('needs',needs) from public.leads where id=a.lead_id));end $$;
create function pose_private.call_conversation(p_call uuid,p_event text,p_version integer,p_input text,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls;consent jsonb:=p_result->'consent';purpose text;seq integer;reply jsonb;
begin
 perform pose_private.call_system();select * into a from public.calls where id=p_call for update;
 select r.reply into reply from pose_private.call_responses r where call_id=p_call and event_id=p_event;if found then return reply;end if;
 if a.conversation_version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 if a.status not in ('ANSWERED') then return '{}'::jsonb;end if;
 if consent is not null and consent<>'null'::jsonb then
  purpose:=consent->>'purpose';
  insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version)
  values(a.phone_e164,a.customer_id,a.lead_id,purpose,case when (consent->>'granted')::boolean then 'Granted' else 'Withdrawn' end,'Call','Call',p_input||' | call:'||a.id||' | event:'||p_event,a.script_version_id::text);
  if purpose='AIVoice' and consent->>'granted'='false' then perform pose_private.call_opt_out(a.phone_e164,'Khách hàng từ chối xử lý thoại AI','Call');end if;
 end if;
 if p_result->>'withdraw' is not null then
  insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version) values(a.phone_e164,a.customer_id,a.lead_id,p_result->>'withdraw','Withdrawn','Call','Call',p_input||' | call:'||a.id||' | event:'||p_event,'call.v1');
  insert into public.lead_tasks(lead_id,kind,summary,source,idempotency_key) values(a.lead_id,'Review','Yêu cầu xử lý dữ liệu','System','call-withdraw:'||a.id||':'||(p_result->>'withdraw')) on conflict do nothing;
 end if;
 if p_result->>'optOut'='true' then
  perform pose_private.call_opt_out(a.phone_e164,left(p_input,450)||' call:'||a.id,'Call');
  insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version)
  select a.phone_e164,a.customer_id,a.lead_id,p,'Withdrawn','Call','Call',p_input||' | call:'||a.id||' | event:'||p_event,a.script_version_id::text from unnest(array['Call','AIVoice']) p;
 end if;
 if p_result->'state'->'consents'->>'Transcript'='true' then
  select coalesce(max(t.seq),0) into seq from public.call_turns t where call_id=a.id;
  if p_result->>'interrupted'='true' then update public.call_turns set interrupted=true where call_id=a.id and seq=(select max(t.seq) from public.call_turns t where t.call_id=a.id and speaker='AI');end if;
  if a.conversation->'consents'->>'Transcript'='true' and length(p_input)>0 then insert into public.call_turns values(a.id,seq+1,'Customer',p_input,false,now());seq:=seq+1;end if;
  if length(p_result->>'text')>0 then insert into public.call_turns values(a.id,seq+1,'AI',p_result->>'text',false,now());end if;
 end if;
 update public.calls set conversation=p_result->'state',conversation_version=conversation_version+1,end_reason=coalesce(p_result->'state'->>'end_reason',end_reason),
 transcript_status=case when p_result->'state'->'consents'->>'Transcript'='true' then 'Processing' else 'NotConsented' end,
 recording_status=case when p_result->'state'->'consents'->>'Recording'='true' then 'Processing' else 'NotConsented' end where id=a.id;
 insert into pose_private.call_responses values(a.id,p_event,case when p_result->'state'->'consents'->>'Transcript'='true' then p_result else p_result-'text' end);return p_result;
end $$;

create function pose_private.call_recording(p_call uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a public.calls;begin perform pose_private.call_system();select * into a from public.calls where id=p_call for update;
 if a.conversation->'consents'->>'Recording' is distinct from 'true' then return;end if;
 if p_data->>'failed'='true' then update public.calls set recording_status='Failed' where id=a.id;return;end if;
 if p_data->>'object_key' !~ ('^'||a.id::text||'/[a-f0-9]{64}$') or not exists(select 1 from storage.objects where bucket_id='call-recordings' and name=p_data->>'object_key') then raise exception 'FILE_NOT_FOUND' using errcode='22023';end if;
 if not exists(select 1 from public.call_recordings where call_id=a.id) then insert into public.call_recordings(call_id,recording_url,checksum,size_bytes,mime_type) values(a.id,p_data->>'object_key',p_data->>'checksum',(p_data->>'size')::bigint,p_data->>'mime');end if;
 update public.calls set recording_status='Available' where id=a.id;end $$;

create function pose_private.call_evidence(p_call uuid,p_kind text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls;role text;begin perform pose_private.require_account();role:=pose_private.staff_role();select * into a from public.calls where id=p_call;
 if role is null or role='Sales' and not pose_private.lead_assigned_to_me(a.lead_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_kind='recording' then return jsonb_build_object('status',a.recording_status,'item',case when a.conversation->'consents'->>'Recording'='true' then (select to_jsonb(r) from public.call_recordings r where call_id=a.id limit 1) end);
 elsif p_kind='transcript' then return jsonb_build_object('status',a.transcript_status,'items',case when a.conversation->'consents'->>'Transcript'='true' then (select jsonb_agg(to_jsonb(t)) from public.call_transcripts t where call_id=a.id) end);end if;raise exception 'INVALID_INPUT' using errcode='22023';end $$;

create function pose_private.call_reconcile_list(p_now timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform pose_private.call_system();return coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('max_seconds',coalesce(p.max_call_seconds,300))) from public.calls c left join public.campaigns p on p.id=c.campaign_id where c.status='UNKNOWN' or c.status in ('CALLING','RINGING','ANSWERED','ENDING') and (c.updated_at<p_now-interval '2 minutes' or c.answered_at+make_interval(secs=>coalesce(p.max_call_seconds,300)+30)<p_now)),'[]');end $$;

create function pose_private.call_test(p_lead uuid,p_script uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare reason text;a public.calls;begin perform pose_private.campaign_admin();perform pg_advisory_xact_lock(808,1);
 perform pg_advisory_xact_lock(hashtextextended((select c.phone from public.customers c join public.leads l on l.customer_id=c.id where l.id=p_lead),7));
 reason:=pose_private.contact_eligibility(p_lead,null)->>'reason';if reason is not null then raise exception 'INELIGIBLE: %',reason using errcode='22023';end if;
 if not exists(select 1 from public.call_script_versions where id=p_script and status='Published') then raise exception 'INVALID_SCRIPT' using errcode='22023';end if;
 if (select count(*) from public.calls where status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN'))>=2 then raise exception 'CAPACITY' using errcode='22023';end if;
 insert into public.calls(lead_id,customer_id,phone_e164,script_version_id,provider,call_type,status,started_at) select l.id,c.id,c.phone,p_script,'simulator','MOCK_CALL','CALLING',now() from public.leads l join public.customers c on c.id=l.customer_id where l.id=p_lead returning * into a;
 return to_jsonb(a)||jsonb_build_object('max_seconds',300,'idempotency_key','test:'||a.id);end $$;

-- Thin invoker wrappers keep every authorization decision inside PostgreSQL.
create function public.pose_system_claim_call_job(p_worker text,p_lease_seconds integer,p_now timestamptz,p_global integer default 2) returns jsonb language sql security invoker set search_path='' as $$select pose_private.claim_call_job(p_worker,p_lease_seconds,p_now,p_global)$$;
create function public.pose_system_record_dispatch(p_call uuid,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$select pose_private.record_dispatch(p_call,p_result)$$;
create function public.pose_system_apply_call_event(p_event jsonb) returns jsonb language sql security invoker set search_path='' as $$select pose_private.apply_call_event(p_event)$$;
create function public.pose_system_call_context(p_call uuid) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_context(p_call)$$;
create function public.pose_system_call_conversation(p_call uuid,p_event text,p_version integer,p_input text,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_conversation(p_call,p_event,p_version,p_input,p_result)$$;
create function public.pose_system_call_recording(p_call uuid,p_data jsonb) returns void language sql security invoker set search_path='' as $$select pose_private.call_recording(p_call,p_data)$$;
create function public.pose_system_call_reconcile_list(p_now timestamptz) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_reconcile_list(p_now)$$;
create function public.pose_system_call_opt_out(p_phone text,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_opt_out(p_phone,p_reason,'Call')$$;
create function public.pose_system_stop_call(p_call uuid,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.stop_call(p_call,p_reason)$$;
create function pose_private.call_processing(p_call uuid,p_result text) returns jsonb language plpgsql security definer set search_path='' as $$
declare work jsonb;begin perform pose_private.call_system();
 if p_call is not null then update pose_private.call_processing set status=p_result,lease_until=null where call_id=p_call;return '[]';end if;
 with picked as (select q.call_id from pose_private.call_processing q join public.calls c on c.id=q.call_id where (q.status in ('Pending','Failed') or q.status='Processing' and q.lease_until<now()) and c.conversation->'consents'->>'Transcript'='true' order by q.call_id for update of q skip locked limit 10),
 claimed as(update pose_private.call_processing q set status='Processing',lease_until=now()+interval '5 minutes' from picked p where q.call_id=p.call_id returning q.call_id)
 select coalesce(jsonb_agg(jsonb_build_object('call_id',c.call_id,'transcript',(select string_agg(transcript,E'\n') from public.call_transcripts where call_id=c.call_id),'customer_text',(select string_agg(text,E'\n' order by seq) from public.call_turns where call_id=c.call_id and speaker='Customer'))),'[]') into work from claimed c;
 return work;end $$;
create function public.pose_system_call_processing(p_call uuid,p_result text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_processing(p_call,p_result)$$;
create function pose_private.call_response(p_call uuid,p_event text) returns jsonb language plpgsql security definer set search_path='' as $$begin perform pose_private.call_system();return(select reply from pose_private.call_responses where call_id=p_call and event_id=p_event);end $$;
create function public.pose_system_call_response(p_call uuid,p_event text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_response(p_call,p_event)$$;
revoke all on function pose_private.call_response(uuid,text),public.pose_system_call_response(uuid,text) from public,anon,authenticated;
grant execute on function pose_private.call_response(uuid,text),public.pose_system_call_response(uuid,text) to service_role;
revoke all on function pose_private.call_processing(uuid,text),public.pose_system_call_processing(uuid,text) from public,anon,authenticated;
grant execute on function pose_private.call_processing(uuid,text),public.pose_system_call_processing(uuid,text) to service_role;
revoke all on pose_private.call_processing,pose_private.call_responses from public,anon,authenticated;
create policy call_recordings_sign on storage.objects for select to authenticated using(bucket_id='call-recordings' and exists(select 1 from public.calls c join public.call_recordings r on r.call_id=c.id where r.recording_url=storage.objects.name and c.recording_status='Available' and c.conversation->'consents'->>'Recording'='true'));
create function public.pose_call_opt_out(p_phone text,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_opt_out(p_phone,p_reason)$$;
create function public.pose_stop_call(p_call uuid,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.stop_call(p_call,p_reason)$$;
create function public.pose_call_evidence(p_call uuid,p_kind text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_evidence(p_call,p_kind)$$;
create function public.pose_test_call(p_lead uuid,p_script uuid) returns jsonb language sql security invoker set search_path='' as $$select pose_private.call_test(p_lead,p_script)$$;
create function pose_private.call_revive_deferred() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.call_jobs set status='Pending',cancel_reason=null,scheduled_at=new.scheduled_at,updated_at=now() where membership_id=new.membership_id and attempt_no=new.attempt_no and status='Cancelled' and cancel_reason in ('ACTIVE_CALL','DAILY_CAP','WEEKLY_CAP') and not exists(select 1 from public.calls where job_id=call_jobs.id);
 return new;
end $$;
revoke all on function pose_private.call_revive_deferred() from public,anon,authenticated;
create trigger call_revive_deferred before insert on public.call_jobs for each row execute function pose_private.call_revive_deferred();
alter function pose_private.campaign_progress(uuid) rename to campaign_progress_base;
create function pose_private.campaign_progress(p_campaign uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;begin base:=pose_private.campaign_progress_base(p_campaign);
 return base||jsonb_build_object('cost_log',coalesce((select jsonb_agg(jsonb_build_object('call_id',id,'estimated_vnd',cost_estimated_vnd,'actual',cost_actual,'currency',cost_currency,'fx_rate',fx_rate,'fx_source',fx_source,'unknown',cost_unknown)) from public.calls where campaign_id=p_campaign),'[]'));end $$;
revoke all on function pose_private.campaign_progress(uuid) from public,anon;
grant execute on function pose_private.campaign_progress(uuid) to authenticated;
create or replace function public.pose_campaign_progress(p_campaign uuid) returns jsonb language sql security invoker set search_path='' as $$select pose_private.campaign_progress(p_campaign)$$;
-- A consented conversation may end by confirmed hangup. Preserve M06's existing
-- completed-call contract while accepting these additional evidenced sources.
create function pose_private.call_source_finished(p_call uuid,p_lead uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.calls c where c.id=p_call and c.lead_id=p_lead and (c.status='COMPLETED' or c.status in ('BUSY','NO_ANSWER','FAILED','CANCELED') and c.answered_at is not null and c.conversation->'consents'->>'Transcript'='true'));
$$;
revoke all on function pose_private.call_source_finished(uuid,uuid) from public,anon,authenticated;
do $$declare definition text;begin
 definition:=pg_get_functiondef('pose_private.ai_record_extraction(uuid,text,uuid,text,jsonb,text)'::regprocedure);
 if strpos(definition,'exists(select 1 from public.calls where id=p_source_id and lead_id=p_lead and status=''COMPLETED'')')=0 then raise exception 'CALL_EXTRACTION_CONTRACT_CHANGED';end if;
 execute replace(definition,'exists(select 1 from public.calls where id=p_source_id and lead_id=p_lead and status=''COMPLETED'')','pose_private.call_source_finished(p_source_id,p_lead)');
 definition:=pg_get_functiondef('pose_private.ai_apply_score(uuid,jsonb,text)'::regprocedure);
 if strpos(definition,'exists(select 1 from public.calls c where c.id=call_id and c.lead_id=p_lead and c.status=''COMPLETED'')')=0 then raise exception 'CALL_SCORING_CONTRACT_CHANGED';end if;
 execute replace(definition,'exists(select 1 from public.calls c where c.id=call_id and c.lead_id=p_lead and c.status=''COMPLETED'')','pose_private.call_source_finished(call_id,p_lead)');
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','pose_private') and p.proname in ('call_system','claim_call_job','call_retry','apply_call_event','record_dispatch','call_opt_out','stop_call','call_context','call_conversation','call_recording','call_evidence','call_reconcile_list','call_test','pose_system_claim_call_job','pose_system_record_dispatch','pose_system_apply_call_event','pose_system_call_context','pose_system_call_conversation','pose_system_call_recording','pose_system_call_reconcile_list','pose_system_call_opt_out','pose_system_stop_call','pose_call_opt_out','pose_stop_call','pose_call_evidence','pose_test_call') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
  if f.proname in ('call_opt_out','stop_call','call_evidence','call_test','pose_call_opt_out','pose_stop_call','pose_call_evidence','pose_test_call') then execute format('grant execute on function %s to authenticated',f.sig);end if;
 end loop;
end $$;
commit;
