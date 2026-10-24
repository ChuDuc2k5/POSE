-- M06 AI Platform Dashboard. Apply after ai-request-log-cost.sql and ai-request-log-session.sql.
begin;
alter table public.ai_request_log
  add column if not exists turn_id uuid,
  add column if not exists question_preview text check (char_length(question_preview) <= 160);
create index if not exists ai_request_log_turn_idx on public.ai_request_log(turn_id);
create index if not exists ai_request_log_created_at_idx on public.ai_request_log(created_at);

drop function if exists public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric);
drop function if exists pose_private.log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric);
create or replace function pose_private.log_ai_request(
  p_session_id uuid, p_kind text, p_model text, p_prompt_name text, p_prompt_version text,
  p_tools_called text[], p_prompt_tokens int, p_completion_tokens int, p_total_tokens int,
  p_latency_ms int, p_status text, p_error_code text default null,
  p_estimated_cost_usd numeric default 0, p_turn_id uuid default null,
  p_question_preview text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  insert into public.ai_request_log(session_id,kind,model,prompt_name,prompt_version,tools_called,
    prompt_tokens,completion_tokens,total_tokens,latency_ms,status,error_code,estimated_cost_usd,turn_id,question_preview)
  values(p_session_id,p_kind,p_model,p_prompt_name,p_prompt_version,coalesce(p_tools_called,'{}'),
    coalesce(p_prompt_tokens,0),coalesce(p_completion_tokens,0),coalesce(p_total_tokens,0),coalesce(p_latency_ms,0),
    p_status,p_error_code,greatest(coalesce(p_estimated_cost_usd,0),0),p_turn_id,left(p_question_preview,160))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pose_private.log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric,uuid,text) from public,anon,authenticated;
grant execute on function pose_private.log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric,uuid,text) to service_role;

create or replace function public.pose_system_log_ai_request(
  p_session_id uuid, p_kind text, p_model text, p_prompt_name text, p_prompt_version text,
  p_tools_called text[], p_prompt_tokens int, p_completion_tokens int, p_total_tokens int,
  p_latency_ms int, p_status text, p_error_code text default null,
  p_estimated_cost_usd numeric default 0, p_turn_id uuid default null,
  p_question_preview text default null
) returns uuid language sql security invoker set search_path='' as $$
  select pose_private.log_ai_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
$$;
revoke all on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric,uuid,text) to service_role;

create or replace function pose_private.ai_scope(p_from timestamptz, p_to timestamptz)
returns table(id uuid, turn_id uuid, session_id uuid, kind text, model text, prompt_name text, prompt_version text,
  tools_called text[], prompt_tokens int, completion_tokens int, total_tokens int, latency_ms int, status text,
  error_code text, estimated_cost_usd numeric, question_preview text, created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select l.id,l.turn_id,l.session_id,l.kind,l.model,l.prompt_name,l.prompt_version,l.tools_called,l.prompt_tokens,
    l.completion_tokens,l.total_tokens,l.latency_ms,l.status,l.error_code,l.estimated_cost_usd,l.question_preview,l.created_at
  from public.ai_request_log l
  where pose_private.directory_admin() and l.created_at >= coalesce(p_from, '-infinity'::timestamptz)
    and l.created_at < coalesce(p_to, 'infinity'::timestamptz)
$$;

create or replace function pose_private.admin_ai_overview()
returns table(period text, questions bigint, calls bigint, total_tokens bigint, cost_usd numeric,
  avg_turn_latency_ms numeric, p95_turn_latency_ms numeric, error_fallback_rate numeric)
language sql stable security definer set search_path='' as $$
with ranges as (
  select 'today' period, (current_date at time zone 'Asia/Ho_Chi_Minh') today_start, now() end_at
  union all select 'week', (current_date - (extract(isodow from current_date)::int-1)) at time zone 'Asia/Ho_Chi_Minh', now()
  union all select 'month', date_trunc('month',current_date)::date at time zone 'Asia/Ho_Chi_Minh', now()
), rows as (select r.period,l.* from ranges r join public.ai_request_log l on l.created_at>=r.today_start and l.created_at<r.end_at),
turns as (select period,turn_id,extract(epoch from max(created_at)-min(created_at-latency_ms*interval '1 millisecond'))*1000 latency from rows where turn_id is not null group by period,turn_id)
select r.period,count(distinct r.turn_id)::bigint,count(*)::bigint,sum(r.total_tokens)::bigint,round(sum(r.estimated_cost_usd),6),
  round(avg(t.latency),2),round(percentile_cont(.95) within group(order by t.latency)::numeric,2),
  round(avg((r.status in ('fallback','error','timeout','invalid_json'))::int)::numeric,4)
from rows r left join turns t using(period,turn_id) where pose_private.directory_admin() group by r.period order by array_position(array['today','week','month'],r.period)
$$;

create or replace function pose_private.admin_ai_series(p_bucket text, p_from timestamptz, p_to timestamptz)
returns table(bucket_start timestamptz, questions bigint, calls bigint, total_tokens bigint, cost_usd numeric)
language sql stable security definer set search_path='' as $$
with x as (select l.*,case when p_bucket='day' then date_trunc('day',l.created_at at time zone 'Asia/Ho_Chi_Minh') when p_bucket='week' then date_trunc('week',l.created_at at time zone 'Asia/Ho_Chi_Minh') when p_bucket='month' then date_trunc('month',l.created_at at time zone 'Asia/Ho_Chi_Minh') end as b from public.ai_request_log l where pose_private.directory_admin() and l.created_at>=p_from and l.created_at<p_to)
select b at time zone 'Asia/Ho_Chi_Minh',count(distinct turn_id),count(*),sum(total_tokens)::bigint,round(sum(estimated_cost_usd),6) from x group by b order by b
$$;

create or replace function pose_private.admin_ai_by_kind(p_from timestamptz, p_to timestamptz)
returns table(kind text, model text, calls bigint, total_tokens bigint, cost_usd numeric, avg_latency_ms numeric, p95_latency_ms numeric, error_rate numeric)
language sql stable security definer set search_path='' as $$
select kind,model,count(*),sum(total_tokens)::bigint,round(sum(estimated_cost_usd),6),round(avg(latency_ms),2),round(percentile_cont(.95) within group(order by latency_ms)::numeric,2),round(avg((status in ('fallback','error','timeout','invalid_json'))::int)::numeric,4)
from public.ai_request_log where pose_private.directory_admin() and created_at>=p_from and created_at<p_to group by kind,model order by kind,model
$$;

create or replace function pose_private.admin_ai_turns(p_from timestamptz, p_to timestamptz, p_search text, p_limit int, p_offset int)
returns table(turn_id uuid, started_at timestamptz, question_preview text, session_id uuid, calls bigint, tools text[], prompt_versions text[], total_tokens bigint, cost_usd numeric, turn_latency_ms numeric, worst_status text, total_count bigint)
language sql stable security definer set search_path='' as $$
with x as (select * from public.ai_request_log where pose_private.directory_admin() and turn_id is not null and created_at>=p_from and created_at<p_to and (nullif(trim(p_search),'') is null or question_preview ilike '%'||trim(p_search)||'%')),
g as (select turn_id,min(created_at) started_at,max(question_preview) question_preview,(array_agg(session_id))[1] session_id,count(*) calls,array_remove(array_agg(distinct unnest_tool order by unnest_tool),'') tools,array_agg(distinct prompt_version) filter(where prompt_version is not null) prompt_versions,sum(total_tokens)::bigint total_tokens,round(sum(estimated_cost_usd),6) cost_usd,extract(epoch from max(created_at)-min(created_at-latency_ms*interval '1 millisecond'))*1000 turn_latency_ms,(array_agg(status order by case status when 'error' then 5 when 'timeout' then 4 when 'invalid_json' then 3 when 'fallback' then 2 else 1 end desc))[1] worst_status from (select x.*,unnest(x.tools_called) unnest_tool from x) q group by turn_id)
select g.*,count(*) over() total_count from g order by started_at desc limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0)
$$;

create or replace function pose_private.admin_ai_turn_calls(p_turn_id uuid)
returns table(id uuid, created_at timestamptz, kind text, model text, prompt_version text, tools_called text[], prompt_tokens int, completion_tokens int, total_tokens int, estimated_cost_usd numeric, latency_ms int, status text, error_code text)
language sql stable security definer set search_path='' as $$
select id,created_at,kind,model,prompt_version,tools_called,prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,latency_ms,status,error_code from public.ai_request_log where pose_private.directory_admin() and turn_id=p_turn_id order by created_at,id
$$;

revoke all on function pose_private.admin_ai_overview() from public,anon; grant execute on function pose_private.admin_ai_overview() to authenticated;
revoke all on function pose_private.admin_ai_series(text,timestamptz,timestamptz) from public,anon; grant execute on function pose_private.admin_ai_series(text,timestamptz,timestamptz) to authenticated;
revoke all on function pose_private.admin_ai_by_kind(timestamptz,timestamptz) from public,anon; grant execute on function pose_private.admin_ai_by_kind(timestamptz,timestamptz) to authenticated;
revoke all on function pose_private.admin_ai_turns(timestamptz,timestamptz,text,int,int) from public,anon; grant execute on function pose_private.admin_ai_turns(timestamptz,timestamptz,text,int,int) to authenticated;
revoke all on function pose_private.admin_ai_turn_calls(uuid) from public,anon; grant execute on function pose_private.admin_ai_turn_calls(uuid) to authenticated;

create or replace function public.pose_system_admin_ai_overview() returns table(period text,questions bigint,calls bigint,total_tokens bigint,cost_usd numeric,avg_turn_latency_ms numeric,p95_turn_latency_ms numeric,error_fallback_rate numeric) language sql security invoker set search_path='' as $$ select * from pose_private.admin_ai_overview() $$;
create or replace function public.pose_system_admin_ai_series(p_bucket text,p_from timestamptz,p_to timestamptz) returns table(bucket_start timestamptz,questions bigint,calls bigint,total_tokens bigint,cost_usd numeric) language sql security invoker set search_path='' as $$ select * from pose_private.admin_ai_series($1,$2,$3) $$;
create or replace function public.pose_system_admin_ai_by_kind(p_from timestamptz,p_to timestamptz) returns table(kind text,model text,calls bigint,total_tokens bigint,cost_usd numeric,avg_latency_ms numeric,p95_latency_ms numeric,error_rate numeric) language sql security invoker set search_path='' as $$ select * from pose_private.admin_ai_by_kind($1,$2) $$;
create or replace function public.pose_system_admin_ai_turns(p_from timestamptz,p_to timestamptz,p_search text default null,p_limit int default 25,p_offset int default 0) returns table(turn_id uuid,started_at timestamptz,question_preview text,session_id uuid,calls bigint,tools text[],prompt_versions text[],total_tokens bigint,cost_usd numeric,turn_latency_ms numeric,worst_status text,total_count bigint) language sql security invoker set search_path='' as $$ select * from pose_private.admin_ai_turns($1,$2,$3,$4,$5) $$;
create or replace function public.pose_system_admin_ai_turn_calls(p_turn_id uuid) returns table(id uuid,created_at timestamptz,kind text,model text,prompt_version text,tools_called text[],prompt_tokens int,completion_tokens int,total_tokens int,estimated_cost_usd numeric,latency_ms int,status text,error_code text) language sql security invoker set search_path='' as $$ select * from pose_private.admin_ai_turn_calls($1) $$;
revoke all on function public.pose_system_admin_ai_overview() from public,anon; grant execute on function public.pose_system_admin_ai_overview() to authenticated;
revoke all on function public.pose_system_admin_ai_series(text,timestamptz,timestamptz) from public,anon; grant execute on function public.pose_system_admin_ai_series(text,timestamptz,timestamptz) to authenticated;
revoke all on function public.pose_system_admin_ai_by_kind(timestamptz,timestamptz) from public,anon; grant execute on function public.pose_system_admin_ai_by_kind(timestamptz,timestamptz) to authenticated;
revoke all on function public.pose_system_admin_ai_turns(timestamptz,timestamptz,text,int,int) from public,anon; grant execute on function public.pose_system_admin_ai_turns(timestamptz,timestamptz,text,int,int) to authenticated;
revoke all on function public.pose_system_admin_ai_turn_calls(uuid) from public,anon; grant execute on function public.pose_system_admin_ai_turn_calls(uuid) to authenticated;
commit;
