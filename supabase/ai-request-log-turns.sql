-- M06 AI Platform Dashboard. Apply after ai-request-log-cost.sql and ai-request-log-session.sql.
-- Groups model calls per customer question (turn) and adds Admin-only reporting functions.
-- Periods and buckets use Asia/Ho_Chi_Minh local time; weeks start on Monday.
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
  p_estimated_cost_usd numeric default 0, p_turn_id uuid default null, p_question_preview text default null
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
  p_estimated_cost_usd numeric default 0, p_turn_id uuid default null, p_question_preview text default null
) returns uuid language sql security invoker set search_path='' as $$
  select pose_private.log_ai_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
$$;
revoke all on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric,uuid,text) to service_role;

drop function if exists pose_private.ai_scope(timestamptz,timestamptz);

-- One row per turn: wall-clock latency = last call end - first call start.
create or replace function pose_private.ai_turn_summary(p_from timestamptz, p_to timestamptz)
returns table(turn_id uuid, started_at timestamptz, question_preview text, session_id uuid, calls bigint, tools text[],
  prompt_versions text[], total_tokens bigint, cost_usd numeric, turn_latency_ms numeric, worst_status text)
language sql stable security definer set search_path='' as $$
  select l.turn_id,
    min(l.created_at - l.latency_ms * interval '1 millisecond'),
    max(l.question_preview), (array_agg(l.session_id order by l.created_at))[1], count(*),
    coalesce((select array_agg(distinct t order by t) from public.ai_request_log l2, unnest(l2.tools_called) t where l2.turn_id = l.turn_id), '{}'),
    coalesce(array_agg(distinct l.prompt_version) filter (where l.prompt_version is not null), '{}'),
    sum(l.total_tokens)::bigint, sum(l.estimated_cost_usd),
    round((extract(epoch from max(l.created_at) - min(l.created_at - l.latency_ms * interval '1 millisecond')) * 1000)::numeric, 0),
    (array_agg(l.status order by case l.status when 'error' then 5 when 'timeout' then 4 when 'invalid_json' then 3 when 'fallback' then 2 else 1 end desc))[1]
  from public.ai_request_log l
  where pose_private.directory_admin() and l.turn_id is not null and l.created_at >= p_from and l.created_at < p_to
  group by l.turn_id
$$;
revoke all on function pose_private.ai_turn_summary(timestamptz,timestamptz) from public,anon;

create or replace function pose_private.admin_ai_overview()
returns table(period text, questions bigint, calls bigint, total_tokens bigint, cost_usd numeric,
  avg_turn_latency_ms numeric, p95_turn_latency_ms numeric, error_fallback_rate numeric)
language sql stable security definer set search_path='' as $$
  with local_now as (select now() at time zone 'Asia/Ho_Chi_Minh' t),
  ranges as (
    select 1 ord, 'today'::text period, date_trunc('day', t) at time zone 'Asia/Ho_Chi_Minh' start_at from local_now
    union all select 2, 'week', date_trunc('week', t) at time zone 'Asia/Ho_Chi_Minh' from local_now
    union all select 3, 'month', date_trunc('month', t) at time zone 'Asia/Ho_Chi_Minh' from local_now)
  select r.period,
    coalesce((select count(*) from pose_private.ai_turn_summary(r.start_at, now() + interval '1 second')), 0),
    coalesce(c.calls, 0), coalesce(c.tokens, 0), coalesce(c.cost, 0),
    (select round(avg(s.turn_latency_ms), 0) from pose_private.ai_turn_summary(r.start_at, now() + interval '1 second') s),
    (select round(percentile_cont(.95) within group (order by s.turn_latency_ms)::numeric, 0) from pose_private.ai_turn_summary(r.start_at, now() + interval '1 second') s),
    coalesce(c.error_rate, 0)
  from ranges r
  left join lateral (
    select count(*) calls, sum(l.total_tokens)::bigint tokens, round(sum(l.estimated_cost_usd), 6) cost,
      round(avg((l.status <> 'ok')::int)::numeric, 4) error_rate
    from public.ai_request_log l
    where pose_private.directory_admin() and l.created_at >= r.start_at and l.created_at < now() + interval '1 second'
  ) c on true
  where pose_private.directory_admin()
  order by r.ord
$$;

create or replace function pose_private.admin_ai_series(p_bucket text, p_from timestamptz, p_to timestamptz)
returns table(bucket_start timestamptz, questions bigint, calls bigint, total_tokens bigint, cost_usd numeric)
language sql stable security definer set search_path='' as $$
  select date_trunc(p_bucket, l.created_at at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh',
    count(distinct l.turn_id), count(*), sum(l.total_tokens)::bigint, round(sum(l.estimated_cost_usd), 6)
  from public.ai_request_log l
  where pose_private.directory_admin() and p_bucket in ('day','week','month')
    and l.created_at >= p_from and l.created_at < p_to
  group by 1 order by 1
$$;

create or replace function pose_private.admin_ai_by_kind(p_from timestamptz, p_to timestamptz)
returns table(kind text, model text, calls bigint, total_tokens bigint, cost_usd numeric, avg_latency_ms numeric, p95_latency_ms numeric, error_rate numeric)
language sql stable security definer set search_path='' as $$
  select l.kind, l.model, count(*), sum(l.total_tokens)::bigint, round(sum(l.estimated_cost_usd), 6),
    round(avg(l.latency_ms), 0), round(percentile_cont(.95) within group (order by l.latency_ms)::numeric, 0),
    round(avg((l.status <> 'ok')::int)::numeric, 4)
  from public.ai_request_log l
  where pose_private.directory_admin() and l.created_at >= p_from and l.created_at < p_to
  group by l.kind, l.model order by l.kind, l.model
$$;

create or replace function pose_private.admin_ai_turns(p_from timestamptz, p_to timestamptz, p_search text, p_limit int, p_offset int)
returns table(turn_id uuid, started_at timestamptz, question_preview text, session_id uuid, calls bigint, tools text[], prompt_versions text[],
  total_tokens bigint, cost_usd numeric, turn_latency_ms numeric, worst_status text, total_count bigint)
language sql stable security definer set search_path='' as $$
  select s.*, count(*) over ()
  from pose_private.ai_turn_summary(p_from, p_to) s
  where nullif(trim(p_search), '') is null or s.question_preview ilike '%' || trim(p_search) || '%'
  order by s.started_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function pose_private.admin_ai_turn_calls(p_turn_id uuid)
returns table(id uuid, created_at timestamptz, kind text, model text, prompt_version text, tools_called text[], prompt_tokens int,
  completion_tokens int, total_tokens int, estimated_cost_usd numeric, latency_ms int, status text, error_code text)
language sql stable security definer set search_path='' as $$
  select l.id, l.created_at, l.kind, l.model, l.prompt_version, l.tools_called, l.prompt_tokens, l.completion_tokens,
    l.total_tokens, l.estimated_cost_usd, l.latency_ms, l.status, l.error_code
  from public.ai_request_log l
  where pose_private.directory_admin() and l.turn_id = p_turn_id
  order by l.created_at, l.id
$$;

revoke all on function pose_private.admin_ai_overview() from public,anon; grant execute on function pose_private.admin_ai_overview() to authenticated;
revoke all on function pose_private.admin_ai_series(text,timestamptz,timestamptz) from public,anon; grant execute on function pose_private.admin_ai_series(text,timestamptz,timestamptz) to authenticated;
revoke all on function pose_private.admin_ai_by_kind(timestamptz,timestamptz) from public,anon; grant execute on function pose_private.admin_ai_by_kind(timestamptz,timestamptz) to authenticated;
revoke all on function pose_private.admin_ai_turns(timestamptz,timestamptz,text,int,int) from public,anon; grant execute on function pose_private.admin_ai_turns(timestamptz,timestamptz,text,int,int) to authenticated;
revoke all on function pose_private.admin_ai_turn_calls(uuid) from public,anon; grant execute on function pose_private.admin_ai_turn_calls(uuid) to authenticated;
grant execute on function pose_private.ai_turn_summary(timestamptz,timestamptz) to authenticated;

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
