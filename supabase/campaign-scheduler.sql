-- Apply after campaign-management.sql (and automated-calling.sql, when installed).
begin;
-- Compare inside the tick transaction so concurrent/manual ticks report only their own changes.
create function pose_private.campaign_tick_state(p_campaign uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'campaign',(select jsonb_build_array(status,version) from public.campaigns where id=p_campaign),
  'memberships',(select jsonb_agg(jsonb_build_array(id,status,version,skip_reason,next_attempt_at) order by id) from public.campaign_customers where campaign_id=p_campaign),
  'jobs',(select jsonb_agg(jsonb_build_array(id,status) order by id) from public.call_jobs where campaign_id=p_campaign));
$$;
revoke all on function pose_private.campaign_tick_state(uuid) from public,anon,authenticated;
create or replace function pose_private.system_campaign_tick(p_now timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.campaigns; m public.campaign_customers; local_now timestamp; allowance integer; queued integer; added integer:=0; missing jsonb; reason text; n integer; before_state jsonb; changed jsonb:='[]'; begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if;
 if p_now is null then raise exception 'INVALID_TIME' using errcode='22023'; end if;
 for c in select * from public.campaigns where status in ('SCHEDULED','RUNNING','PAUSED') order by id for update skip locked loop
  before_state:=pose_private.campaign_tick_state(c.id);
  if c.status='SCHEDULED' and c.start_time<=p_now then
   missing:=pose_private.campaign_preflight(c.id,c.provider_ready,p_now);
   update public.campaigns set status=case when missing='[]'::jsonb then 'RUNNING'::public.campaign_status else 'FAILED'::public.campaign_status end,status_reason=case when missing='[]'::jsonb then '' else missing::text end,version=version+1,updated_at=p_now where id=c.id returning * into c;
  end if;
  if c.status='RUNNING' then
   if c.end_time is not null and c.end_time<=p_now then
    update public.campaign_customers set status='EXHAUSTED',skip_reason='END_TIME',updated_at=p_now where campaign_id=c.id and status in ('PENDING','RETRYING');
   else
    local_now:=p_now at time zone c.timezone;
    if extract(dow from local_now)::smallint=any(c.weekdays) and local_now::time>=c.window_start and local_now::time<c.window_end then
     select count(*) into queued from public.call_jobs where campaign_id=c.id and status in ('Pending','Claimed');
     allowance:=least(coalesce(c.daily_call_limit,0)-(select count(*)::integer from public.call_jobs where campaign_id=c.id and (created_at at time zone c.timezone)::date=local_now::date),greatest(0,coalesce(floor((coalesce(c.budget_limit_vnd,0)-c.budget_spent_vnd-c.budget_reserved_vnd)/nullif(c.cost_reserve_per_call_vnd,0)),0)-queued))::integer;
     for m in select * from public.campaign_customers where campaign_id=c.id and (status='PENDING' and (next_attempt_at is null or next_attempt_at<=p_now) or status='RETRYING' and next_attempt_at<=p_now) order by added_at,id for update loop
      reason:=pose_private.contact_eligibility(m.lead_id,c.id,p_now)->>'reason';
      if m.phone_e164 is distinct from (select phone from public.customers where id=m.customer_id) then reason:='PHONE_UNVERIFIED'; end if;
      if reason is not null then
       perform pose_private.campaign_contact_block(m.id,reason,p_now);
       continue;
      end if;
      n:=m.retry_count+1;
      if n>c.max_attempts then update public.campaign_customers set status='EXHAUSTED',updated_at=p_now where id=m.id; continue; end if;
      if allowance<=0 then continue; end if;
      -- Serialize phone queue admission across concurrent campaign ticks.
      perform pg_advisory_xact_lock(hashtextextended(m.phone_e164,7));
      if exists(select 1 from public.call_jobs j join public.campaign_customers other on other.id=j.membership_id where other.phone_e164=m.phone_e164 and j.campaign_id<>c.id and j.status in ('Pending','Claimed','Dispatched')) then
       perform pose_private.campaign_contact_block(m.id,'ACTIVE_CALL',p_now);continue;
      end if;
      insert into public.call_jobs(campaign_id,membership_id,attempt_no,scheduled_at,idempotency_key,created_at,updated_at) values(c.id,m.id,n,p_now,'campaign:'||c.id||':member:'||m.id||':attempt:'||n,p_now,p_now) on conflict do nothing;
      if found then added:=added+1; allowance:=allowance-1; end if;
      update public.campaign_customers set status='QUEUED',skip_reason=null,next_attempt_at=null,version=version+1,updated_at=p_now where id=m.id;
     end loop;
    end if;
   end if;
  end if;
  perform pose_private.campaign_complete(c.id);
  if before_state is distinct from pose_private.campaign_tick_state(c.id) then changed:=changed||jsonb_build_array(c.id); end if;
 end loop;
 return jsonb_build_object('jobs_created',added,'_changed_campaigns',changed);
end $$;
commit;
