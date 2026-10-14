-- Apply after automated-calling.sql. Browser simulations have no dialled phone.
begin;
create table pose_private.voice_sessions (
 call_id uuid primary key references public.calls(id), actor_id uuid not null references auth.users(id),
 property_id uuid references public.property_products(id), interrupted boolean not null default false
);
revoke all on pose_private.voice_sessions from public,anon,authenticated;
alter table pose_private.voice_sessions enable row level security;
create function pose_private.voice_start(p_script uuid,p_property uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.campaign_admin(); a public.calls;
begin
 perform pg_advisory_xact_lock(808,1);
 if not exists(select 1 from public.call_script_versions where id=p_script and status='Published') then raise exception 'INVALID_SCRIPT' using errcode='22023';end if;
 if p_property is not null and not exists(select 1 from public.property_public_catalog where id=p_property) then raise exception 'PRODUCT_NOT_PUBLISHED' using errcode='22023';end if;
 if (select count(*) from public.calls where status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN'))>=2 then raise exception 'CAPACITY' using errcode='22023';end if;
 insert into public.calls(script_version_id,provider,call_type,status,started_at,answered_at)
 values(p_script,'simulator','MOCK_CALL','ANSWERED',now(),now()) returning * into a;
 insert into pose_private.voice_sessions(call_id,actor_id,property_id) values(a.id,actor,p_property);
 insert into public.call_events(provider,provider_event_id,call_id,type,payload,occurred_at)
 values('simulator','voice-start:'||a.id,a.id,'answered',jsonb_build_object('label','Mô phỏng — không có cuộc gọi thật'),now());
 return to_jsonb(a);
end $$;
create function public.pose_voice_start(p_script uuid,p_property uuid default null) returns jsonb language sql security invoker set search_path='' as $$select pose_private.voice_start(p_script,p_property)$$;
revoke all on function pose_private.voice_start(uuid,uuid),public.pose_voice_start(uuid,uuid) from public,anon;
grant execute on function pose_private.voice_start(uuid,uuid),public.pose_voice_start(uuid,uuid) to authenticated;
create function pose_private.voice_update(p_call uuid,p_actor uuid,p_event text,p_input text,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.calls; turn_seq integer; result jsonb:=p_result;
begin
 perform pose_private.call_system();
 if not exists(select 1 from pose_private.voice_sessions where call_id=p_call and actor_id=p_actor) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into a from public.calls where id=p_call for update;
 if a.status<>'ANSWERED' then return to_jsonb(a);end if;
 if p_event='barge_in' then
  update pose_private.voice_sessions set interrupted=true where call_id=p_call;
  update public.call_turns set interrupted=true where call_id=p_call and speaker='AI' and seq=(select max(t.seq) from public.call_turns t where t.call_id=p_call and speaker='AI');
  return jsonb_build_object('interrupted',true);
 end if;
 if p_event='end' then
  result:=jsonb_build_object('state',a.conversation||jsonb_build_object('phase','ended','end_reason',coalesce(p_result->>'end_reason','CLOSED')),'text','','interrupted',false);
 end if;
 if (select interrupted from pose_private.voice_sessions where call_id=p_call) then result:=jsonb_set(result,'{interrupted}','true');end if;
 update pose_private.voice_sessions set interrupted=false where call_id=p_call;
 if result->'consent' is not null and result->'consent'<>'null'::jsonb or result->>'withdraw' is not null then
  insert into public.call_events(provider,provider_event_id,call_id,type,payload,occurred_at)
  values('simulator','voice-consent:'||p_call||':'||a.conversation_version,p_call,'consent',jsonb_build_object('answer',p_input,'consent',result->'consent','withdraw',result->'withdraw'),now());
 end if;
 if result->'state'->'consents'->>'Transcript'='true' then
  select coalesce(max(t.seq),0) into turn_seq from public.call_turns t where call_id=p_call;
  if a.conversation->'consents'->>'Transcript'='true' and length(p_input)>0 then insert into public.call_turns values(p_call,turn_seq+1,'Customer',p_input,false,now());turn_seq:=turn_seq+1;end if;
  if length(result->>'text')>0 then insert into public.call_turns values(p_call,turn_seq+1,'AI',result->>'text',false,now());end if;
 end if;
 update public.calls set conversation=result->'state',conversation_version=conversation_version+1,
 status=case when result->'state'->>'phase'='ended' then 'COMPLETED'::public.call_status else status end,
 end_reason=result->'state'->>'end_reason',ended_at=case when result->'state'->>'phase'='ended' then now() end,updated_at=now(),
 transcript_status=case when result->'state'->'consents'->>'Transcript'='true' then 'Processing' else 'NotConsented' end
 where id=p_call;
 if result->'state'->>'phase'='ended' then
  insert into public.call_events(provider,provider_event_id,call_id,type,payload,occurred_at)
  values('simulator','voice-end:'||p_call,p_call,'completed',jsonb_build_object('end_reason',result->'state'->>'end_reason'),now()) on conflict do nothing;
  update public.calls set duration_seconds=greatest(0,extract(epoch from ended_at-started_at)::integer) where id=p_call;
  if result->'state'->'consents'->>'Transcript'='true' then
   insert into public.call_transcripts(call_id,transcript,language) select p_call,string_agg(speaker||': '||text,E'\n' order by seq),'vi' from public.call_turns where call_id=p_call having count(*)>0;
   update public.calls set transcript_status=case when exists(select 1 from public.call_transcripts where call_id=p_call) then 'Available' else 'Failed' end where id=p_call;
  end if;
 end if;
 return result;
end $$;
create function public.pose_system_voice_update(p_call uuid,p_actor uuid,p_event text,p_input text,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$select pose_private.voice_update(p_call,p_actor,p_event,p_input,p_result)$$;
revoke all on function pose_private.voice_update(uuid,uuid,text,text,jsonb),public.pose_system_voice_update(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function pose_private.voice_update(uuid,uuid,text,text,jsonb),public.pose_system_voice_update(uuid,uuid,text,text,jsonb) to service_role;
create function pose_private.voice_finish(p_call uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 perform pose_private.call_system();
 select actor_id into actor from pose_private.voice_sessions where call_id=p_call;
 if actor is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 -- Staff stop requests use ENDING; browser sessions can confirm locally.
 update public.calls set status='ANSWERED' where id=p_call and status='ENDING';
 perform pose_private.voice_update(p_call,actor,'end','',jsonb_build_object('end_reason',p_reason));
 return (select to_jsonb(c) from public.calls c where id=p_call);
end $$;
create function public.pose_system_voice_finish(p_call uuid,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.voice_finish(p_call,p_reason)$$;
revoke all on function pose_private.voice_finish(uuid,text),public.pose_system_voice_finish(uuid,text) from public,anon,authenticated;
grant execute on function pose_private.voice_finish(uuid,text),public.pose_system_voice_finish(uuid,text) to service_role;
commit;
