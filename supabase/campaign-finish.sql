-- M07 finish delta. Apply after campaign-management.sql, campaign-audience.sql,
-- automated-calling.sql and campaign-scheduler.sql. This file is the only live
-- SQL change required for the finish work.
begin;

alter table public.campaigns add column if not exists owner_id uuid references auth.users(id);
alter table public.campaigns add column if not exists provider_failure_count integer not null default 0;
alter table public.campaigns add constraint campaigns_provider_failure_count_nonnegative check (provider_failure_count >= 0);

alter function pose_private.save_campaign(uuid,integer,jsonb,text) rename to save_campaign_m07_base;
create function pose_private.save_campaign(p_id uuid,p_version integer,p_data jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); result jsonb; cid uuid; requested uuid; saved public.campaigns;
begin
 requested:=case when p_data ? 'owner_id' and p_data->>'owner_id' is not null then (p_data->>'owner_id')::uuid else null end;
 if requested is not null and not exists(select 1 from public.users u where u.auth_user_id=requested and u.role in ('Admin','Sales') and u.account_status='active') then raise exception 'INVALID_OWNER' using errcode='22023'; end if;
 result:=pose_private.save_campaign_m07_base(p_id,p_version,p_data-'owner_id',p_reason); cid:=(result->>'id')::uuid;
 update public.campaigns set owner_id=coalesce(requested,owner_id,created_by),updated_at=now() where id=cid returning * into saved;
 return to_jsonb(saved);
end $$;

-- Keep the pause admission fix local to this delta: the M08 function is renamed
-- and replaced with the same contract, but a paused campaign is never touched.
alter function pose_private.claim_call_job(text,integer,timestamptz,integer) rename to claim_call_job_m07_base;
create function pose_private.claim_call_job(p_worker text,p_lease_seconds integer,p_now timestamptz,p_global integer default 2)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.call_jobs; m public.campaign_customers; c public.campaigns; a public.calls; reason text; local_now timestamp;
begin
 perform pose_private.call_system();
 if p_now is null or length(coalesce(p_worker,'')) not between 1 and 160 or p_lease_seconds not between 5 and 300 or p_global not between 1 and 2 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(808,1);
 for j in select * from public.call_jobs where status='Pending' and scheduled_at<=p_now order by scheduled_at,id for update skip locked loop
  select * into m from public.campaign_customers where id=j.membership_id for update;
  select * into c from public.campaigns where id=j.campaign_id for update;
  if c.status <> 'RUNNING' then continue; end if;
  perform pg_advisory_xact_lock(hashtextextended(m.phone_e164,7));
  reason:=pose_private.contact_eligibility(m.lead_id,c.id,p_now)->>'reason';
  if m.phone_e164 is distinct from (select phone from public.customers where id=m.customer_id) then reason:='PHONE_UNVERIFIED'; end if;
  if reason is not null then
   perform pose_private.campaign_contact_block(m.id,reason,p_now);
   update public.call_jobs set status='Cancelled',cancel_reason=reason,updated_at=p_now where id=j.id;
   if pose_private.contact_block_kind(reason)='Temporary' then update public.campaign_customers set status='RETRYING' where id=m.id; end if;
   continue;
  end if;
  local_now:=p_now at time zone c.timezone;
  if not(extract(dow from local_now)::smallint=any(c.weekdays)) or local_now::time<c.window_start or local_now::time>=c.window_end or c.start_time>p_now or c.end_time<=p_now then continue; end if;
  if (select count(*) from public.calls where campaign_id=c.id and call_type<>'MOCK_CALL' and (created_at at time zone c.timezone)::date=local_now::date)>=coalesce(c.daily_call_limit,0) then continue; end if;
  if (select count(*) from public.calls where status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN'))>=p_global or (select count(*) from public.calls where campaign_id=c.id and status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN'))>=c.max_concurrent_calls then return null; end if;
  if c.budget_limit_vnd is null or c.cost_reserve_per_call_vnd is null or c.budget_limit_vnd-c.budget_spent_vnd-c.budget_reserved_vnd<c.cost_reserve_per_call_vnd then
   update public.campaigns set status='PAUSED',status_reason='BUDGET_EXHAUSTED',version=version+1,updated_at=p_now where id=c.id;
   insert into public.campaign_events(campaign_id,action,reason,snapshot) values(c.id,'budget_alert','BUDGET_EXHAUSTED',(select to_jsonb(x) from public.campaigns x where x.id=c.id));
   continue;
  end if;
  insert into public.calls(job_id,membership_id,lead_id,customer_id,campaign_id,phone_e164,script_version_id,provider,call_type,status,cost_estimated_vnd,started_at,created_at,updated_at)
   values(j.id,m.id,m.lead_id,m.customer_id,c.id,m.phone_e164,c.script_version_id,'simulator','AI_AUTO_CALL','CALLING',c.cost_reserve_per_call_vnd,p_now,p_now,p_now) returning * into a;
  update public.campaigns set budget_reserved_vnd=budget_reserved_vnd+c.cost_reserve_per_call_vnd,provider_failure_count=0 where id=c.id;
  update public.call_jobs set status='Claimed',lease_owner=p_worker,lease_until=p_now+make_interval(secs=>p_lease_seconds),updated_at=p_now where id=j.id;
  update public.campaign_customers set last_attempt_at=p_now where id=m.id;
  return to_jsonb(a)||jsonb_build_object('max_seconds',c.max_call_seconds,'idempotency_key',j.idempotency_key);
 end loop; return null;
end $$;

-- Completion remains atomic, and now has an auditable state transition.
alter function pose_private.campaign_complete(uuid) rename to campaign_complete_m07_base;
create function pose_private.campaign_complete(p_campaign uuid) returns void language plpgsql security definer set search_path='' as $$
declare before_status public.campaign_status; after_row public.campaigns;
begin
 select status into before_status from public.campaigns where id=p_campaign for update;
 perform pose_private.campaign_complete_m07_base(p_campaign);
 select * into after_row from public.campaigns where id=p_campaign;
 if before_status is distinct from 'COMPLETED' and after_row.status='COMPLETED' then
  insert into public.campaign_events(campaign_id,action,reason,snapshot) values(p_campaign,'completed','',to_jsonb(after_row));
 end if;
end $$;

-- Progress wrapper adds the SRS buckets while retaining the existing details.
alter function pose_private.campaign_progress(uuid) rename to campaign_progress_m07_base;
create function pose_private.campaign_progress(p_campaign uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; waiting bigint; calling bigint; finished bigint; total bigint;
begin
 result:=pose_private.campaign_progress_m07_base(p_campaign);
 select count(*) filter (where status in ('PENDING','QUEUED','RETRYING')),count(*) filter (where status='IN_PROGRESS' or exists(select 1 from public.calls x where x.membership_id=m.id and x.status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN'))),count(*) filter (where status in ('COMPLETED','SKIPPED','OPTED_OUT','FAILED','EXHAUSTED','CANCELLED')),count(*) into waiting,calling,finished,total from public.campaign_customers m where campaign_id=p_campaign;
 return result||jsonb_build_object('buckets',jsonb_build_object('waiting',waiting,'calling',calling,'finished',finished),'bucket_total',waiting+calling+finished,'bucket_invariant',waiting+calling+finished=total);
end $$;

create or replace function public.pose_campaign_progress(p_campaign uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.campaign_progress(p_campaign) $$;

create function pose_private.campaign_members(p_campaign uuid,p_status text default null,p_page integer default 1,p_page_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; total integer;
begin
 perform pose_private.campaign_admin();
 if p_page<1 or p_page_size not between 1 and 100 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 select count(*) into total from public.campaign_customers where campaign_id=p_campaign and (p_status is null or status=p_status);
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'lead_id',m.lead_id,'lead',coalesce(c.full_name,''),'phone',left(m.phone_e164,3)||repeat('•',greatest(0,length(m.phone_e164)-7))||right(m.phone_e164,4),'status',m.status,'reason',m.skip_reason,'attempts',m.retry_count,'last_call',lc.status,'last_outcome',lc.end_reason,'duration',lc.duration_seconds,'cost',coalesce(lc.cost_actual,lc.cost_estimated_vnd,0),'match_score',m.priority,'script_version',lc.script_version_id) order by m.added_at,m.id),'[]') into rows
 from public.campaign_customers m join public.customers c on c.id=m.customer_id left join lateral (select x.* from public.calls x where x.membership_id=m.id order by x.created_at desc limit 1) lc on true where m.campaign_id=p_campaign and (p_status is null or m.status=p_status) offset (p_page-1)*p_page_size limit p_page_size;
 return jsonb_build_object('items',rows,'total',total,'page',p_page,'page_size',p_page_size);
end $$;

create function pose_private.campaign_report(p_campaign uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; summary jsonb;
begin
 perform pose_private.campaign_admin();
 select coalesce(jsonb_agg(jsonb_build_object('lead_id',m.lead_id,'phone',left(m.phone_e164,3)||repeat('•',greatest(0,length(m.phone_e164)-7))||right(m.phone_e164,4),'match_score',m.priority,'final_status',m.status,'reason',m.skip_reason,'attempts',m.retry_count,'last_call_status',lc.status,'last_call_outcome',lc.end_reason,'duration',lc.duration_seconds,'cost_vnd',coalesce(lc.cost_actual,lc.cost_estimated_vnd,0),'script_version',lc.script_version_id) order by m.id),'[]') into rows from public.campaign_customers m left join lateral (select x.* from public.calls x where x.membership_id=m.id order by x.created_at desc limit 1) lc on true where m.campaign_id=p_campaign;
 select jsonb_build_object('total',count(*),'waiting',count(*) filter(where status in ('PENDING','QUEUED','RETRYING')),'calling',count(*) filter(where status='IN_PROGRESS'),'finished',count(*) filter(where status in ('COMPLETED','SKIPPED','OPTED_OUT','FAILED','EXHAUSTED','CANCELLED')),'calls',(select count(*) from public.calls where campaign_id=p_campaign),'connected',(select count(*) from public.calls where campaign_id=p_campaign and answered_at is not null),'cost_vnd',(select coalesce(sum(coalesce(cost_actual,cost_estimated_vnd,0)),0) from public.calls where campaign_id=p_campaign)) into summary from public.campaign_customers where campaign_id=p_campaign;
 return jsonb_build_object('summary',summary,'rows',rows);
end $$;

create function pose_private.record_provider_failure(p_campaign uuid,p_reason text default 'PROVIDER_UNAVAILABLE') returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.campaigns; n integer;
begin
 select * into c from public.campaigns where id=p_campaign for update; if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 n:=case when c.status='RUNNING' then c.provider_failure_count+1 else 0 end;
 if c.status='RUNNING' and n>=3 then update public.campaigns set status='PAUSED',status_reason='PROVIDER_UNAVAILABLE',provider_failure_count=n,version=version+1,updated_at=now() where id=c.id returning * into c; insert into public.campaign_events(campaign_id,action,reason,snapshot) values(c.id,'provider_pause','PROVIDER_UNAVAILABLE',to_jsonb(c));
 elsif c.status='RUNNING' then update public.campaigns set provider_failure_count=n,updated_at=now() where id=c.id returning * into c;
 end if;
 return to_jsonb(c);
end $$;
create function public.pose_record_provider_failure(p_campaign uuid,p_reason text default 'PROVIDER_UNAVAILABLE') returns jsonb language sql security invoker set search_path='' as $$ select pose_private.record_provider_failure(p_campaign,p_reason) $$;

create function public.pose_campaign_members(p_campaign uuid,p_status text default null,p_page integer default 1,p_page_size integer default 20) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.campaign_members(p_campaign,p_status,p_page,p_page_size) $$;
create function public.pose_campaign_report(p_campaign uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.campaign_report(p_campaign) $$;
create function pose_private.remove_campaign_member(p_campaign uuid,p_membership uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); m public.campaign_customers;
begin
 select * into m from public.campaign_customers where id=p_membership and campaign_id=p_campaign for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if m.status<>'PENDING' then raise exception 'MEMBER_ALREADY_STARTED' using errcode='22023'; end if;
 update public.campaign_customers set status='SKIPPED',skip_reason='REMOVED_BY_ADMIN',version=version+1,updated_at=now() where id=m.id;
 insert into public.campaign_events(campaign_id,actor_id,action,reason,snapshot) values(p_campaign,actor,'member_removed','REMOVED_BY_ADMIN',jsonb_build_object('membership_id',m.id));
 return (select to_jsonb(x) from public.campaign_customers x where x.id=m.id);
end $$;
create function public.pose_remove_campaign_member(p_campaign uuid,p_membership uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.remove_campaign_member(p_campaign,p_membership) $$;
revoke all on function pose_private.campaign_members(uuid,text,integer,integer),pose_private.campaign_report(uuid),pose_private.remove_campaign_member(uuid,uuid),public.pose_campaign_members(uuid,text,integer,integer),public.pose_campaign_report(uuid),public.pose_remove_campaign_member(uuid,uuid),public.pose_record_provider_failure(uuid,text) from public,anon;
grant execute on function pose_private.campaign_members(uuid,text,integer,integer),pose_private.campaign_report(uuid),pose_private.remove_campaign_member(uuid,uuid),public.pose_campaign_members(uuid,text,integer,integer),public.pose_campaign_report(uuid),public.pose_remove_campaign_member(uuid,uuid) to authenticated;
grant execute on function public.pose_record_provider_failure(uuid,text) to service_role;
-- Replaced functions get the same privileges as the originals (new functions default to PUBLIC execute).
revoke all on function pose_private.save_campaign(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function pose_private.save_campaign(uuid,integer,jsonb,text) to authenticated;
revoke all on function pose_private.claim_call_job(text,integer,timestamptz,integer) from public,anon,authenticated;
grant execute on function pose_private.claim_call_job(text,integer,timestamptz,integer) to service_role;
revoke all on function pose_private.campaign_complete(uuid) from public,anon,authenticated;
revoke all on function pose_private.campaign_progress(uuid) from public,anon,authenticated;
grant execute on function pose_private.campaign_progress(uuid) to authenticated;
revoke all on function pose_private.save_campaign_m07_base(uuid,integer,jsonb,text),pose_private.claim_call_job_m07_base(text,integer,timestamptz,integer),pose_private.campaign_complete_m07_base(uuid),pose_private.campaign_progress_m07_base(uuid) from public,anon,authenticated;
revoke all on function pose_private.record_provider_failure(uuid,text),public.pose_record_provider_failure(uuid,text) from public,anon,authenticated;
grant execute on function pose_private.record_provider_failure(uuid,text),public.pose_record_provider_failure(uuid,text) to service_role;
commit;
