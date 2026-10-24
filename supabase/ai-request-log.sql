-- M06 governance: apply after the base AI chat migrations.
create table if not exists public.ai_request_log (
  id uuid primary key default gen_random_uuid(), session_id uuid references public.ai_chat_sessions(id) on delete set null,
  created_at timestamptz not null default now(), kind text not null check (kind in ('chat','query','rerank','answer_meta','needs','embed')),
  model text not null, prompt_name text, prompt_version text, tools_called text[] not null default '{}',
  prompt_tokens int not null default 0, completion_tokens int not null default 0, total_tokens int not null default 0,
  latency_ms int not null default 0, status text not null check (status in ('ok','fallback','timeout','invalid_json','error')), error_code text
);
alter table public.ai_request_log enable row level security;
revoke all on public.ai_request_log from anon, authenticated;

create or replace function pose_private.log_ai_request(p_session_id uuid,p_kind text,p_model text,p_prompt_name text,p_prompt_version text,p_tools_called text[],p_prompt_tokens int,p_completion_tokens int,p_total_tokens int,p_latency_ms int,p_status text,p_error_code text default null) returns uuid
language plpgsql security definer set search_path='' as $$ declare v_id uuid; begin
  insert into public.ai_request_log(session_id,kind,model,prompt_name,prompt_version,tools_called,prompt_tokens,completion_tokens,total_tokens,latency_ms,status,error_code)
  values(p_session_id,p_kind,p_model,p_prompt_name,p_prompt_version,coalesce(p_tools_called,'{}'),coalesce(p_prompt_tokens,0),coalesce(p_completion_tokens,0),coalesce(p_total_tokens,0),coalesce(p_latency_ms,0),p_status,p_error_code) returning id into v_id; return v_id;
end $$;
revoke all on function pose_private.log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text) from public,anon,authenticated;

create or replace function public.pose_system_log_ai_request(p_session_id uuid,p_kind text,p_model text,p_prompt_name text,p_prompt_version text,p_tools_called text[],p_prompt_tokens int,p_completion_tokens int,p_total_tokens int,p_latency_ms int,p_status text,p_error_code text default null) returns uuid
language sql security invoker set search_path='' as $$ select pose_private.log_ai_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) $$;
revoke all on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text) from public,anon,authenticated;
grant execute on function public.pose_system_log_ai_request(uuid,text,text,text,text,text[],int,int,int,int,text,text) to service_role;

create or replace function pose_private.admin_ai_usage(p_from timestamptz,p_to timestamptz,p_price_input_per_m numeric,p_price_output_per_m numeric)
returns table(day date,model text,requests bigint,total_tokens bigint,p50_latency_ms numeric,p95_latency_ms numeric,fallback_rate numeric,estimated_cost numeric)
language sql security invoker set search_path='' as $$
  select created_at::date,model,count(*),sum(total_tokens),percentile_cont(.5) within group(order by latency_ms),percentile_cont(.95) within group(order by latency_ms),round(avg((status='fallback')::int)::numeric,4),round((sum(prompt_tokens)*coalesce(p_price_input_per_m,0)/1000000+sum(completion_tokens)*coalesce(p_price_output_per_m,0)/1000000),6)
  from public.ai_request_log where created_at>=coalesce(p_from,now()-interval '30 days') and created_at<coalesce(p_to,now()) group by 1,2 order by 1 desc,2
$$;

create or replace function public.pose_system_admin_ai_usage(p_from timestamptz default null,p_to timestamptz default null,p_price_input_per_m numeric default 0,p_price_output_per_m numeric default 0)
returns setof pose_private.admin_ai_usage language sql security invoker set search_path='' as $$
  select * from pose_private.admin_ai_usage($1,$2,$3,$4) where pose_private.directory_admin()
$$;
revoke all on function public.pose_system_admin_ai_usage(timestamptz,timestamptz,numeric,numeric) from public,anon;
grant execute on function public.pose_system_admin_ai_usage(timestamptz,timestamptz,numeric,numeric) to authenticated;
