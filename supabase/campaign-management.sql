-- Apply after calling-contract.sql and ai-agent.sql.
begin;
create table public.campaign_config_versions (
 campaign_id uuid not null references public.campaigns(id), config_version integer not null,
 snapshot jsonb not null, actor_id uuid not null references auth.users(id), reason text not null,
 created_at timestamptz not null default now(), primary key(campaign_id,config_version)
);
create table public.campaign_events (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id),
 actor_id uuid references auth.users(id), action text not null, reason text not null default '',
 snapshot jsonb not null, created_at timestamptz not null default now()
);
alter table public.campaigns add column provider_ready boolean not null default false;
alter table public.campaign_config_versions enable row level security;
alter table public.campaign_events enable row level security;
revoke all on public.campaign_config_versions,public.campaign_events from public,anon,authenticated;
grant select on public.campaign_config_versions,public.campaign_events to authenticated;
create policy config_admin on public.campaign_config_versions for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy campaign_events_admin on public.campaign_events for select to authenticated using ((select pose_private.staff_role())='Admin');

create function pose_private.campaign_admin() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account(); begin
 if pose_private.staff_role() is distinct from 'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 return actor;
end $$;
create function pose_private.contact_eligibility(p_lead uuid,p_campaign uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.leads; c public.customers; reason text; begin
 select * into l from public.leads where id=p_lead;
 select * into c from public.customers where id=l.customer_id;
 reason:=case
 when c.id is null or c.phone !~ '^\+[1-9][0-9]{7,14}$' or c.phone_verified_at is null then 'PHONE_UNVERIFIED'
 when not pose_private.consent_granted(c.phone,'Call') then 'NO_CALL_CONSENT'
 when not pose_private.consent_granted(c.phone,'AIVoice') then 'NO_AI_VOICE_CONSENT'
 when pose_private.phone_suppressed(c.phone) then 'SUPPRESSED'
 when l.archived or l.status in ('CONVERTED','LOST') then 'LEAD_CLOSED'
 when p_campaign is not null and not exists(select 1 from public.campaigns where id=p_campaign and status='RUNNING') then 'CAMPAIGN_NOT_RUNNING'
 when exists(select 1 from public.calls where phone_e164=c.phone and call_type<>'MOCK_CALL' and status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN')) then 'ACTIVE_CALL'
 when exists(select 1 from public.calls where phone_e164=c.phone and call_type<>'MOCK_CALL' and created_at>now()-interval '24 hours') then 'DAILY_CAP'
 when (select count(*) from public.calls where phone_e164=c.phone and call_type<>'MOCK_CALL' and created_at>now()-interval '7 days')>=3 then 'WEEKLY_CAP' end;
 return jsonb_build_object('eligible',reason is null,'reason',reason);
end $$;

create function pose_private.campaign_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE' using errcode='22023'; end $$;
create trigger config_immutable before update or delete on public.campaign_config_versions for each row execute function pose_private.campaign_immutable();
create trigger events_immutable before update or delete on public.campaign_events for each row execute function pose_private.campaign_immutable();
create function pose_private.script_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status<>'Draft' then raise exception 'PUBLISHED_IMMUTABLE' using errcode='22023'; end if;
 return new;
end $$;
create trigger script_immutable before update or delete on public.call_script_versions for each row execute function pose_private.script_immutable();

create function pose_private.script_valid(p_content jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; begin
 if jsonb_typeof(p_content) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_content) x where x not in ('greeting','ai_disclosure','purpose','consent_prompt','needs_questions','product_source','objections','opt_out','closing')) then return false; end if;
 foreach k in array array['greeting','ai_disclosure','purpose','closing'] loop
  if jsonb_typeof(p_content->k) is distinct from 'string' or length(btrim(p_content->>k)) not between 1 and 4000 then return false; end if;
 end loop;
 if p_content->>'ai_disclosure' !~* '\mAI\M' then return false; end if;
 if jsonb_typeof(p_content->'consent_prompt') is distinct from 'object' or jsonb_typeof(p_content->'opt_out') is distinct from 'object' then return false; end if;
 if exists(select 1 from jsonb_object_keys(p_content->'consent_prompt') x where x not in ('ai_voice','recording','transcript')) or exists(select 1 from jsonb_object_keys(p_content->'opt_out') x where x not in ('prompt','confirmation')) then return false; end if;
 foreach k in array array['ai_voice','recording','transcript'] loop
  if jsonb_typeof(p_content->'consent_prompt'->k) is distinct from 'string' or length(btrim(p_content->'consent_prompt'->>k)) not between 1 and 4000 then return false; end if;
 end loop;
 foreach k in array array['prompt','confirmation'] loop
  if jsonb_typeof(p_content->'opt_out'->k) is distinct from 'string' or length(btrim(p_content->'opt_out'->>k)) not between 1 and 4000 then return false; end if;
 end loop;
 if jsonb_typeof(p_content->'needs_questions') is distinct from 'array' or jsonb_array_length(p_content->'needs_questions') not between 1 and 30 then return false; end if;
 for v in select * from jsonb_array_elements(p_content->'needs_questions') loop
  if jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 4000 then return false; end if;
 end loop;
 if jsonb_typeof(p_content->'product_source') is distinct from 'object' or jsonb_typeof(p_content->'product_source'->'property_ids') is distinct from 'array' or jsonb_array_length(p_content->'product_source'->'property_ids')>500 then return false; end if;
 if exists(select 1 from jsonb_object_keys(p_content->'product_source') x where x<>'property_ids') then return false; end if;
 for v in select * from jsonb_array_elements(p_content->'product_source'->'property_ids') loop
  if jsonb_typeof(v)<>'string' or (v#>>'{}') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
 end loop;
 if jsonb_typeof(p_content->'objections') is distinct from 'array' or jsonb_array_length(p_content->'objections')>30 then return false; end if;
 for v in select * from jsonb_array_elements(p_content->'objections') loop
  if jsonb_typeof(v)<>'object' or jsonb_typeof(v->'trigger') is distinct from 'string' or jsonb_typeof(v->'response') is distinct from 'string' or length(btrim(v->>'trigger')) not between 1 and 4000 or length(btrim(v->>'response')) not between 1 and 4000 then return false; end if;
  if exists(select 1 from jsonb_object_keys(v) x where x not in ('trigger','response')) then return false; end if;
 end loop;
 return true;
end $$;
-- jsonb text is canonical in PostgreSQL, including sorted object keys.
create function pose_private.script_checksum(p_content jsonb) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(p_content::text,'UTF8')),'hex');
$$;
create function pose_private.save_call_script(p_script uuid,p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); s public.call_scripts; begin
 if p_script is null then insert into public.call_scripts(name,created_by) values(btrim(p_name),actor) returning * into s;
 else update public.call_scripts set name=btrim(p_name) where id=p_script returning * into s;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if; end if;
 return to_jsonb(s);
end $$;
create function pose_private.save_script_version(p_script uuid,p_version_id uuid,p_content jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); v public.call_script_versions; begin
 if not pose_private.script_valid(p_content) then raise exception 'INVALID_SCRIPT' using errcode='22023'; end if;
 perform 1 from public.call_scripts where id=p_script and not archived for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if p_version_id is null then
  insert into public.call_script_versions(script_id,version_no,content,checksum,created_by)
  select p_script,coalesce(max(version_no),0)+1,p_content,pose_private.script_checksum(p_content),actor from public.call_script_versions where script_id=p_script returning * into v;
 else
  update public.call_script_versions set content=p_content,checksum=pose_private.script_checksum(p_content) where id=p_version_id and script_id=p_script returning * into v;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 end if;
 return to_jsonb(v);
end $$;
create function pose_private.publish_script_version(p_version_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.call_script_versions; begin
 perform pose_private.campaign_admin();
 select * into v from public.call_script_versions where id=p_version_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if not pose_private.script_valid(v.content) then raise exception 'INVALID_SCRIPT' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements_text(v.content->'product_source'->'property_ids') x where not exists(select 1 from public.property_products where id=x::uuid and publication='Published')) then raise exception 'PRODUCT_NOT_PUBLISHED' using errcode='22023'; end if;
 update public.call_script_versions set status='Published',published_at=now() where id=p_version_id returning * into v;
 return to_jsonb(v);
end $$;
create function pose_private.new_script_version_from(p_version_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.call_script_versions; begin
 perform pose_private.campaign_admin(); select * into v from public.call_script_versions where id=p_version_id;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 return pose_private.save_script_version(v.script_id,null,v.content);
end $$;

create function pose_private.save_campaign(p_id uuid,p_version integer,p_data jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); c public.campaigns; old public.campaigns; k text; begin
 if jsonb_typeof(p_data) is distinct from 'object' or p_version is null or p_version<0 or length(coalesce(p_reason,''))>1000 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('name','description','objective','property_ids','start_time','end_time','timezone','window_start','window_end','weekdays','max_concurrent_calls','max_call_seconds','max_attempts','retry_after_hours','daily_call_limit','budget_limit_vnd','cost_reserve_per_call_vnd','script_version_id')) then raise exception 'INVALID_FIELD' using errcode='22023'; end if;
 foreach k in array array['max_concurrent_calls','max_call_seconds','max_attempts','retry_after_hours','daily_call_limit'] loop
  if p_data ? k and p_data->k<>'null'::jsonb and (jsonb_typeof(p_data->k)<>'number' or (p_data->>k)::numeric<>trunc((p_data->>k)::numeric)) then raise exception 'INVALID_INTEGER' using errcode='22023'; end if;
 end loop;
 foreach k in array array['name','description','objective','timezone','window_start','window_end','start_time','end_time','script_version_id'] loop
  if p_data ? k and p_data->k<>'null'::jsonb and jsonb_typeof(p_data->k)<>'string' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 end loop;
 foreach k in array array['budget_limit_vnd','cost_reserve_per_call_vnd'] loop
  if p_data ? k and p_data->k<>'null'::jsonb and jsonb_typeof(p_data->k)<>'number' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 end loop;
 if p_id is null then
  if p_version<>0 then raise exception 'INVALID_VERSION' using errcode='22023'; end if;
  insert into public.campaigns(name,created_by) values('',pose_private.current_directory_id()) returning * into old;
 else
  select * into old from public.campaigns where id=p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version<>old.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 end if;
 if old.status not in ('DRAFT','PAUSED','RUNNING','SCHEDULED') then raise exception 'TERMINAL_CAMPAIGN' using errcode='22023'; end if;
 if p_data ? 'weekdays' then
  if jsonb_typeof(p_data->'weekdays')<>'array' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_data->'weekdays') x where jsonb_typeof(x)<>'number' or (x#>>'{}')::numeric<>trunc((x#>>'{}')::numeric)) then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 end if;
 c:=jsonb_populate_record(old,p_data);
 if old.status in ('RUNNING','SCHEDULED') and to_jsonb(c) is distinct from to_jsonb(old) and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 if c.name is null or length(btrim(c.name)) not between 2 and 160 or length(c.description)>2000 or c.objective is null or not exists(select 1 from pg_timezone_names where name=c.timezone)
  or c.weekdays is null or cardinality(c.weekdays) not between 1 and 7 or exists(select 1 from unnest(c.weekdays) x where x is null or x not between 0 and 6)
  or c.window_start is null or c.window_end is null or c.max_concurrent_calls is null or c.max_call_seconds is null or c.max_attempts is null or c.retry_after_hours is null or c.property_ids is null or cardinality(c.property_ids)>500 then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 if exists(select 1 from unnest(c.property_ids) x where x is null or not exists(select 1 from public.property_products where id=x and publication='Published')) then raise exception 'PRODUCT_NOT_PUBLISHED' using errcode='22023'; end if;
 if c.script_version_id is not null and not exists(select 1 from public.call_script_versions where id=c.script_version_id and status='Published') then raise exception 'SCRIPT_NOT_PUBLISHED' using errcode='22023'; end if;
 update public.campaigns set name=btrim(c.name),description=c.description,objective=c.objective,property_ids=c.property_ids,script_version_id=c.script_version_id,start_time=c.start_time,end_time=c.end_time,timezone=c.timezone,window_start=c.window_start,window_end=c.window_end,weekdays=c.weekdays,max_concurrent_calls=c.max_concurrent_calls,max_call_seconds=c.max_call_seconds,max_attempts=c.max_attempts,retry_after_hours=c.retry_after_hours,daily_call_limit=c.daily_call_limit,budget_limit_vnd=c.budget_limit_vnd,cost_reserve_per_call_vnd=c.cost_reserve_per_call_vnd,config_version=old.config_version+1,version=case when p_id is null then 0 else old.version+1 end,updated_at=now() where id=old.id returning * into c;
 insert into public.campaign_config_versions values(c.id,c.config_version,to_jsonb(c),actor,coalesce(p_reason,''),now());
 return to_jsonb(c);
end $$;

create function pose_private.campaign_filter(p_filter jsonb) returns void language plpgsql set search_path='' as $$
declare k text; begin
 if jsonb_typeof(p_filter) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filter) x where x not in ('temperature','lead_status','source','created_from','created_to','lead_ids')) then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
 foreach k in array array['temperature','lead_status','source','lead_ids'] loop
  if p_filter ? k then
   if jsonb_typeof(p_filter->k)<>'array' or jsonb_array_length(p_filter->k)>500 then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
   if exists(select 1 from jsonb_array_elements(p_filter->k) x where jsonb_typeof(x)<>'string') then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements_text(p_filter->'temperature') x where x not in ('HOT','WARM','COLD','UNRATED')) or exists(select 1 from jsonb_array_elements_text(p_filter->'lead_status') x where x not in ('NEW','CONTACTED','QUALIFIED','FOLLOW_UP','CONVERTED','LOST')) or exists(select 1 from jsonb_array_elements_text(p_filter->'source') x where x not in ('Inquiry','WebChat','Call','Manual','Import')) then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
 perform x::uuid from jsonb_array_elements_text(p_filter->'lead_ids') x;
 perform (p_filter->>'created_from')::timestamptz,(p_filter->>'created_to')::timestamptz;
 if (p_filter->>'created_from')::timestamptz>(p_filter->>'created_to')::timestamptz then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
end $$;
create function pose_private.campaign_audience(p_filter jsonb) returns setof public.leads language sql stable security definer set search_path='' as $$
 select l.* from public.leads l where
 (not p_filter ? 'temperature' or coalesce(l.temperature::text,'UNRATED') in (select jsonb_array_elements_text(p_filter->'temperature')))
 and (not p_filter ? 'lead_status' or l.status::text in (select jsonb_array_elements_text(p_filter->'lead_status')))
 and (not p_filter ? 'source' or l.source in (select jsonb_array_elements_text(p_filter->'source')))
 and (not p_filter ? 'lead_ids' or l.id in (select x::uuid from jsonb_array_elements_text(p_filter->'lead_ids') x))
 and (p_filter->>'created_from' is null or l.created_at>=(p_filter->>'created_from')::timestamptz)
 and (p_filter->>'created_to' is null or l.created_at<=(p_filter->>'created_to')::timestamptz) order by l.id;
$$;
create function pose_private.preview_campaign_audience(p_campaign uuid,p_filter jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 perform pose_private.campaign_admin(); perform pose_private.campaign_filter(p_filter);
 if not exists(select 1 from public.campaigns where id=p_campaign) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 with a as materialized (select l.id,c.full_name,'***'||right(c.phone,4) phone,pose_private.contact_eligibility(l.id,null)->>'reason' reason from pose_private.campaign_audience(p_filter) l join public.customers c on c.id=l.customer_id)
 select jsonb_build_object('total',count(*),'eligible',count(*) filter(where reason is null),'skipped',coalesce((select jsonb_object_agg(reason,n) from (select reason,count(*) n from a where reason is not null group by reason) s),'{}'),'sample',coalesce((select jsonb_agg(to_jsonb(s)) from (select * from a limit 20) s),'[]')) into result from a;
 return result;
end $$;
create function pose_private.set_campaign_audience(p_campaign uuid,p_version integer,p_filter jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); c public.campaigns; l public.leads; cust public.customers; e jsonb; begin
 perform pose_private.campaign_filter(p_filter);
 if length(coalesce(p_reason,''))>1000 then raise exception 'INVALID_REASON' using errcode='22023'; end if;
 select * into c from public.campaigns where id=p_campaign for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if p_version is distinct from c.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 if c.status not in ('DRAFT','PAUSED') then raise exception 'AUDIENCE_LOCKED' using errcode='22023'; end if;
 for l in select * from pose_private.campaign_audience(p_filter) loop
  select * into cust from public.customers where id=l.customer_id; e:=pose_private.contact_eligibility(l.id,null);
  insert into public.campaign_customers(campaign_id,customer_id,lead_id,phone_e164,snapshot,status,skip_reason)
  values(c.id,cust.id,l.id,case when cust.phone ~ '^\+[1-9][0-9]{7,14}$' then cust.phone end,jsonb_build_object('lead',to_jsonb(l),'customer',jsonb_build_object('id',cust.id,'full_name',cust.full_name,'phone',cust.phone,'phone_verified_at',cust.phone_verified_at)),case when (e->>'eligible')::boolean then 'PENDING' else 'SKIPPED' end,e->>'reason')
  on conflict(campaign_id,customer_id) do update set snapshot=excluded.snapshot,phone_e164=excluded.phone_e164,skip_reason=excluded.skip_reason,status=excluded.status,version=campaign_customers.version+1,updated_at=now() where campaign_customers.status='PENDING';
 end loop;
 update public.campaigns set version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.campaign_events(campaign_id,actor_id,action,reason,snapshot) values(c.id,actor,'audience',coalesce(p_reason,''),p_filter);
 return jsonb_build_object('campaign',to_jsonb(c),'preview',pose_private.preview_campaign_audience(c.id,p_filter));
end $$;

create function pose_private.campaign_preflight(p_campaign uuid,p_provider_ready boolean,p_now timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.campaigns; missing jsonb:='[]'; begin
 select * into c from public.campaigns where id=p_campaign;
 if length(btrim(c.name))<2 then missing:=missing||'"NAME"'::jsonb; end if;
 if not exists(select 1 from public.call_script_versions where id=c.script_version_id and status='Published') then missing:=missing||'"PUBLISHED_SCRIPT"'::jsonb; end if;
 if not exists(select 1 from public.campaign_customers m where m.campaign_id=c.id and m.status in ('PENDING','RETRYING') and (pose_private.contact_eligibility(m.lead_id,null)->>'eligible')::boolean and m.phone_e164=(select phone from public.customers where id=m.customer_id)) then missing:=missing||'"ELIGIBLE_AUDIENCE"'::jsonb; end if;
 if c.budget_limit_vnd is null or c.cost_reserve_per_call_vnd is null or c.budget_limit_vnd-c.budget_spent_vnd-c.budget_reserved_vnd<c.cost_reserve_per_call_vnd then missing:=missing||'"BUDGET"'::jsonb; end if;
 if c.daily_call_limit is null then missing:=missing||'"DAILY_LIMIT"'::jsonb; end if;
 if c.end_time is not null and c.end_time<=p_now then missing:=missing||'"END_TIME"'::jsonb; end if;
 if not coalesce(p_provider_ready,false) then missing:=missing||'"TELEPHONY_NOT_CONFIGURED"'::jsonb; end if;
 return missing;
end $$;
create function pose_private.campaign_recheck(p_campaign uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.campaign_customers; reason text; begin
 for m in select * from public.campaign_customers where campaign_id=p_campaign and status in ('PENDING','RETRYING','QUEUED') for update loop
  reason:=pose_private.contact_eligibility(m.lead_id,null)->>'reason';
  if m.phone_e164 is distinct from (select phone from public.customers where id=m.customer_id) then reason:='PHONE_UNVERIFIED'; end if;
  if reason is not null then
   update public.campaign_customers set status=case when reason in ('SUPPRESSED','NO_CALL_CONSENT','NO_AI_VOICE_CONSENT') then 'OPTED_OUT' else 'SKIPPED' end,skip_reason=reason,version=version+1,updated_at=now() where id=m.id;
   update public.call_jobs set status='Cancelled',cancel_reason=reason,updated_at=now() where membership_id=m.id and status in ('Pending','Claimed');
  end if;
 end loop;
end $$;
create function pose_private.campaign_action(p_campaign uuid,p_version integer,p_action text,p_reason text,p_provider_ready boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); c public.campaigns; target public.campaign_status; missing jsonb; begin
 select * into c from public.campaigns where id=p_campaign for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if p_version is distinct from c.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 target:=case
 when p_action='schedule' and c.status='DRAFT' and c.start_time>now() then 'SCHEDULED'::public.campaign_status
 when p_action='start' and c.status in ('DRAFT','SCHEDULED') then 'RUNNING'::public.campaign_status
 when p_action='pause' and c.status='RUNNING' then 'PAUSED'::public.campaign_status
 when p_action='resume' and c.status='PAUSED' then 'RUNNING'::public.campaign_status
 when p_action='cancel' and c.status in ('DRAFT','SCHEDULED','RUNNING','PAUSED') then 'CANCELLED'::public.campaign_status end;
 if target is null then raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
 if length(coalesce(p_reason,''))>1000 or p_action='cancel' and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 if p_action in ('schedule','start','resume') then
  missing:=pose_private.campaign_preflight(c.id,p_provider_ready,now());
  if missing<>'[]'::jsonb then raise exception 'PREFLIGHT_FAILED' using errcode='22023',detail=missing::text; end if;
  perform pose_private.campaign_recheck(c.id);
 end if;
 if p_action='cancel' then
  update public.call_jobs set status='Cancelled',cancel_reason=p_reason,updated_at=now() where campaign_id=c.id and status in ('Pending','Claimed');
  update public.campaign_customers set status='CANCELLED',version=version+1,updated_at=now() where campaign_id=c.id and status in ('PENDING','QUEUED','IN_PROGRESS','RETRYING');
 end if;
 update public.campaigns set status=target,status_reason=coalesce(p_reason,''),provider_ready=p_provider_ready,version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.campaign_events(campaign_id,actor_id,action,reason,snapshot) values(c.id,actor,p_action,coalesce(p_reason,''),to_jsonb(c));
 return to_jsonb(c);
end $$;

create function pose_private.campaign_complete(p_campaign uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.campaigns c set status='COMPLETED',version=version+1,updated_at=now() where c.id=p_campaign and c.status in ('RUNNING','PAUSED')
 and not exists(select 1 from public.campaign_customers where campaign_id=c.id and status in ('PENDING','QUEUED','IN_PROGRESS','RETRYING'))
 and not exists(select 1 from public.call_jobs where campaign_id=c.id and status in ('Pending','Claimed','Dispatched'))
 and not exists(select 1 from public.calls where campaign_id=c.id and status in ('WAITING','CALLING','RINGING','ANSWERED','ENDING','UNKNOWN','RETRY'));
end $$;
create function pose_private.system_campaign_tick(p_now timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.campaigns; m public.campaign_customers; local_now timestamp; allowance integer; queued integer; added integer:=0; missing jsonb; reason text; n integer; begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if;
 if p_now is null then raise exception 'INVALID_TIME' using errcode='22023'; end if;
 for c in select * from public.campaigns where status in ('SCHEDULED','RUNNING','PAUSED') order by id for update skip locked loop
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
     for m in select * from public.campaign_customers where campaign_id=c.id and (status='PENDING' or status='RETRYING' and next_attempt_at<=p_now) order by added_at,id for update loop
      reason:=pose_private.contact_eligibility(m.lead_id,c.id)->>'reason';
      if m.phone_e164 is distinct from (select phone from public.customers where id=m.customer_id) then reason:='PHONE_UNVERIFIED'; end if;
      if reason is not null then
       update public.campaign_customers set status=case when reason in ('SUPPRESSED','NO_CALL_CONSENT','NO_AI_VOICE_CONSENT') then 'OPTED_OUT' else 'SKIPPED' end,skip_reason=reason,version=version+1,updated_at=p_now where id=m.id;
       continue;
      end if;
      n:=m.retry_count+1;
      if n>c.max_attempts then update public.campaign_customers set status='EXHAUSTED',updated_at=p_now where id=m.id; continue; end if;
      if allowance<=0 then continue; end if;
      insert into public.call_jobs(campaign_id,membership_id,attempt_no,scheduled_at,idempotency_key,created_at,updated_at) values(c.id,m.id,n,p_now,'campaign:'||c.id||':member:'||m.id||':attempt:'||n,p_now,p_now) on conflict do nothing;
      if found then added:=added+1; allowance:=allowance-1; end if;
      update public.campaign_customers set status='QUEUED',version=version+1,updated_at=p_now where id=m.id;
     end loop;
    end if;
   end if;
  end if;
  perform pose_private.campaign_complete(c.id);
 end loop;
 return jsonb_build_object('jobs_created',added);
end $$;
create function pose_private.campaign_progress(p_campaign uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.campaigns; result jsonb; begin
 perform pose_private.campaign_admin();
 perform 1 from public.campaigns where id=p_campaign for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 perform pose_private.campaign_complete(p_campaign);
 select * into c from public.campaigns where id=p_campaign;
 select jsonb_build_object('campaign',to_jsonb(c),'total',(select count(*) from public.campaign_customers where campaign_id=c.id),
 'memberships',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.campaign_customers where campaign_id=c.id group by status) s),'{}'),
 'jobs',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.call_jobs where campaign_id=c.id group by status) s),'{}'),
 'calls',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.calls where campaign_id=c.id group by status) s),'{}'),
 'connected',(select count(*) from public.calls where campaign_id=c.id and answered_at is not null),
 'completed',(select count(*) from public.calls where campaign_id=c.id and status='COMPLETED'),
 'cost_reserved_vnd',c.budget_reserved_vnd,'cost_spent_vnd',c.budget_spent_vnd,
 'errors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'error_code',error_code)) from public.calls where campaign_id=c.id and status='FAILED'),'[]'),
 'reconciliation',coalesce((select jsonb_agg(to_jsonb(s)) from (select 'job' kind,id,status,updated_at from public.call_jobs where campaign_id=c.id and status='Dispatched' and updated_at<now()-interval '15 minutes' union all select 'call',id,status::text,updated_at from public.calls where campaign_id=c.id and status in ('UNKNOWN','CALLING') and updated_at<now()-interval '15 minutes') s),'[]')) into result;
 return result;
end $$;
create function pose_private.admin_campaign_preflight(p_campaign uuid,p_provider_ready boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pose_private.campaign_admin();
 if not exists(select 1 from public.campaigns where id=p_campaign) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 return pose_private.campaign_preflight(p_campaign,p_provider_ready,now());
end $$;
create function public.pose_campaign_preflight(p_campaign uuid,p_provider_ready boolean) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.admin_campaign_preflight(p_campaign,p_provider_ready); $$;
revoke all on function public.pose_campaign_preflight(uuid,boolean),pose_private.admin_campaign_preflight(uuid,boolean) from public,anon;
grant execute on function public.pose_campaign_preflight(uuid,boolean),pose_private.admin_campaign_preflight(uuid,boolean) to authenticated;
create function public.pose_save_campaign(p_id uuid,p_version integer,p_data jsonb,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.save_campaign(p_id,p_version,p_data,p_reason); $$;
revoke all on function public.pose_save_campaign(uuid,integer,jsonb,text),pose_private.save_campaign(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.pose_save_campaign(uuid,integer,jsonb,text),pose_private.save_campaign(uuid,integer,jsonb,text) to authenticated;
create function public.pose_preview_campaign_audience(p_campaign uuid,p_filter jsonb) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.preview_campaign_audience(p_campaign,p_filter); $$;
revoke all on function public.pose_preview_campaign_audience(uuid,jsonb),pose_private.preview_campaign_audience(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pose_preview_campaign_audience(uuid,jsonb),pose_private.preview_campaign_audience(uuid,jsonb) to authenticated;
create function public.pose_set_campaign_audience(p_campaign uuid,p_version integer,p_filter jsonb,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.set_campaign_audience(p_campaign,p_version,p_filter,p_reason); $$;
revoke all on function public.pose_set_campaign_audience(uuid,integer,jsonb,text),pose_private.set_campaign_audience(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.pose_set_campaign_audience(uuid,integer,jsonb,text),pose_private.set_campaign_audience(uuid,integer,jsonb,text) to authenticated;
create function public.pose_save_call_script(p_script uuid,p_name text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.save_call_script(p_script,p_name); $$;
revoke all on function public.pose_save_call_script(uuid,text),pose_private.save_call_script(uuid,text) from public,anon,authenticated;
grant execute on function public.pose_save_call_script(uuid,text),pose_private.save_call_script(uuid,text) to authenticated;
create function public.pose_save_script_version(p_script uuid,p_version_id uuid,p_content jsonb) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.save_script_version(p_script,p_version_id,p_content); $$;
revoke all on function public.pose_save_script_version(uuid,uuid,jsonb),pose_private.save_script_version(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pose_save_script_version(uuid,uuid,jsonb),pose_private.save_script_version(uuid,uuid,jsonb) to authenticated;
create function public.pose_publish_script_version(p_version_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.publish_script_version(p_version_id); $$;
revoke all on function public.pose_publish_script_version(uuid),pose_private.publish_script_version(uuid) from public,anon,authenticated;
grant execute on function public.pose_publish_script_version(uuid),pose_private.publish_script_version(uuid) to authenticated;
create function public.pose_new_script_version_from(p_version_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.new_script_version_from(p_version_id); $$;
revoke all on function public.pose_new_script_version_from(uuid),pose_private.new_script_version_from(uuid) from public,anon,authenticated;
grant execute on function public.pose_new_script_version_from(uuid),pose_private.new_script_version_from(uuid) to authenticated;
create function public.pose_campaign_action(p_campaign uuid,p_version integer,p_action text,p_reason text,p_provider_ready boolean) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.campaign_action(p_campaign,p_version,p_action,p_reason,p_provider_ready); $$;
revoke all on function public.pose_campaign_action(uuid,integer,text,text,boolean),pose_private.campaign_action(uuid,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.pose_campaign_action(uuid,integer,text,text,boolean),pose_private.campaign_action(uuid,integer,text,text,boolean) to authenticated;
create function public.pose_campaign_progress(p_campaign uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.campaign_progress(p_campaign); $$;
revoke all on function public.pose_campaign_progress(uuid),pose_private.campaign_progress(uuid) from public,anon,authenticated;
grant execute on function public.pose_campaign_progress(uuid),pose_private.campaign_progress(uuid) to authenticated;
create function public.pose_system_campaign_tick(p_now timestamptz) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.system_campaign_tick(p_now); $$;
revoke all on function public.pose_system_campaign_tick(timestamptz),pose_private.system_campaign_tick(timestamptz) from public,anon,authenticated;
grant execute on function public.pose_system_campaign_tick(timestamptz),pose_private.system_campaign_tick(timestamptz) to service_role;
revoke all on function pose_private.contact_eligibility(uuid,uuid),pose_private.campaign_admin(),pose_private.campaign_filter(jsonb),pose_private.campaign_audience(jsonb),pose_private.campaign_preflight(uuid,boolean,timestamptz),pose_private.campaign_recheck(uuid),pose_private.campaign_complete(uuid),pose_private.script_valid(jsonb),pose_private.script_checksum(jsonb),pose_private.campaign_immutable(),pose_private.script_immutable() from public,anon,authenticated;
commit;
