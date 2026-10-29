-- Split the AI dashboard by provider without changing the request log.
-- OpenAI is the only provider included in dashboard totals; local calls remain visible separately.
begin;

create or replace function pose_private.ai_dashboard_require_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.require_account();
begin
  perform 1
  from auth.users
  where id = actor
    and raw_app_meta_data->>'role' = 'Admin'
  for share;
  if not found then
    raise exception 'AI_DASHBOARD_FORBIDDEN' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function pose_private.ai_dashboard_require_admin() from public, anon, authenticated;
grant execute on function pose_private.ai_dashboard_require_admin() to authenticated, service_role;

create or replace function pose_private.ai_model_provider(p_model text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when lower(trim(coalesce(p_model, ''))) = 'deterministic' then 'Deterministic'
    when lower(trim(coalesce(p_model, ''))) like 'gpt-%'
      or lower(trim(coalesce(p_model, ''))) like 'o%'
      or lower(trim(coalesce(p_model, ''))) like 'text-embedding-3-%' then 'OpenAI'
    else 'Local'
  end
$$;
revoke all on function pose_private.ai_model_provider(text) from public, anon, authenticated;

create or replace function pose_private.ai_turn_summary(p_from timestamptz, p_to timestamptz)
returns table(
  turn_id uuid,
  started_at timestamptz,
  question_preview text,
  session_id uuid,
  calls bigint,
  tools text[],
  prompt_versions text[],
  total_tokens bigint,
  cost_usd numeric,
  turn_latency_ms numeric,
  worst_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.turn_id,
    min(l.created_at - l.latency_ms * interval '1 millisecond'),
    max(l.question_preview),
    (array_agg(l.session_id order by l.created_at))[1],
    count(*) filter (where pose_private.ai_model_provider(l.model) = 'OpenAI'),
    coalesce((
      select array_agg(distinct t order by t)
      from public.ai_request_log l2, unnest(l2.tools_called) t
      where l2.turn_id = l.turn_id
    ), '{}'),
    coalesce(array_agg(distinct l.prompt_version) filter (where l.prompt_version is not null), '{}'),
    sum(l.total_tokens) filter (where pose_private.ai_model_provider(l.model) = 'OpenAI')::bigint,
    sum(l.estimated_cost_usd) filter (where pose_private.ai_model_provider(l.model) = 'OpenAI'),
    round((extract(epoch from max(l.created_at) - min(l.created_at - l.latency_ms * interval '1 millisecond')) * 1000)::numeric, 0),
    (array_agg(l.status order by case l.status when 'error' then 5 when 'timeout' then 4 when 'invalid_json' then 3 when 'fallback' then 2 else 1 end desc))[1]
  from public.ai_request_log l
  where pose_private.directory_admin()
    and l.turn_id is not null
    and l.created_at >= p_from
    and l.created_at < p_to
  group by l.turn_id
$$;

drop function if exists public.pose_system_admin_ai_overview();
drop function if exists pose_private.admin_ai_overview();
create function pose_private.admin_ai_overview()
returns table(
  period text,
  questions bigint,
  calls bigint,
  total_tokens bigint,
  cost_usd numeric,
  avg_turn_latency_ms numeric,
  p95_turn_latency_ms numeric,
  error_fallback_rate numeric,
  local_tokens bigint,
  local_calls bigint,
  log_started_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  with local_now as (
    select now() at time zone 'Asia/Ho_Chi_Minh' t
  ),
  ranges as (
    select 1 ord, 'today'::text period, date_trunc('day', t) at time zone 'Asia/Ho_Chi_Minh' start_at from local_now
    union all
    select 2, 'week', date_trunc('week', t) at time zone 'Asia/Ho_Chi_Minh' from local_now
    union all
    select 3, 'month', date_trunc('month', t) at time zone 'Asia/Ho_Chi_Minh' from local_now
  ),
  log_start as (
    select min(l.created_at) log_started_at
    from public.ai_request_log l
    where pose_private.directory_admin()
  )
  select r.period,
    coalesce((select count(*) from pose_private.ai_turn_summary(r.start_at, now() + interval '1 second')), 0),
    coalesce(c.calls, 0),
    coalesce(c.tokens, 0),
    coalesce(c.cost, 0),
    (select round(avg(s.turn_latency_ms), 0) from pose_private.ai_turn_summary(r.start_at, now() + interval '1 second') s),
    (select round(percentile_cont(.95) within group (order by s.turn_latency_ms)::numeric, 0)
     from pose_private.ai_turn_summary(r.start_at, now() + interval '1 second') s),
    coalesce(c.error_rate, 0),
    coalesce(c.local_tokens, 0),
    coalesce(c.local_calls, 0),
    log_start.log_started_at
  from ranges r
  cross join log_start
  left join lateral (
    select
      count(*) filter (where pose_private.ai_model_provider(l.model) = 'OpenAI') calls,
      sum(l.total_tokens) filter (where pose_private.ai_model_provider(l.model) = 'OpenAI')::bigint tokens,
      round(sum(l.estimated_cost_usd) filter (where pose_private.ai_model_provider(l.model) = 'OpenAI'), 6) cost,
      round(avg((l.status <> 'ok')::int) filter (where pose_private.ai_model_provider(l.model) = 'OpenAI')::numeric, 4) error_rate,
      sum(l.total_tokens) filter (where pose_private.ai_model_provider(l.model) = 'Local')::bigint local_tokens,
      count(*) filter (where pose_private.ai_model_provider(l.model) = 'Local') local_calls
    from public.ai_request_log l
    where pose_private.directory_admin()
      and l.created_at >= r.start_at
      and l.created_at < now() + interval '1 second'
  ) c on true
  where pose_private.directory_admin()
  order by r.ord
  ;
end $$;

create or replace function pose_private.admin_ai_series(p_bucket text, p_from timestamptz, p_to timestamptz)
returns table(bucket_start timestamptz, questions bigint, calls bigint, total_tokens bigint, cost_usd numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select date_trunc(p_bucket, l.created_at at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh',
    count(distinct l.turn_id), count(*), sum(l.total_tokens)::bigint, round(sum(l.estimated_cost_usd), 6)
  from public.ai_request_log l
  where pose_private.directory_admin()
    and p_bucket in ('day', 'week', 'month')
    and pose_private.ai_model_provider(l.model) = 'OpenAI'
    and l.created_at >= p_from
    and l.created_at < p_to
  group by 1
  order by 1;
end $$;

create or replace function pose_private.admin_ai_by_kind(p_from timestamptz, p_to timestamptz)
returns table(kind text, model text, calls bigint, total_tokens bigint, cost_usd numeric, avg_latency_ms numeric, p95_latency_ms numeric, error_rate numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select l.kind, l.model, count(*), sum(l.total_tokens)::bigint, round(sum(l.estimated_cost_usd), 6),
    round(avg(l.latency_ms), 0), round(percentile_cont(.95) within group (order by l.latency_ms)::numeric, 0),
    round(avg((l.status <> 'ok')::int)::numeric, 4)
  from public.ai_request_log l
  where pose_private.directory_admin()
    and pose_private.ai_model_provider(l.model) = 'OpenAI'
    and l.created_at >= p_from
    and l.created_at < p_to
  group by l.kind, l.model
  order by l.kind, l.model;
end $$;

create function pose_private.admin_ai_by_model(p_from timestamptz, p_to timestamptz)
returns table(model text, provider text, calls bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric, avg_latency_ms numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  with grouped as (
    select l.model,
      pose_private.ai_model_provider(l.model) provider,
      count(*) calls,
      sum(l.prompt_tokens)::bigint input_tokens,
      sum(l.completion_tokens)::bigint output_tokens,
      round(sum(l.estimated_cost_usd), 6) cost_usd,
      round(avg(l.latency_ms), 0) avg_latency_ms
    from public.ai_request_log l
    where pose_private.directory_admin()
      and l.created_at >= p_from
      and l.created_at < p_to
      and pose_private.ai_model_provider(l.model) in ('OpenAI', 'Local')
    group by l.model, pose_private.ai_model_provider(l.model)
  ),
  openai_total as (
    select 'Tổng OpenAI'::text model,
      'OpenAI'::text provider,
      count(*) calls,
      coalesce(sum(l.prompt_tokens), 0)::bigint input_tokens,
      coalesce(sum(l.completion_tokens), 0)::bigint output_tokens,
      coalesce(round(sum(l.estimated_cost_usd), 6), 0) cost_usd,
      coalesce(round(avg(l.latency_ms), 0), 0) avg_latency_ms
    from public.ai_request_log l
    where pose_private.directory_admin()
      and l.created_at >= p_from
      and l.created_at < p_to
      and pose_private.ai_model_provider(l.model) = 'OpenAI'
  )
  select rows.model, rows.provider, rows.calls, rows.input_tokens, rows.output_tokens, rows.cost_usd, rows.avg_latency_ms
  from (
    select * from grouped
    union all
    select * from openai_total
  ) rows
  order by case rows.provider when 'OpenAI' then 1 when 'Local' then 2 else 3 end,
    case when rows.model = 'Tổng OpenAI' then 2 else 1 end,
    rows.model;
end $$;

create or replace function pose_private.admin_ai_turns(p_from timestamptz, p_to timestamptz, p_search text, p_limit int, p_offset int)
returns table(
  turn_id uuid,
  started_at timestamptz,
  question_preview text,
  session_id uuid,
  calls bigint,
  tools text[],
  prompt_versions text[],
  total_tokens bigint,
  cost_usd numeric,
  turn_latency_ms numeric,
  worst_status text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select s.*, count(*) over ()
  from pose_private.ai_turn_summary(p_from, p_to) s
  where nullif(trim(p_search), '') is null or s.question_preview ilike '%' || trim(p_search) || '%'
  order by s.started_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function pose_private.admin_ai_turn_calls(p_turn_id uuid)
returns table(
  id uuid,
  created_at timestamptz,
  kind text,
  model text,
  prompt_version text,
  tools_called text[],
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  estimated_cost_usd numeric,
  latency_ms int,
  status text,
  error_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select l.id, l.created_at, l.kind, l.model, l.prompt_version, l.tools_called, l.prompt_tokens, l.completion_tokens,
    l.total_tokens, l.estimated_cost_usd, l.latency_ms, l.status, l.error_code
  from public.ai_request_log l
  where pose_private.directory_admin() and l.turn_id = p_turn_id
  order by l.created_at, l.id;
end $$;

create or replace function pose_private.admin_ai_usage(p_from timestamptz, p_to timestamptz, p_price_input_per_m numeric, p_price_output_per_m numeric)
returns table(day date, model text, requests bigint, total_tokens bigint, p50_latency_ms numeric, p95_latency_ms numeric, fallback_rate numeric, estimated_cost numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select l.created_at::date, l.model, count(*), sum(l.total_tokens)::bigint,
    (percentile_cont(.5) within group(order by l.latency_ms))::numeric,
    (percentile_cont(.95) within group(order by l.latency_ms))::numeric,
    round(avg((l.status='fallback')::int)::numeric,4),
    round((sum(l.prompt_tokens)*coalesce(p_price_input_per_m,0)/1000000+sum(l.completion_tokens)*coalesce(p_price_output_per_m,0)/1000000)::numeric,6)
  from public.ai_request_log l
  where pose_private.directory_admin()
    and l.created_at>=coalesce(p_from,now()-interval '30 days')
    and l.created_at<coalesce(p_to,now())
  group by 1,2 order by 1 desc,2;
end $$;

revoke all on function pose_private.admin_ai_overview() from public, anon;
grant execute on function pose_private.admin_ai_overview() to authenticated, service_role;
revoke all on function pose_private.admin_ai_series(text, timestamptz, timestamptz) from public, anon;
grant execute on function pose_private.admin_ai_series(text, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function pose_private.admin_ai_by_kind(timestamptz, timestamptz) from public, anon;
grant execute on function pose_private.admin_ai_by_kind(timestamptz, timestamptz) to authenticated, service_role;
revoke all on function pose_private.admin_ai_by_model(timestamptz, timestamptz) from public, anon;
grant execute on function pose_private.admin_ai_by_model(timestamptz, timestamptz) to authenticated, service_role;
revoke all on function pose_private.admin_ai_turns(timestamptz, timestamptz, text, int, int) from public, anon;
grant execute on function pose_private.admin_ai_turns(timestamptz, timestamptz, text, int, int) to authenticated, service_role;
revoke all on function pose_private.admin_ai_turn_calls(uuid) from public, anon;
grant execute on function pose_private.admin_ai_turn_calls(uuid) to authenticated, service_role;
revoke all on function pose_private.admin_ai_usage(timestamptz, timestamptz, numeric, numeric) from public, anon;
grant execute on function pose_private.admin_ai_usage(timestamptz, timestamptz, numeric, numeric) to authenticated, service_role;

create function public.pose_system_admin_ai_overview()
returns table(period text, questions bigint, calls bigint, total_tokens bigint, cost_usd numeric,
  avg_turn_latency_ms numeric, p95_turn_latency_ms numeric, error_fallback_rate numeric,
  local_tokens bigint, local_calls bigint, log_started_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select * from pose_private.admin_ai_overview()
  ;
end $$;
create or replace function public.pose_system_admin_ai_series(p_bucket text, p_from timestamptz, p_to timestamptz)
returns table(bucket_start timestamptz, questions bigint, calls bigint, total_tokens bigint, cost_usd numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select * from pose_private.admin_ai_series($1, $2, $3)
  ;
end $$;
create or replace function public.pose_system_admin_ai_by_kind(p_from timestamptz, p_to timestamptz)
returns table(kind text, model text, calls bigint, total_tokens bigint, cost_usd numeric, avg_latency_ms numeric, p95_latency_ms numeric, error_rate numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select * from pose_private.admin_ai_by_kind($1, $2)
  ;
end $$;
create function public.pose_system_admin_ai_by_model(p_from timestamptz, p_to timestamptz)
returns table(model text, provider text, calls bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric, avg_latency_ms numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select * from pose_private.admin_ai_by_model($1, $2)
  ;
end $$;

create or replace function public.pose_system_admin_ai_turns(p_from timestamptz, p_to timestamptz, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table(
  turn_id uuid,
  started_at timestamptz,
  question_preview text,
  session_id uuid,
  calls bigint,
  tools text[],
  prompt_versions text[],
  total_tokens bigint,
  cost_usd numeric,
  turn_latency_ms numeric,
  worst_status text,
  total_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select * from pose_private.admin_ai_turns($1, $2, $3, $4, $5);
end $$;

create or replace function public.pose_system_admin_ai_turn_calls(p_turn_id uuid)
returns table(
  id uuid,
  created_at timestamptz,
  kind text,
  model text,
  prompt_version text,
  tools_called text[],
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  estimated_cost_usd numeric,
  latency_ms int,
  status text,
  error_code text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select * from pose_private.admin_ai_turn_calls($1);
end $$;

create or replace function public.pose_system_admin_ai_usage(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_price_input_per_m numeric default 0,
  p_price_output_per_m numeric default 0
)
returns setof pose_private.admin_ai_usage
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := pose_private.ai_dashboard_require_admin();
begin
  return query
  select * from pose_private.admin_ai_usage($1, $2, $3, $4);
end $$;

revoke all on function public.pose_system_admin_ai_overview() from public, anon;
grant execute on function public.pose_system_admin_ai_overview() to authenticated, service_role;
revoke all on function public.pose_system_admin_ai_series(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.pose_system_admin_ai_series(text, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.pose_system_admin_ai_by_kind(timestamptz, timestamptz) from public, anon;
grant execute on function public.pose_system_admin_ai_by_kind(timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.pose_system_admin_ai_by_model(timestamptz, timestamptz) from public, anon;
grant execute on function public.pose_system_admin_ai_by_model(timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.pose_system_admin_ai_turns(timestamptz, timestamptz, text, int, int) from public, anon;
grant execute on function public.pose_system_admin_ai_turns(timestamptz, timestamptz, text, int, int) to authenticated, service_role;
revoke all on function public.pose_system_admin_ai_turn_calls(uuid) from public, anon;
grant execute on function public.pose_system_admin_ai_turn_calls(uuid) to authenticated, service_role;
revoke all on function public.pose_system_admin_ai_usage(timestamptz, timestamptz, numeric, numeric) from public, anon;
grant execute on function public.pose_system_admin_ai_usage(timestamptz, timestamptz, numeric, numeric) to authenticated, service_role;

commit;
