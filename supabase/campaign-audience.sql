-- M07 audience scoring and customer contact settings. Apply after
-- campaign-management.sql, ai-agent-tools.sql and property-discovery.sql.
begin;

alter table public.contact_consents add column if not exists source_ref text;
create unique index if not exists contact_consents_source_ref_idx
  on public.contact_consents(source_ref,purpose) where source_ref is not null;
alter table public.campaign_customers add column if not exists priority integer not null default 0;
create index if not exists campaign_customers_priority_idx on public.campaign_customers(campaign_id,priority desc,id);

-- The base discovery module names favorites customer_property_favorites. These
-- small activity tables keep the scorer compatible with deployments that also
-- record views/favorites as first-class events.
create table if not exists public.property_views (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  property_id uuid not null references public.property_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (customer_id is not null or user_id is not null)
);
create index if not exists property_views_match_idx on public.property_views(property_id,created_at desc);
create table if not exists public.property_favorites (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  property_id uuid not null references public.property_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (customer_id is not null or user_id is not null)
);
create index if not exists property_favorites_match_idx on public.property_favorites(property_id,created_at desc);

create or replace function pose_private.inquiry_consent_bridge() returns trigger
language plpgsql security definer set search_path='' as $$
declare x record; evidence jsonb; purpose text;
begin
  if new.customer_id is null or not new.phone_verified then return new; end if;
  for x in select * from jsonb_each(coalesce(new.consent,'{}'::jsonb)) loop
    purpose:=case x.key when 'call' then 'Call' when 'ai' then 'AIVoice'
      when 'transcript' then 'Transcript' when 'recording' then 'Recording' end;
    if purpose is not null and x.value='true'::jsonb then
      insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version,source_ref)
      select new.phone,new.customer_id,new.lead_id,purpose,'Granted','Web','Inquiry form',new.id::text||': '||coalesce(evidence->>'status',x.key),coalesce(evidence->>'version','CONTACT_POLICY_VERSION'),new.id::text
      from (select coalesce((select z from jsonb_array_elements(coalesce(new.consent_evidence,'[]'::jsonb)) z where z->>'purpose'=x.key limit 1),'{}'::jsonb) evidence) q
      on conflict (source_ref,purpose) where source_ref is not null do nothing;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists property_inquiry_consent_bridge on public.property_inquiries;
create trigger property_inquiry_consent_bridge after insert or update of phone_verified,customer_id,consent,consent_evidence
  on public.property_inquiries for each row execute function pose_private.inquiry_consent_bridge();

insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version,source_ref)
select i.phone,i.customer_id,i.lead_id,
  case x->>'purpose' when 'call' then 'Call' when 'ai' then 'AIVoice' when 'transcript' then 'Transcript' when 'recording' then 'Recording' end,
  'Granted','Web','Inquiry form',i.id::text||': '||(x->>'purpose'),
  coalesce(x->>'version','CONTACT_POLICY_VERSION'),i.id::text
from public.property_inquiries i cross join lateral jsonb_array_elements(coalesce(i.consent_evidence,'[]'::jsonb)) x
where i.phone_verified and i.customer_id is not null
  and x->>'purpose' in ('call','ai','transcript','recording') and coalesce(x->>'status','')='Granted'
  and x->>'purpose' is not null
on conflict (source_ref,purpose) where source_ref is not null do nothing;

create or replace function pose_private.lead_campaign_match(p_lead uuid,p_campaign uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.leads; c public.customers; camp public.campaigns; p record; n jsonb; v jsonb;
  budget_min numeric; budget_max numeric; locations text[]; types text[]; transaction_want text;
  b integer:=0; a integer:=0; d integer:=0; r integer:=0; score integer; unknown text[]:='{}'; reasons text[]:='{}';
  has_location boolean:=false; has_type boolean:=false; has_interest boolean:=false; last_activity timestamptz;
  product_names text:=''; product_count integer:=0;
begin
  select * into l from public.leads where id=p_lead;
  if l.id is null then return jsonb_build_object('rule_version','MATCH.v1','score',0,'unknown',array['lead'],'reasons','[]'::jsonb); end if;
  select * into c from public.customers where id=l.customer_id;
  select * into camp from public.campaigns where id=p_campaign;
  n:=coalesce(l.needs,'{}'::jsonb);
  budget_min:=nullif(coalesce(n->'budget_min'->>'value',n->>'budget_min'),'')::numeric;
  budget_max:=nullif(coalesce(n->'budget_max'->>'value',n->>'budget_max'),'')::numeric;
  if budget_min is null and budget_max is null then unknown:=array_append(unknown,'budget'); end if;
  locations:=array(select lower(x) from jsonb_array_elements_text(coalesce(n->'locations'->'value',n->'locations','[]'::jsonb)) x);
  if cardinality(locations)=0 and jsonb_typeof(n->'preferred_location')='string' then locations:=array[lower(n->>'preferred_location')]; end if;
  types:=array(select lower(x) from jsonb_array_elements_text(coalesce(n->'property_types'->'value',n->'property_types','[]'::jsonb)) x);
  if cardinality(locations)=0 then unknown:=array_append(unknown,'location'); end if;
  if cardinality(types)=0 then unknown:=array_append(unknown,'property_type'); end if;
  transaction_want:=lower(coalesce(n->'transaction'->>'value',n->>'transaction',n->'intent'->>'value',n->>'intent'));
  if transaction_want is null then unknown:=array_append(unknown,'transaction'); end if;
  for p in select pp.* from public.property_products pp where pp.id=any(coalesce(camp.property_ids,'{}'::uuid[])) and pp.publication='Published' loop
    product_count:=product_count+1;
    if budget_min is not null or budget_max is not null then
      if p.price is null then unknown:=array_append(unknown,'price:'||p.code);
      elsif (budget_min is null or p.price>=budget_min) and (budget_max is null or p.price<=budget_max) then b:=30;
      elsif (budget_min is null or p.price>=budget_min*0.8) and (budget_max is null or p.price<=budget_max*1.2) then b:=greatest(b,15); end if;
    end if;
    if cardinality(locations)>0 then has_location:=has_location or exists(select 1 from unnest(locations) z where lower(p.location) like '%'||z||'%'); end if;
    if cardinality(types)>0 then has_type:=has_type or lower(p.property_type)=any(types); end if;
    if product_names='' then product_names:=p.code; else product_names:=product_names||', '||p.code; end if;
  end loop;
  if cardinality(locations)>0 or cardinality(types)>0 then
    a:=case when has_location and has_type then 25 when has_location or has_type then 12 else 0 end;
  end if;
  if transaction_want like '%rent%' and exists(select 1 from public.property_products pp where pp.id=any(coalesce(camp.property_ids,'{}'::uuid[])) and pp.publication='Published') and not exists(select 1 from public.property_products pp where pp.id=any(camp.property_ids) and pp.publication='Published' and lower(coalesce(pp.description,'')) like '%rent%') then
    return jsonb_build_object('rule_version','MATCH.v1','score',0,'excluded','TRANSACTION_MISMATCH','breakdown',jsonb_build_object('budget',b,'area_type',a,'direct_interest',0,'recency',0),'unknown',to_jsonb(unknown),'reasons',to_jsonb(reasons));
  end if;
  has_interest:=exists(select 1 from public.customer_property_favorites f where f.user_id=c.auth_user_id and f.property_id=any(coalesce(camp.property_ids,'{}'::uuid[])))
    or exists(select 1 from public.property_favorites f where (f.customer_id=c.id or f.user_id=c.auth_user_id) and f.property_id=any(coalesce(camp.property_ids,'{}'::uuid[])))
    or exists(select 1 from public.property_views f where (f.customer_id=c.id or f.user_id=c.auth_user_id) and f.property_id=any(coalesce(camp.property_ids,'{}'::uuid[])))
    or exists(select 1 from public.property_inquiries i where i.customer_id=c.id and i.property_id=any(coalesce(camp.property_ids,'{}'::uuid[])))
    or exists(select 1 from unnest(pose_private.ai_interest_ids(l.id)) x where x=any(coalesce(camp.property_ids,'{}'::uuid[])));
  if has_interest then d:=20; end if;
  select greatest((select max(s.last_message_at) from public.ai_chat_sessions s where s.lead_id=l.id),(select max(i.created_at) from public.property_inquiries i where i.lead_id=l.id),(select max(v.created_at) from public.property_views v where v.customer_id=c.id),(select max(f.created_at) from public.customer_property_favorites f where f.user_id=c.auth_user_id),(select max(x.created_at) from public.calls x where x.lead_id=l.id)) into last_activity;
  if last_activity is null then unknown:=array_append(unknown,'recency'); else r:=case when last_activity>=now()-interval '7 days' then 10 when last_activity>=now()-interval '30 days' then 5 else 0 end; end if;
  score:=least(85,b+a+d+r);
  if b>0 then reasons:=array_append(reasons,'Ngân sách khớp sản phẩm '||coalesce(product_names,'chiến dịch')); end if;
  if a>0 then reasons:=array_append(reasons,'Quan tâm khu vực hoặc loại sản phẩm'); end if;
  if has_interest then reasons:=array_append(reasons,'Đã quan tâm sản phẩm '||coalesce(product_names,'chiến dịch')); end if;
  if r>0 then reasons:=array_append(reasons,'Hoạt động gần đây'); end if;
  return jsonb_build_object('rule_version','MATCH.v1','score',score,'breakdown',jsonb_build_object('budget',b,'area_type',a,'direct_interest',d,'recency',r),'unknown',to_jsonb(unknown),'reasons',to_jsonb(reasons));
end $$;
revoke all on function pose_private.lead_campaign_match(uuid,uuid) from public,anon,authenticated;

create or replace function pose_private.campaign_filter(p_filter jsonb) returns void language plpgsql set search_path='' as $$
declare k text; begin
 if jsonb_typeof(p_filter) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filter) x where x not in ('temperature','lead_status','source','created_from','created_to','lead_ids','match_campaign_products','min_match','needs_location','needs_property_type','timeline','interacted_days','exclude_called_days','confirmed_needs_only')) then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
 foreach k in array array['temperature','lead_status','source','lead_ids','needs_location','needs_property_type','timeline'] loop
  if p_filter ? k and (jsonb_typeof(p_filter->k)<>'array' or jsonb_array_length(p_filter->k)>500 or exists(select 1 from jsonb_array_elements(p_filter->k) x where jsonb_typeof(x)<>'string')) then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
 end loop;
 if p_filter ? 'match_campaign_products' and jsonb_typeof(p_filter->'match_campaign_products')<>'boolean' then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
 if p_filter ? 'min_match' and (jsonb_typeof(p_filter->'min_match')<>'number' or (p_filter->>'min_match')::numeric not between 0 and 85) then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
 foreach k in array array['interacted_days','exclude_called_days'] loop if p_filter ? k and (jsonb_typeof(p_filter->k)<>'number' or (p_filter->>k) !~ '^[0-9]+$' or case when (p_filter->>k) ~ '^[0-9]+$' then (p_filter->>k)::integer else 0 end not between 1 and case when k='interacted_days' then 365 else 90 end) then raise exception 'INVALID_FILTER' using errcode='22023'; end if; end loop;
 if p_filter ? 'confirmed_needs_only' and jsonb_typeof(p_filter->'confirmed_needs_only')<>'boolean' then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
end $$;

create or replace function pose_private.campaign_audience(p_filter jsonb) returns setof public.leads language sql stable security definer set search_path='' as $$
 select l.* from public.leads l where
 (not p_filter ? 'temperature' or coalesce(l.temperature::text,'UNRATED') in (select jsonb_array_elements_text(p_filter->'temperature')))
 and (not p_filter ? 'lead_status' or l.status::text in (select jsonb_array_elements_text(p_filter->'lead_status')))
 and (not p_filter ? 'source' or l.source in (select jsonb_array_elements_text(p_filter->'source')))
 and (not p_filter ? 'lead_ids' or l.id in (select x::uuid from jsonb_array_elements_text(p_filter->'lead_ids') x))
 and (p_filter->>'created_from' is null or l.created_at>=(p_filter->>'created_from')::timestamptz)
 and (p_filter->>'created_to' is null or l.created_at<=(p_filter->>'created_to')::timestamptz)
 and (not p_filter ? 'confirmed_needs_only' or (p_filter->>'confirmed_needs_only')::boolean=false or exists(select 1 from jsonb_each(l.needs) n where n.value ? 'confirmed_by'))
 and (not p_filter ? 'needs_location' or exists(select 1 from jsonb_array_elements_text(coalesce(l.needs->'locations'->'value',l.needs->'locations','[]'::jsonb)) x where lower(x) in (select lower(z) from jsonb_array_elements_text(p_filter->'needs_location') z)))
 and (not p_filter ? 'needs_property_type' or exists(select 1 from jsonb_array_elements_text(coalesce(l.needs->'property_types'->'value',l.needs->'property_types','[]'::jsonb)) x where lower(x) in (select lower(z) from jsonb_array_elements_text(p_filter->'needs_property_type') z)))
 and (not p_filter ? 'timeline' or coalesce(l.needs->'timeline'->>'value',l.needs->>'timeline','none') in (select jsonb_array_elements_text(p_filter->'timeline')))
 and (not p_filter ? 'interacted_days' or exists(select 1 from public.property_inquiries i where i.lead_id=l.id and i.created_at>=now()-((p_filter->>'interacted_days')::integer||' days')::interval)
   or exists(select 1 from public.ai_chat_sessions s where s.lead_id=l.id and s.last_message_at>=now()-((p_filter->>'interacted_days')::integer||' days')::interval))
 and (not p_filter ? 'exclude_called_days' or not exists(select 1 from public.calls x join public.customers cc on cc.phone=coalesce(x.phone_e164,'') where cc.id=l.customer_id and x.created_at>=now()-((p_filter->>'exclude_called_days')::integer||' days')::interval));
$$;

create or replace function pose_private.preview_campaign_audience(p_campaign uuid,p_filter jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); row record; e jsonb; m jsonb; result jsonb:='[]'; total integer:=0; eligible integer:=0; matched integer:=0; deferred jsonb:='{}'; skipped jsonb:='{}'; excluded jsonb:='{}'; threshold integer; use_match boolean;
begin
 perform pose_private.campaign_filter(p_filter); perform 1 from public.campaigns where id=p_campaign; if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 use_match:=coalesce((p_filter->>'match_campaign_products')::boolean,false); threshold:=case when use_match then coalesce((p_filter->>'min_match')::integer,40) else 0 end;
 for row in select l.id,l.customer_id,l.temperature,l.updated_at,c.full_name,c.phone from pose_private.campaign_audience(p_filter) l join public.customers c on c.id=l.customer_id loop
  total:=total+1; e:=pose_private.contact_eligibility(row.id,null); m:=case when use_match then pose_private.lead_campaign_match(row.id,p_campaign) else jsonb_build_object('rule_version','MATCH.v1','score',0,'reasons','[]'::jsonb) end;
  if e->>'reason' is null then eligible:=eligible+1; elsif pose_private.contact_block_kind(e->>'reason')='Temporary' then deferred:=jsonb_set(deferred,array[e->>'reason'],to_jsonb(coalesce((deferred->>(e->>'reason'))::integer,0)+1),true); else skipped:=jsonb_set(skipped,array[e->>'reason'],to_jsonb(coalesce((skipped->>(e->>'reason'))::integer,0)+1),true); end if;
  if e->>'reason' is null and (m->>'excluded') is not null then excluded:=jsonb_set(excluded,array[m->>'excluded'],to_jsonb(coalesce((excluded->>(m->>'excluded'))::integer,0)+1),true);
  elsif e->>'reason' is null and use_match and (m->>'score')::integer<threshold then excluded:=jsonb_set(excluded,'{LOW_MATCH}',to_jsonb(coalesce((excluded->>'LOW_MATCH')::integer,0)+1),true); else if e->>'reason' is null and (not use_match or (m->>'score')::integer>=threshold) then matched:=matched+1; end if; end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',row.id,'full_name',row.full_name,'phone','***'||right(row.phone,4),'temperature',coalesce(row.temperature::text,'UNRATED'),'score',coalesce((m->>'score')::integer,0),'match_score',coalesce((m->>'score')::integer,0),'reasons',coalesce(m->'reasons','[]'::jsonb),'skip_reason',coalesce(e->>'reason',m->>'excluded')));
 end loop;
 return jsonb_build_object('total',total,'eligible',eligible,'matched',matched,'deferred',deferred,'skipped',skipped,'excluded',excluded,'sample',coalesce((select jsonb_agg(x order by (x->>'match_score')::integer desc,case x->>'temperature' when 'HOT' then 4 when 'WARM' then 3 when 'COLD' then 2 else 1 end desc) from jsonb_array_elements(result) x limit 20),'[]'::jsonb));
end $$;

create or replace function pose_private.set_campaign_audience(p_campaign uuid,p_version integer,p_filter jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); c public.campaigns; l public.leads; cust public.customers; e jsonb; m jsonb; use_match boolean; threshold integer; status_value text; reason_value text; begin
 perform pose_private.campaign_filter(p_filter); select * into c from public.campaigns where id=p_campaign for update; if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if; if p_version is distinct from c.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if; if c.status not in ('DRAFT','PAUSED') then raise exception 'AUDIENCE_LOCKED' using errcode='22023'; end if;
 use_match:=coalesce((p_filter->>'match_campaign_products')::boolean,false); threshold:=case when use_match then coalesce((p_filter->>'min_match')::integer,40) else 0 end;
 for l in select * from pose_private.campaign_audience(p_filter) loop select * into cust from public.customers where id=l.customer_id; e:=pose_private.contact_eligibility(l.id,null); m:=case when use_match then pose_private.lead_campaign_match(l.id,p_campaign) else jsonb_build_object('rule_version','MATCH.v1','score',0,'reasons','[]'::jsonb) end; reason_value:=coalesce(e->>'reason',m->>'excluded'); status_value:=case when (e->>'reason') is null and (m->>'excluded') is null and ((not use_match) or (m->>'score')::integer>=threshold) then 'PENDING' when pose_private.contact_block_kind(e->>'reason')='OptOut' then 'OPTED_OUT' else 'SKIPPED' end;
  insert into public.campaign_customers(campaign_id,customer_id,lead_id,phone_e164,snapshot,status,skip_reason,next_attempt_at,priority) values(c.id,cust.id,l.id,cust.phone,jsonb_build_object('lead',to_jsonb(l),'customer',jsonb_build_object('id',cust.id,'full_name',cust.full_name,'phone',cust.phone,'phone_verified_at',cust.phone_verified_at),'match',m,'reasons',coalesce(m->'reasons','[]'::jsonb),'rule_version',m->>'rule_version'),status_value,reason_value,case when pose_private.contact_block_kind(e->>'reason')='Temporary' then pose_private.contact_defer_until(cust.phone,e->>'reason',now()) end,coalesce((m->>'score')::integer,0)) on conflict(campaign_id,customer_id) do update set snapshot=excluded.snapshot,phone_e164=excluded.phone_e164,skip_reason=excluded.skip_reason,status=excluded.status,next_attempt_at=excluded.next_attempt_at,priority=excluded.priority,version=campaign_customers.version+1,updated_at=now() where campaign_customers.status='PENDING';
 end loop; update public.campaigns set version=version+1,updated_at=now() where id=c.id returning * into c; insert into public.campaign_events(campaign_id,actor_id,action,reason,snapshot) values(c.id,actor,'audience',coalesce(p_reason,''),p_filter); return jsonb_build_object('campaign',to_jsonb(c),'preview',pose_private.preview_campaign_audience(c.id,p_filter));
end $$;

create or replace function pose_private.audience_membership_status() returns trigger language plpgsql set search_path='' as $$ begin if new.skip_reason in ('ACTIVE_CALL','DAILY_CAP','WEEKLY_CAP') then new.status:='PENDING'; end if; return new; end $$;
drop trigger if exists audience_membership_status on public.campaign_customers;
create trigger audience_membership_status before insert on public.campaign_customers for each row execute function pose_private.audience_membership_status();

create or replace function pose_private.read_my_contact_consents() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_account(); phone text; result jsonb;
begin
 select c.phone into phone from public.customers c where c.auth_user_id=uid and c.phone_verified_at is not null order by c.id limit 1;
 select jsonb_build_object('phone_verified',phone is not null,'purposes',coalesce((select jsonb_agg(jsonb_build_object('purpose',p,'granted',pose_private.consent_granted(phone,p)) order by p) from unnest(array['Call','AIVoice','Transcript','Recording']) p),'[]'),'history',coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at desc) from (select purpose,status,channel,source,recorded_at from public.contact_consents where phone_e164=phone order by recorded_at desc limit 10) x),'[]')) into result;
 return result;
end $$;

create or replace function pose_private.set_my_contact_consent(p_purpose text,p_granted boolean,p_text text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_account(); cust public.customers; c public.contact_consents; phone text; now_value timestamptz:=now();
begin
 if p_purpose not in ('Call','AIVoice','Transcript','Recording') or p_granted is null or char_length(btrim(coalesce(p_text,'')))>500 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 select * into cust from public.customers where auth_user_id=uid and phone_verified_at is not null order by id limit 1;
 if cust.id is null then raise exception 'PHONE_UNVERIFIED' using errcode='22023'; end if;
 insert into public.contact_consents(phone_e164,customer_id,purpose,status,channel,source,evidence,policy_version,recorded_by)
 values(cust.phone,cust.id,p_purpose,case when p_granted then 'Granted' else 'Withdrawn' end,'Web','Contact settings',btrim(coalesce(p_text,''))||' | '||now_value::text,'CONTACT_POLICY_VERSION',uid) returning * into c;
 if not p_granted and p_purpose in ('Call','AIVoice') then
   insert into public.contact_suppressions(phone_e164,reason,source,actor_id) values(cust.phone,'Customer withdrew consent for '||p_purpose,'Customer',uid) on conflict do nothing;
 elsif p_granted and p_purpose='Call' then
   update public.contact_suppressions set lifted_at=now_value,lifted_by=uid,lift_consent_id=c.id where phone_e164=cust.phone and lifted_at is null and source='Customer';
 end if;
 return pose_private.read_my_contact_consents();
end $$;

create or replace function public.pose_read_my_contact_consents() returns jsonb language sql security invoker set search_path='' as $$ select pose_private.read_my_contact_consents(); $$;
create or replace function public.pose_set_my_contact_consent(p_purpose text,p_granted boolean,p_text text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.set_my_contact_consent(p_purpose,p_granted,p_text); $$;
revoke all on function public.pose_read_my_contact_consents(),public.pose_set_my_contact_consent(text,boolean,text) from public,anon,authenticated;
grant execute on function pose_private.read_my_contact_consents(),pose_private.set_my_contact_consent(text,boolean,text),public.pose_read_my_contact_consents(),public.pose_set_my_contact_consent(text,boolean,text) to authenticated;
-- M07 audience scores are scheduling priority, while preserving the existing caps and fairness tie-breakers.
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
   if c.end_time is not null and c.end_time<=p_now then update public.campaign_customers set status='EXHAUSTED',skip_reason='END_TIME',updated_at=p_now where campaign_id=c.id and status in ('PENDING','RETRYING');
   else
    local_now:=p_now at time zone c.timezone;
    if extract(dow from local_now)::smallint=any(c.weekdays) and local_now::time>=c.window_start and local_now::time<c.window_end then
     select count(*) into queued from public.call_jobs where campaign_id=c.id and status in ('Pending','Claimed');
     allowance:=least(coalesce(c.daily_call_limit,0)-(select count(*)::integer from public.call_jobs where campaign_id=c.id and (created_at at time zone c.timezone)::date=local_now::date),greatest(0,coalesce(floor((coalesce(c.budget_limit_vnd,0)-c.budget_spent_vnd-c.budget_reserved_vnd)/nullif(c.cost_reserve_per_call_vnd,0)),0)-queued))::integer;
     for m in select * from public.campaign_customers where campaign_id=c.id and (status='PENDING' and (next_attempt_at is null or next_attempt_at<=p_now) or status='RETRYING' and next_attempt_at<=p_now) order by priority desc,added_at,id for update loop
      reason:=pose_private.contact_eligibility(m.lead_id,c.id,p_now)->>'reason';
      if m.phone_e164 is distinct from (select phone from public.customers where id=m.customer_id) then reason:='PHONE_UNVERIFIED'; end if;
      if reason is not null then perform pose_private.campaign_contact_block(m.id,reason,p_now); continue; end if;
      n:=m.retry_count+1;
      if n>c.max_attempts then update public.campaign_customers set status='EXHAUSTED',updated_at=p_now where id=m.id; continue; end if;
      if allowance<=0 then continue; end if;
      perform pg_advisory_xact_lock(hashtextextended(m.phone_e164,7));
      if exists(select 1 from public.call_jobs j join public.campaign_customers other on other.id=j.membership_id where other.phone_e164=m.phone_e164 and j.campaign_id<>c.id and j.status in ('Pending','Claimed','Dispatched')) then perform pose_private.campaign_contact_block(m.id,'ACTIVE_CALL',p_now);continue; end if;
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
-- Callers receive the immutable audience decision as data, while conversation text remains separate.
create or replace function pose_private.call_context(p_call uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls;
begin
 perform pose_private.call_system();
 select * into a from public.calls where id=p_call;
 return to_jsonb(a)||jsonb_build_object('suppressed',pose_private.phone_suppressed(a.phone_e164),'script',(select content from public.call_script_versions where id=a.script_version_id),'lead',(select jsonb_build_object('needs',l.needs,'campaign_snapshot',m.snapshot,'products_of_interest',coalesce(m.snapshot->'reasons','[]'::jsonb),'match',coalesce(m.snapshot->'match','{}'::jsonb)) from public.leads l left join public.campaign_customers m on m.id=a.membership_id where l.id=a.lead_id));
end $$;
revoke all on function pose_private.call_context(uuid) from public,anon,authenticated;
grant execute on function pose_private.call_context(uuid) to service_role;
commit;
