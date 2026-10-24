-- Apply once after supabase/ai-agent.sql on projects where M06 is already live.
begin;
alter table public.ai_chat_sessions add column if not exists suggested_property_ids uuid[] not null default '{}' check(cardinality(suggested_property_ids)<=20);
create or replace function pose_private.ai_interest_ids(p_lead uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array(select distinct unnest(coalesce(s.suggested_property_ids,s.property_ids)) from public.ai_chat_sessions s where s.lead_id=p_lead limit 100),'{}'::uuid[]);
$$;
create or replace function pose_private.ai_commit_chat(p_session uuid,p_user uuid,p_hash text,p_store boolean,p_message text,p_reply text,p_sources jsonb,p_actions jsonb,p_fields jsonb,p_score jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.ai_chat_sessions; a jsonb; before_needs jsonb; merged_needs jsonb; lead_version integer; needs_changed boolean:=false;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if;
 if p_message is null or char_length(p_message) not between 1 and 2000 or p_reply is null or char_length(p_reply) not between 1 and 8000 or p_store is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 select * into s from public.ai_chat_sessions where id=p_session for update;
 if found then if s.user_id is distinct from p_user or s.guest_token_hash is distinct from p_hash or s.status='Closed' or s.store_transcript<>p_store then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
 else insert into public.ai_chat_sessions(id,user_id,guest_token_hash,store_transcript,lead_id) values(p_session,p_user,p_hash,p_store,(select l.id from public.leads l join public.customers c on c.id=l.customer_id where c.auth_user_id=p_user and not l.archived and l.status not in ('CONVERTED','LOST'))) returning * into s; end if;
 if s.lead_id is not null then select needs,version into before_needs,lead_version from public.leads where id=s.lead_id for update; end if;
 if s.user_id is null then p_message:=pose_private.ai_strip_phones(p_message); end if;
 if s.store_transcript then insert into public.ai_chat_messages(session_id,role,content,sources,blocked) values(s.id,'user',p_message,'[]',false),(s.id,'assistant',p_reply,p_sources,exists(select 1 from jsonb_array_elements(p_actions) x where x->>'decision'='blocked')); end if;
 for a in select * from jsonb_array_elements(p_actions) loop insert into public.ai_action_log(session_id,tool,args_hash,decision,reason,rule_version) values(s.id,a->>'tool',a->>'args_hash',a->>'decision',a->>'reason',a->>'rule_version'); end loop;
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
commit;
