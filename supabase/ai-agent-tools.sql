-- Apply after ai-agent.sql. This delta is safe for databases where ai-agent.sql is already live.
begin;
create table public.ai_pending_actions (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, tool text not null check(tool in ('save_favorite','request_handoff','propose_appointment')),
  args jsonb not null check(jsonb_typeof(args)='object'), summary_vi text not null check(char_length(btrim(summary_vi)) between 3 and 2000),
  status text not null default 'Pending' check(status in ('Pending','Confirmed','Cancelled','Expired','Failed')),
  idempotency_key text not null unique, expires_at timestamptz not null default now()+interval '10 minutes', created_at timestamptz not null default now(), decided_at timestamptz, result jsonb
);
create index ai_pending_actions_owner_idx on public.ai_pending_actions(user_id,created_at desc);
alter table public.ai_pending_actions enable row level security;
revoke all on public.ai_pending_actions from public,anon,authenticated;
grant select on public.ai_pending_actions to authenticated;
create policy ai_pending_owner on public.ai_pending_actions for select to authenticated using(user_id=(select auth.uid()));

create function pose_private.ai_pending_create(p_session uuid,p_tool text,p_args jsonb,p_summary text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account(); a public.ai_pending_actions;
begin
 if p_tool not in ('save_favorite','request_handoff','propose_appointment') or p_args is null or p_key is null or char_length(p_key)<8 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 insert into public.ai_pending_actions(session_id,user_id,tool,args,summary_vi,idempotency_key) values(p_session,actor,p_tool,p_args,btrim(p_summary),p_key) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into a;
 return to_jsonb(a);
end $$;

create function pose_private.ai_pending_decide(p_action uuid,p_confirm boolean,p_consents jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account(); a public.ai_pending_actions; r jsonb; code text; prop uuid; c public.customers; lead_id uuid; phone text; purpose text; label text;
begin
 select * into a from public.ai_pending_actions where id=p_action and user_id=actor for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status='Confirmed' or a.status='Cancelled' or a.status='Failed' then return coalesce(a.result,jsonb_build_object('status',a.status)); end if;
 if a.expires_at<=now() then update public.ai_pending_actions set status='Expired',decided_at=now() where id=a.id; raise exception 'ACTION_EXPIRED' using errcode='P0003'; end if;
 if not p_confirm then update public.ai_pending_actions set status='Cancelled',decided_at=now(),result='{"status":"cancelled"}'::jsonb where id=a.id; return '{"status":"cancelled"}'::jsonb; end if;
 begin
  if a.tool='save_favorite' then
   code:=a.args->>'code'; select id into prop from public.property_public_catalog where code=code and publication_status='Published' limit 1;
   if prop is null then raise exception 'PROPERTY_NOT_FOUND' using errcode='P0002'; end if;
   r:=public.pose_set_favorite(prop,true);
  elsif a.tool='request_handoff' then
   r:=public.pose_ai_request_handoff(a.session_id,a.args->>'summary',null,null,'pending:'||a.id::text);
  else
   code:=nullif(a.args->>'code',''); select id into prop from public.property_public_catalog where code=code and publication_status='Published' limit 1;
   r:=public.pose_ai_request_handoff(a.session_id,'Đề nghị lịch xem'||coalesce(' '||code,''), (a.args->>'preferred_start')::timestamptz, coalesce((a.args->>'preferred_end')::timestamptz,(a.args->>'preferred_start')::timestamptz+interval '1 hour'),'pending:'||a.id::text);
  end if;
  if coalesce(p_consents->>'Call','false')='true' or coalesce(p_consents->>'AIVoice','false')='true' then
   select cu.* into c from public.customers cu where cu.auth_user_id=actor and cu.phone_verified_at is not null and cu.phone~'^\+[1-9][0-9]{7,14}$' for update;
   if c.id is not null then select id into lead_id from public.leads where customer_id=c.id and not archived and status not in ('CONVERTED','LOST') order by created_at limit 1; phone:=c.phone;
    foreach purpose in array array['Call','AIVoice'] loop if coalesce(p_consents->>purpose,'false')='true' then label:=case purpose when 'Call' then 'Đồng ý để chuyên viên gọi điện tư vấn' else 'Đồng ý trò chuyện với trợ lý AI qua điện thoại' end; insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version,recorded_by) values(phone,c.id,lead_id,purpose,'Granted','Web','AI chat hand-off',a.id::text||': '||label,'contact.v1',actor); end if; end loop;
   end if;
  end if;
  update public.ai_pending_actions set status='Confirmed',decided_at=now(),result=r where id=a.id; return jsonb_build_object('status','confirmed','result',r);
 exception when others then update public.ai_pending_actions set status='Failed',decided_at=now(),result=jsonb_build_object('error',SQLERRM) where id=a.id; raise;
 end;
end $$;
create function public.pose_ai_create_pending(p_session uuid,p_tool text,p_args jsonb,p_summary text,p_key text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_pending_create(p_session,p_tool,p_args,p_summary,p_key); $$;
create function public.pose_ai_decide_pending(p_action uuid,p_confirm boolean,p_consents jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_pending_decide(p_action,p_confirm,p_consents); $$;
revoke all on function pose_private.ai_pending_create(uuid,text,jsonb,text,text),pose_private.ai_pending_decide(uuid,boolean,jsonb),public.pose_ai_create_pending(uuid,text,jsonb,text,text),public.pose_ai_decide_pending(uuid,boolean,jsonb) from public,anon;
grant execute on function public.pose_ai_create_pending(uuid,text,jsonb,text,text),public.pose_ai_decide_pending(uuid,boolean,jsonb) to authenticated;
commit;
