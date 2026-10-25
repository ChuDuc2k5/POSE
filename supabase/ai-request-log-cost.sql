-- M06 governance: per-request cost. Apply after ai-request-log.sql.
-- The cost is fixed when the request is logged (tokens x the price configured at that time),
-- so later price changes do not rewrite history. Local models log 0.
begin;
alter table public.ai_request_log add column if not exists estimated_cost_usd numeric(14,8) not null default 0 check (estimated_cost_usd >= 0);

drop function if exists public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text);
drop function if exists pose_private.log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text);

create function pose_private.log_ai_request(p_session_id uuid,p_kind text,p_model text,p_prompt_name text,p_prompt_version text,p_tools_called text[],p_prompt_tokens int,p_completion_tokens int,p_total_tokens int,p_latency_ms int,p_status text,p_error_code text default null,p_estimated_cost_usd numeric default 0) returns uuid
language plpgsql security definer set search_path='' as $$ declare v_id uuid; begin
  insert into public.ai_request_log(session_id,kind,model,prompt_name,prompt_version,tools_called,prompt_tokens,completion_tokens,total_tokens,latency_ms,status,error_code,estimated_cost_usd)
  values(p_session_id,p_kind,p_model,p_prompt_name,p_prompt_version,coalesce(p_tools_called,'{}'),coalesce(p_prompt_tokens,0),coalesce(p_completion_tokens,0),coalesce(p_total_tokens,0),coalesce(p_latency_ms,0),p_status,p_error_code,greatest(coalesce(p_estimated_cost_usd,0),0)) returning id into v_id; return v_id;
end $$;
revoke all on function pose_private.log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric) from public,anon,authenticated;
grant execute on function pose_private.log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric) to service_role;

create function public.pose_system_log_ai_request(p_session_id uuid,p_kind text,p_model text,p_prompt_name text,p_prompt_version text,p_tools_called text[],p_prompt_tokens int,p_completion_tokens int,p_total_tokens int,p_latency_ms int,p_status text,p_error_code text default null,p_estimated_cost_usd numeric default 0) returns uuid
language sql security invoker set search_path='' as $$ select pose_private.log_ai_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) $$;
revoke all on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric) from public,anon,authenticated;
grant execute on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text,numeric) to service_role;

-- Usage report sums the stored per-request cost (price parameters are no longer needed).
drop function if exists public.pose_system_admin_ai_usage(timestamptz,timestamptz,numeric,numeric);
drop function if exists pose_private.admin_ai_usage(timestamptz,timestamptz,numeric,numeric);
create function pose_private.admin_ai_usage(p_from timestamptz,p_to timestamptz)
returns table(day date,model text,requests bigint,total_tokens bigint,p50_latency_ms numeric,p95_latency_ms numeric,fallback_rate numeric,estimated_cost numeric)
language sql stable security definer set search_path='' as $$
  select created_at::date,model,count(*),sum(total_tokens)::bigint,
    (percentile_cont(.5) within group(order by latency_ms))::numeric,(percentile_cont(.95) within group(order by latency_ms))::numeric,
    round(avg((status='fallback')::int)::numeric,4),round(sum(estimated_cost_usd),6)
  from public.ai_request_log
  where pose_private.directory_admin() and created_at>=coalesce(p_from,now()-interval '30 days') and created_at<coalesce(p_to,now())
  group by 1,2 order by 1 desc,2
$$;
revoke all on function pose_private.admin_ai_usage(timestamptz,timestamptz) from public,anon;
grant execute on function pose_private.admin_ai_usage(timestamptz,timestamptz) to authenticated;
create function public.pose_system_admin_ai_usage(p_from timestamptz default null,p_to timestamptz default null)
returns setof pose_private.admin_ai_usage language sql security invoker set search_path='' as $$
  select * from pose_private.admin_ai_usage($1,$2)
$$;
revoke all on function public.pose_system_admin_ai_usage(timestamptz,timestamptz) from public,anon;
grant execute on function public.pose_system_admin_ai_usage(timestamptz,timestamptz) to authenticated;
commit;
