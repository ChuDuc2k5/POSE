-- Apply after property-discovery.sql and lead-contact-foundation.sql.
begin;
create table public.ai_chat_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), guest_token_hash text,
 store_transcript boolean not null default false, lead_id uuid references public.leads(id),
 status text not null default 'Active' check(status in ('Active','HandedOff','Closed')),
 message_count integer not null default 0 check(message_count>=0), property_ids uuid[] not null default '{}', suggested_property_ids uuid[] not null default '{}' check(cardinality(suggested_property_ids)<=20), created_at timestamptz not null default now(), last_message_at timestamptz,
 check ((user_id is null) <> (guest_token_hash is null)), check(guest_token_hash is null or guest_token_hash ~ '^[a-f0-9]{64}$'),
 check(user_id is not null or lead_id is null)
);
create table public.ai_chat_messages (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references public.ai_chat_sessions(id),
 role text not null check(role in ('user','assistant')), content text not null check(char_length(content)<=8000),
 sources jsonb not null default '[]', blocked boolean not null default false, created_at timestamptz not null default now()
);
create index ai_messages_session on public.ai_chat_messages(session_id,created_at);
alter table public.ai_extracted_preferences
 add column evidence text,
 add column source_kind text check(source_kind in ('Chat','Call')),
 add column source_session_id uuid references public.ai_chat_sessions(id),
 add column schema_version text,
 add column idempotency_key text unique,
 add column status text not null default 'Accepted' check(status in ('Accepted','Conflict','Superseded'));
alter table public.ai_analyses add column idempotency_key text unique;
alter table public.ai_extracted_preferences enable row level security;
alter table public.ai_analyses enable row level security;
revoke all on public.ai_extracted_preferences,public.ai_analyses from public,anon,authenticated;
grant select on public.ai_extracted_preferences,public.ai_analyses to authenticated;
create policy ai_preferences_staff on public.ai_extracted_preferences for select to authenticated using((select pose_private.staff_role())='Admin' or (select pose_private.staff_role())='Sales' and pose_private.lead_assigned_to_me(lead_id));
create policy ai_analyses_staff on public.ai_analyses for select to authenticated using((select pose_private.staff_role())='Admin' or (select pose_private.staff_role())='Sales' and pose_private.lead_assigned_to_me(lead_id));
create table public.ai_action_log (
 id uuid primary key default gen_random_uuid(), session_id uuid references public.ai_chat_sessions(id), tool text not null,
 args_hash text not null check(args_hash ~ '^[a-f0-9]{64}$'), decision text not null check(decision in ('allowed','blocked','flagged')),
 reason text not null, rule_version text not null, created_at timestamptz not null default now()
);
create table pose_private.ai_operations (key text primary key, lead_id uuid not null references public.leads(id), kind text not null, result jsonb);
create table pose_private.ai_typed_writes (lead_id uuid references public.leads(id),column_name text,field_value jsonb not null,primary key(lead_id,column_name));
grant usage on schema pose_private to service_role;
revoke all on pose_private.ai_operations from public,anon,authenticated;
revoke all on pose_private.ai_typed_writes from public,anon,authenticated;
alter table pose_private.ai_operations enable row level security;
alter table pose_private.ai_typed_writes enable row level security;
create function pose_private.ai_invalidate_typed_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.role()='service_role' then return new; end if;
 delete from pose_private.ai_typed_writes where lead_id=new.id and column_name=TG_ARGV[0];
 return new;
end $$;
revoke all on function pose_private.ai_invalidate_typed_write() from public,anon,authenticated;
do $$ declare col text;begin
 foreach col in array array['budget_min','budget_max','preferred_location','preferred_property_type','expected_timeline'] loop
  execute format('create trigger %I after update of %I on public.leads for each row execute function pose_private.ai_invalidate_typed_write(%L)','ai_invalidate_'||col,col,col);
 end loop;
end $$;
alter table public.ai_chat_sessions enable row level security;
alter table public.ai_chat_messages enable row level security;
alter table public.ai_action_log enable row level security;
revoke all on public.ai_chat_sessions,public.ai_chat_messages,public.ai_action_log from public,anon,authenticated;
grant select on public.ai_chat_sessions,public.ai_chat_messages,public.ai_action_log to authenticated;
create policy ai_session_owner on public.ai_chat_sessions for select to authenticated using(user_id=(select pose_private.require_account()));
create policy ai_message_owner on public.ai_chat_messages for select to authenticated using(exists(select 1 from public.ai_chat_sessions s where s.id=session_id and s.user_id=(select pose_private.require_account())));
create policy ai_log_admin on public.ai_action_log for select to authenticated using((select pose_private.staff_role())='Admin');
create function pose_private.ai_lead_assignee(p_lead uuid) returns uuid language sql stable security definer set search_path='' as $$
 select sales_id from public.lead_assignments where lead_id=p_lead and is_active order by assigned_at desc,id limit 1;
$$;
revoke all on function pose_private.ai_lead_assignee(uuid) from public,anon,authenticated;
create function pose_private.ai_interest_ids(p_lead uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array(select distinct unnest(coalesce(s.suggested_property_ids,s.property_ids)) from public.ai_chat_sessions s where s.lead_id=p_lead limit 100),'{}'::uuid[]);
$$;
revoke all on function pose_private.ai_interest_ids(uuid) from public,anon,authenticated;
create function pose_private.ai_strip_phones(p_text text) returns text language plpgsql immutable security invoker set search_path='' as $$
declare remaining text:=p_text; result text:=''; parts text[]; candidate text; at_pos integer; after_text text; grouped boolean; vn_mobile boolean;
begin
 loop
  parts:=regexp_match(remaining,'(^|[^0-9+])((?:\+84[ .()-]?[35789](?:[ .()-]?[0-9]){8}|0[35789](?:[ .()-]?[0-9]){8}|\+[1-9](?:[ .()-]?[0-9]){7,14}))(?![0-9])');
  exit when parts is null;
  candidate:=parts[2]; at_pos:=strpos(remaining,parts[1]||candidate)+char_length(parts[1]); after_text:=substring(remaining from at_pos+char_length(candidate));
  grouped:=candidate ~ '^\+?[0-9]{1,3}([ .][0-9]{3})+$';
  vn_mobile:=regexp_replace(candidate,'[ .()-]','','g') ~ '^\+84[35789][0-9]{8}$';
  result:=result||substring(remaining from 1 for at_pos-1)||case when after_text ~* '^\s*(VND|đồng|đ|tỷ|tỉ|triệu)(?![a-z])' or grouped and not vn_mobile then candidate else '[đã ẩn số liên hệ]' end;
  remaining:=after_text;
 end loop;
 return result||remaining;
end $$;
revoke all on function pose_private.ai_strip_phones(text) from public,anon,authenticated;

create function pose_private.ai_read_session(p_session uuid,p_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.ai_chat_sessions; actor uuid;
begin
 if auth.role()='service_role' then
  select * into s from public.ai_chat_sessions where id=p_session and user_id is null and guest_token_hash=p_hash;
 else
  actor:=pose_private.require_account(); select * into s from public.ai_chat_sessions where id=p_session and user_id=actor;
 end if;
 if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='P0002'; end if;
 return (to_jsonb(s)-'guest_token_hash'-'user_id'-'lead_id') || jsonb_build_object('scoring',case when s.user_id is not null then (select jsonb_build_object('needs',l.needs,'verified',c.phone_verified_at is not null,'version',l.version,'interest_ids',pose_private.ai_interest_ids(l.id),'score_result',l.score_evidence) from public.leads l join public.customers c on c.id=l.customer_id where l.id=s.lead_id and c.auth_user_id=s.user_id) else null end,'messages',coalesce((select jsonb_agg(to_jsonb(m)-'session_id' order by m.created_at,m.id) from public.ai_chat_messages m where m.session_id=s.id),'[]'));
end $$;
create function public.pose_ai_read_session(p_session uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_read_session(p_session); $$;
create function public.pose_system_ai_read_guest(p_session uuid,p_hash text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_read_session(p_session,p_hash); $$;
create function pose_private.ai_score_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account();
begin
 return (select jsonb_build_object('needs',l.needs,'verified',c.phone_verified_at is not null,'version',l.version,'interest_ids',pose_private.ai_interest_ids(l.id),'score_result',l.score_evidence) from public.leads l join public.customers c on c.id=l.customer_id where c.auth_user_id=actor and not l.archived and l.status not in ('CONVERTED','LOST'));
end $$;
create function public.pose_ai_score_context() returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_score_context(); $$;
revoke all on function pose_private.ai_score_context(),public.pose_ai_score_context() from public,anon;
grant execute on function pose_private.ai_score_context(),public.pose_ai_score_context() to authenticated;

create function pose_private.ai_record_extraction(p_lead uuid,p_source_kind text,p_source_id uuid,p_schema text,p_fields jsonb,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
 declare l public.leads; k text; f jsonb; previous jsonb; merged jsonb; conflict boolean:=false; field_conflict boolean; result jsonb; quote text; typed_column text; typed_value jsonb; old_typed jsonb; last_typed jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if;
 if p_source_kind is null or p_source_kind not in ('Chat','Call') or p_schema is distinct from 'needs.v1' or p_source_id is null or jsonb_typeof(p_fields) is distinct from 'object' or char_length(p_idempotency_key) not between 8 and 200 or p_idempotency_key is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 select * into l from public.leads where id=p_lead for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 select o.result into result from pose_private.ai_operations o where key=p_idempotency_key and lead_id=p_lead and kind='extraction';
 if found then return result; end if;
 if p_source_kind='Chat' and not exists(select 1 from public.ai_chat_sessions s join public.customers c on c.id=l.customer_id where s.id=p_source_id and s.lead_id=p_lead and s.user_id=c.auth_user_id and s.store_transcript) then raise exception 'SOURCE_MISMATCH' using errcode='22023'; end if;
 if p_source_kind='Call' then
  if not exists(select 1 from public.calls where id=p_source_id and lead_id=p_lead and status='COMPLETED') then raise exception 'SOURCE_MISMATCH' using errcode='22023'; end if;
 end if;
 merged:=l.needs;
 for k,f in select * from jsonb_each(p_fields) loop
  if k not in ('budget_min_vnd','budget_max_vnd','locations','property_types','timeline','purchase_intent','contact_ready','next_step') or jsonb_typeof(f)<>'object' or not(f ?& array['value','confidence','evidence']) or jsonb_typeof(f->'confidence')<>'number' or (f->>'confidence')::numeric not between 0 and 1 or jsonb_typeof(f->'evidence')<>'string' or char_length(btrim(f->>'evidence')) not between 1 and 2000 then raise exception 'INVALID_FIELD' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(f) x where x not in ('value','confidence','evidence')) then raise exception 'INVALID_FIELD' using errcode='22023'; end if;
  if f->'value'='null'::jsonb or k in ('budget_min_vnd','budget_max_vnd') and (jsonb_typeof(f->'value') is distinct from 'number' or (f->>'value')::numeric not between 1 and 1000000000000000)
   or k in ('locations','property_types') and (jsonb_typeof(f->'value') is distinct from 'array' or jsonb_array_length(f->'value') not between 1 and 10)
   or k='timeline' and f->>'value' not in ('lt3m','3to6m','gt6m','none')
   or k='next_step' and f->>'value' not in ('none','consult','appointment')
   or k in ('purchase_intent','contact_ready') and jsonb_typeof(f->'value') is distinct from 'boolean' then raise exception 'INVALID_VALUE' using errcode='22023'; end if;
  if k in ('locations','property_types') and exists(select 1 from jsonb_array_elements(f->'value') v where jsonb_typeof(v)<>'string' or char_length(v#>>'{}') not between 1 and 120 or k='property_types' and v#>>'{}' not in ('Apartment','House','Land','Villa','Office','Shop')) then raise exception 'INVALID_VALUE' using errcode='22023'; end if;
  quote:=f->>'evidence';
  if pose_private.ai_strip_phones(quote)<>quote then continue; end if;
  if k in ('locations','property_types') and exists(select 1 from jsonb_array_elements_text(f->'value') v where pose_private.ai_strip_phones(v)<>v) then continue; end if;
  if quote ~* '(ví dụ|không phải|chưa|giả sử|không muốn|không có|không mua)' then continue; end if;
  if p_source_kind='Chat' and exists(select 1 from public.ai_chat_sessions where id=p_source_id and store_transcript) and not exists(select 1 from public.ai_chat_messages where session_id=p_source_id and role='user' and position(quote in content)>0) then continue; end if;
  if p_source_kind='Call' and not exists(select 1 from public.call_transcripts where call_id=p_source_id and position(quote in transcript)>0) then continue; end if;
  previous:=merged->k;
  field_conflict:=previous is not null and previous->'value' is distinct from f->'value';
  conflict:=conflict or field_conflict;
  if not (coalesce(previous,'{}') ? 'confirmed_by') then update public.ai_extracted_preferences set status='Superseded' where lead_id=p_lead and field_name=k and status in ('Accepted','Conflict'); end if;
  insert into public.ai_extracted_preferences(lead_id,field_name,field_value,confidence,source_call_id,evidence,source_kind,source_session_id,schema_version,idempotency_key,status)
  values(p_lead,k,(f->'value')::text,(f->>'confidence')::numeric,case when p_source_kind='Call' then p_source_id end,quote,p_source_kind,case when p_source_kind='Chat' then p_source_id end,p_schema,p_idempotency_key||':'||k,case when field_conflict then 'Conflict' else 'Accepted' end);
  if previous ? 'confirmed_by' then continue; end if;
  merged:=merged || jsonb_build_object(k,f || jsonb_build_object('source',jsonb_build_object('kind',p_source_kind,'id',p_source_id,'schema',p_schema),'at',now()));
  typed_column:=case k when 'budget_min_vnd' then 'budget_min' when 'budget_max_vnd' then 'budget_max' when 'locations' then 'preferred_location' when 'property_types' then 'preferred_property_type' when 'timeline' then 'expected_timeline' end;
  typed_value:=case when k in ('locations','property_types') then case when jsonb_array_length(f->'value')=1 then f->'value'->0 end else f->'value' end;
  if typed_column is not null and typed_value is not null then
   execute format('select to_jsonb(%I) from public.leads where id=$1',typed_column) into old_typed using p_lead;
   select w.field_value into last_typed from pose_private.ai_typed_writes w where w.lead_id=p_lead and w.column_name=typed_column;
   if old_typed is null or old_typed='null'::jsonb or old_typed=last_typed then
    execute format('update public.leads set %I=($1 #>> ''{}'')::%s where id=$2',typed_column,case when k in ('budget_min_vnd','budget_max_vnd') then 'numeric' else 'text' end) using typed_value,p_lead;
    insert into pose_private.ai_typed_writes values(p_lead,typed_column,typed_value) on conflict(lead_id,column_name) do update set field_value=excluded.field_value;
   end if;
  end if;
 end loop;
 if conflict then
  merged:=merged||'{"review_required":true}';
  insert into public.lead_tasks(lead_id,kind,assignee_id,summary,source,idempotency_key) values(p_lead,'Review',pose_private.ai_lead_assignee(p_lead),'Kiểm tra nhu cầu mâu thuẫn','AI','needs-review:'||p_lead) on conflict(idempotency_key) do nothing;
 end if;
 update public.leads set needs=merged,version=version+1,updated_at=now() where id=p_lead;
 insert into public.lead_events(lead_id,actor_kind,action,before_data,after_data) values(p_lead,'AI','needs_extracted',l.needs,merged);
 insert into pose_private.ai_operations values(p_idempotency_key,p_lead,'extraction',merged);
 return merged;
end $$;
create function public.pose_system_record_ai_extraction(p_lead uuid,p_source_kind text,p_source_id uuid,p_schema text,p_fields jsonb,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_record_extraction(p_lead,p_source_kind,p_source_id,p_schema,p_fields,p_idempotency_key); $$;

create function pose_private.ai_apply_score(p_lead uuid,p_result jsonb,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.leads; k text; f jsonb; expected integer; total integer:=0; known integer:=0; unknowns jsonb:='[]'; computed_classification text; result jsonb; call_id uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if;
 if p_result->>'rule_version' is distinct from 'BR-04.v1' or jsonb_typeof(p_result->'breakdown') is distinct from 'object' or jsonb_typeof(p_result->'intent') is distinct from 'boolean' or char_length(p_idempotency_key) not between 8 and 200 or p_idempotency_key is null then raise exception 'INVALID_SCORE' using errcode='22023'; end if;
 select * into l from public.leads where id=p_lead for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 select o.result into result from pose_private.ai_operations o where key=p_idempotency_key and lead_id=p_lead and kind='score'; if found then return result; end if;
 foreach k in array array['budget','area_type','timeline','contact','next_step'] loop
  f:=p_result->'breakdown'->k;
  if f is null or jsonb_typeof(f) <> 'object' or jsonb_typeof(f->'points') is distinct from 'number' then raise exception 'INVALID_SCORE' using errcode='22023'; end if;
  if f->>'value' is null then
   expected:=0; unknowns:=unknowns||jsonb_build_array(k);
   if f->>'evidence' is not null then raise exception 'INVALID_SCORE' using errcode='22023'; end if;
  else
   if jsonb_typeof(f->'evidence') is distinct from 'string' or char_length(btrim(f->>'evidence'))<1 then raise exception 'EVIDENCE_REQUIRED' using errcode='22023'; end if;
   expected:=case k
    when 'budget' then case f->>'value' when 'none' then 0 when 'partial' then 15 when 'match' then 30 end
    when 'area_type' then case f->>'value' when 'none' then 0 when 'one' then 12 when 'both' then 25 end
    when 'timeline' then case f->>'value' when 'none' then 0 when 'gt6m' then 0 when '3to6m' then 10 when 'lt3m' then 20 end
    when 'contact' then case f->>'value' when 'none' then 0 when 'verified' then 8 when 'ready' then 15 end
    when 'next_step' then case f->>'value' when 'none' then 0 when 'consult' then 5 when 'appointment' then 10 end end;
   if k='contact' and expected>0 and not exists(select 1 from public.customers where id=l.customer_id and phone_verified_at is not null and phone ~ '^\+[1-9][0-9]{7,14}$') then raise exception 'PHONE_UNVERIFIED' using errcode='22023'; end if;
   known:=known+1;
  end if;
  if expected is null or (f->>'points')::numeric<>expected then raise exception 'INVALID_SCORE' using errcode='22023'; end if;
  total:=total+expected;
 end loop;
 computed_classification:=case when known<3 or not(p_result->>'intent')::boolean then 'Unrated' when total>=80 then 'Hot' when total>=50 then 'Warm' else 'Cold' end;
 if (p_result->>'score')::numeric is distinct from total::numeric or p_result->>'classification' is distinct from computed_classification or p_result->'unknown' is distinct from unknowns then raise exception 'INVALID_SCORE' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_result->'breakdown') x where x not in ('budget','area_type','timeline','contact','next_step')) then raise exception 'INVALID_SCORE' using errcode='22023'; end if;
 update public.leads set lead_score=total,temperature=case when computed_classification='Unrated' then null else upper(computed_classification)::public.lead_temperature end,score_rule_version='BR-04.v1',score_evidence=p_result,version=version+1,updated_at=now() where id=p_lead;
 if computed_classification='Hot' then insert into public.lead_tasks(lead_id,kind,priority,assignee_id,summary,source,idempotency_key) values(p_lead,'Review','High',pose_private.ai_lead_assignee(p_lead),'Kiểm tra Lead Hot','AI','hot:'||p_lead||':BR-04.v1') on conflict(idempotency_key) do nothing; end if;
 if p_result->>'source_kind'='Call' then
  call_id:=(p_result->>'source_id')::uuid;
  if not exists(select 1 from public.calls c where c.id=call_id and c.lead_id=p_lead and c.status='COMPLETED') then raise exception 'SOURCE_MISMATCH' using errcode='22023'; end if;
  insert into public.ai_analyses(call_id,lead_id,lead_score,temperature,summary,raw_analysis,idempotency_key) values(call_id,p_lead,total,case when computed_classification='Unrated' then null else upper(computed_classification)::public.lead_temperature end,'Điểm theo BR-04.v1: '||total||' · '||computed_classification,p_result,p_idempotency_key);
 elsif p_result ? 'source_kind' or p_result ? 'source_id' then raise exception 'SOURCE_MISMATCH' using errcode='22023'; end if;
 insert into public.lead_events(lead_id,actor_kind,action,before_data,after_data) values(p_lead,'AI','score_applied',l.score_evidence,p_result);
 insert into pose_private.ai_operations values(p_idempotency_key,p_lead,'score',p_result);
 return p_result;
end $$;
create function public.pose_system_apply_lead_score(p_lead uuid,p_result jsonb,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_apply_score(p_lead,p_result,p_idempotency_key); $$;

create function pose_private.ai_commit_chat(p_session uuid,p_user uuid,p_hash text,p_store boolean,p_message text,p_reply text,p_sources jsonb,p_actions jsonb,p_fields jsonb,p_score jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.ai_chat_sessions; a jsonb; before_needs jsonb; merged_needs jsonb; lead_version integer; needs_changed boolean:=false;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if;
 if p_message is null or char_length(p_message) not between 1 and 2000 or p_reply is null or char_length(p_reply) not between 1 and 8000 or p_store is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 select * into s from public.ai_chat_sessions where id=p_session for update;
 if found then
  if s.user_id is distinct from p_user or s.guest_token_hash is distinct from p_hash or s.status='Closed' or s.store_transcript<>p_store then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
 else
  insert into public.ai_chat_sessions(id,user_id,guest_token_hash,store_transcript,lead_id) values(p_session,p_user,p_hash,p_store,(select l.id from public.leads l join public.customers c on c.id=l.customer_id where c.auth_user_id=p_user and not l.archived and l.status not in ('CONVERTED','LOST'))) returning * into s;
 end if;
 if s.lead_id is not null then select needs,version into before_needs,lead_version from public.leads where id=s.lead_id for update; end if;
 if s.user_id is null then
  p_message:=pose_private.ai_strip_phones(p_message);
 end if;
 if s.store_transcript then
  insert into public.ai_chat_messages(session_id,role,content,sources,blocked) values(s.id,'user',p_message,'[]',false),(s.id,'assistant',p_reply,p_sources,exists(select 1 from jsonb_array_elements(p_actions) x where x->>'decision'='blocked'));
 end if;
 for a in select * from jsonb_array_elements(p_actions) loop
  insert into public.ai_action_log(session_id,tool,args_hash,decision,reason,rule_version) values(s.id,a->>'tool',a->>'args_hash',a->>'decision',a->>'reason',a->>'rule_version');
 end loop;
 update public.ai_chat_sessions set message_count=message_count+2,last_message_at=now(),property_ids=array(select distinct x from unnest(s.property_ids||array(select (v->>'id')::uuid from jsonb_array_elements(p_sources) v)) x limit 100),suggested_property_ids=array(select distinct x from unnest(s.suggested_property_ids||array(select (v->>'id')::uuid from jsonb_array_elements(p_sources) v)) x limit 20) where id=s.id;
 if s.lead_id is not null and s.store_transcript and p_fields<>'{}'::jsonb then
  merged_needs:=pose_private.ai_record_extraction(s.lead_id,'Chat',s.id,'needs.v1',p_fields,'chat-extract:'||s.id||':'||s.message_count);
  needs_changed:=exists(select 1 from jsonb_object_keys(p_fields) k where before_needs->k->'value' is distinct from merged_needs->k->'value');
 end if;
 if needs_changed and p_score is not null then
  if (p_score->>'needs_version')::integer is distinct from lead_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  perform pose_private.ai_apply_score(s.lead_id,p_score-'needs_version','chat-score:'||s.id||':'||s.message_count);
 end if;
 return jsonb_build_object('id',s.id,'message_count',s.message_count+2,'store_transcript',s.store_transcript);
end $$;
create function public.pose_system_ai_commit_chat(p_session uuid,p_user uuid,p_hash text,p_store boolean,p_message text,p_reply text,p_sources jsonb,p_actions jsonb,p_fields jsonb,p_score jsonb) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_commit_chat(p_session,p_user,p_hash,p_store,p_message,p_reply,p_sources,p_actions,p_fields,p_score); $$;

create function pose_private.ai_handoff(p_session uuid,p_summary text,p_preferred_start timestamptz,p_preferred_end timestamptz,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; ctx jsonb; s public.ai_chat_sessions; l public.leads; profile jsonb; task public.lead_tasks; ap public.appointments; key text; cust public.customers; a auth.users; v_phone text; assignee uuid;
begin
 actor:=pose_private.require_account(); ctx:=pose_private.pose_access_context();
 if ctx->>'role' is distinct from 'User' then raise exception 'CUSTOMER_REQUIRED' using errcode='42501'; end if;
 if p_summary is null or char_length(btrim(p_summary)) not between 3 and 2000 or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 or (p_preferred_start is null)<>(p_preferred_end is null) or p_preferred_start is not null and (p_preferred_start<=now() or p_preferred_end<=p_preferred_start or p_preferred_end-p_preferred_start>interval '8 hours') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,3));
 select * into s from public.ai_chat_sessions where id=p_session and user_id=actor for update;
 if not found or s.status='Closed' then raise exception 'SESSION_NOT_FOUND' using errcode='P0002'; end if;
 key:='handoff:'||s.id||':'||p_idempotency_key;
 select * into task from public.lead_tasks where idempotency_key=key;
 if found then
  select * into ap from public.appointments where idempotency_key=key;
  if task.summary<>btrim(p_summary) or ap.appointment_time is distinct from p_preferred_start or ap.ends_at is distinct from p_preferred_end then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
  return jsonb_build_object('task_id',task.id,'appointment_id',ap.id,'status',case when ap.status='SCHEDULED' then 'Pending' else ap.status::text end);
 end if;
 select * into cust from public.customers where auth_user_id=actor for update;
 if not found then
  profile:=pose_private.read_profile(); select * into a from auth.users where id=actor;
  v_phone:=profile->>'phone';
  if not coalesce((profile->>'phoneVerified')::boolean,false) or v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'PHONE_VERIFICATION_REQUIRED' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_phone,3));
  if exists(select 1 from public.customers c where ltrim(c.phone,'+')=ltrim(v_phone,'+') or c.auth_user_id=actor or v_phone like '+84%' and c.phone='0'||substring(v_phone from 4)) then raise exception 'IDENTITY_REVIEW_REQUIRED' using errcode='22023'; end if;
  insert into public.customers(full_name,phone,email,source,auth_user_id,phone_verified_at) values(profile->>'name',v_phone,a.email,'WebChat',actor,a.phone_confirmed_at) returning * into cust;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(cust.phone,3));
 select * into l from public.leads where customer_id=cust.id and status not in ('CONVERTED','LOST') and not archived for update;
 if not found then
  if exists(select 1 from public.leads where customer_id=cust.id) then raise exception 'REOPEN_REQUIRES_REVIEW' using errcode='22023'; end if;
  insert into public.leads(customer_id,source) values(cust.id,'WebChat') returning * into l;
 end if;
 assignee:=pose_private.ai_lead_assignee(l.id);
 if p_preferred_start is not null and assignee is not null then
  perform pg_advisory_xact_lock(hashtextextended(assignee::text,1));
  if exists(select 1 from public.appointments where sales_id=assignee and status in ('SCHEDULED','CONFIRMED') and appointment_time<p_preferred_end and coalesce(ends_at,appointment_time+interval '1 hour')>p_preferred_start) then raise exception 'APPOINTMENT_OVERLAP' using errcode='40001'; end if;
 end if;
 insert into public.lead_tasks(lead_id,kind,priority,assignee_id,summary,source,idempotency_key) values(l.id,'Handoff','High',assignee,btrim(p_summary),'AI',key) returning * into task;
 if p_preferred_start is not null then insert into public.appointments(lead_id,customer_id,sales_id,appointment_time,ends_at,status,source,notes,idempotency_key) values(l.id,cust.id,assignee,p_preferred_start,p_preferred_end,'SCHEDULED','AI','Thời gian khách đề nghị, chưa xác nhận',key) returning * into ap; end if;
 update public.ai_chat_sessions set lead_id=l.id,status='HandedOff' where id=s.id;
 insert into public.lead_events(lead_id,actor_id,actor_kind,action,after_data) values(l.id,actor,'AI','handoff_requested',jsonb_build_object('task_id',task.id,'appointment_id',ap.id));
 return jsonb_build_object('task_id',task.id,'appointment_id',ap.id,'status',case when ap.status='SCHEDULED' then 'Pending' else ap.status::text end);
end $$;
create function public.pose_ai_request_handoff(p_session uuid,p_summary text,p_preferred_start timestamptz default null,p_preferred_end timestamptz default null,p_idempotency_key text default null) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_handoff(p_session,p_summary,p_preferred_start,p_preferred_end,p_idempotency_key); $$;

create function pose_private.ai_override_score(p_lead uuid,p_version integer,p_classification text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; role text; l public.leads;
begin
 actor:=pose_private.require_account(); role:=pose_private.staff_role();
 select * into l from public.leads where id=p_lead for update;
 if role is null or role='Sales' and not pose_private.lead_assigned_to_me(p_lead) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if l.id is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 or p_classification is null or p_classification not in ('Hot','Warm','Cold','Unrated') then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 if p_version is distinct from l.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 update public.leads set temperature=case when p_classification='Unrated' then null else upper(p_classification)::public.lead_temperature end,version=version+1,updated_at=now() where id=l.id;
 insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data) values(l.id,actor,role,'score_overridden',btrim(p_reason),to_jsonb(l),jsonb_build_object('classification',p_classification));
 return jsonb_build_object('classification',p_classification,'version',l.version+1);
end $$;
create function public.pose_override_lead_score(p_lead uuid,p_version integer,p_classification text,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_override_score(p_lead,p_version,p_classification,p_reason); $$;

revoke all on function pose_private.ai_read_session(uuid,text) from public,anon;
grant execute on function pose_private.ai_read_session(uuid,text) to authenticated,service_role;
revoke all on function public.pose_ai_read_session(uuid),public.pose_ai_request_handoff(uuid,text,timestamptz,timestamptz,text),public.pose_override_lead_score(uuid,integer,text,text),pose_private.ai_handoff(uuid,text,timestamptz,timestamptz,text),pose_private.ai_override_score(uuid,integer,text,text) from public,anon;
grant execute on function public.pose_ai_read_session(uuid),public.pose_ai_request_handoff(uuid,text,timestamptz,timestamptz,text),public.pose_override_lead_score(uuid,integer,text,text),pose_private.ai_handoff(uuid,text,timestamptz,timestamptz,text),pose_private.ai_override_score(uuid,integer,text,text) to authenticated;
revoke all on function public.pose_system_ai_read_guest(uuid,text),pose_private.ai_record_extraction(uuid,text,uuid,text,jsonb,text),public.pose_system_record_ai_extraction(uuid,text,uuid,text,jsonb,text),pose_private.ai_apply_score(uuid,jsonb,text),public.pose_system_apply_lead_score(uuid,jsonb,text),pose_private.ai_commit_chat(uuid,uuid,text,boolean,text,text,jsonb,jsonb,jsonb,jsonb),public.pose_system_ai_commit_chat(uuid,uuid,text,boolean,text,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.pose_system_ai_read_guest(uuid,text),pose_private.ai_record_extraction(uuid,text,uuid,text,jsonb,text),public.pose_system_record_ai_extraction(uuid,text,uuid,text,jsonb,text),pose_private.ai_apply_score(uuid,jsonb,text),public.pose_system_apply_lead_score(uuid,jsonb,text),pose_private.ai_commit_chat(uuid,uuid,text,boolean,text,text,jsonb,jsonb,jsonb,jsonb),public.pose_system_ai_commit_chat(uuid,uuid,text,boolean,text,text,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
