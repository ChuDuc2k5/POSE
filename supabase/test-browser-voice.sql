-- Run after browser-voice.sql. All fixtures and assertions roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,created_at,updated_at)
select ('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','voice-'||n||'@example.test',now(),jsonb_build_object('role',case n when 1 then 'Admin' else 'Sales' end),now(),now() from generate_series(1,2) n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select ('fa200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now() from generate_series(1,2) n;
insert into public.call_scripts(id,name,created_by) values('fa300000-0000-4000-8000-000000000001','Mô phỏng trình duyệt','fa100000-0000-4000-8000-000000000001');
insert into public.call_script_versions(id,script_id,version_no,status,content,checksum,created_by,published_at)
values('fa400000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001',1,'Published','{}',repeat('a',64),'fa100000-0000-4000-8000-000000000001',now());
create temp table voice_checks(n integer default 0);insert into voice_checks default values;grant all on voice_checks to authenticated,service_role;
create temp table voice_id(id uuid);grant all on voice_id to authenticated,service_role;
create function pg_temp.voice_check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;update voice_checks set n=n+1;end $$;
select pg_temp.voice_check(not has_function_privilege('anon','public.pose_voice_start(uuid,uuid)','execute'),'Guest denied');
select pg_temp.voice_check(not has_function_privilege('authenticated','public.pose_system_voice_update(uuid,uuid,text,text,jsonb)','execute'),'service-only turn commit');
select pg_temp.voice_check(not has_function_privilege('authenticated','public.pose_system_voice_finish(uuid,text)','execute'),'service-only finish');
select pg_temp.voice_check(not has_table_privilege('authenticated','pose_private.voice_sessions','select'),'session ownership private');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fa100000-0000-4000-8000-000000000002","session_id":"fa200000-0000-4000-8000-000000000002"}',true);
do $$begin
 begin perform public.pose_voice_start('fa400000-0000-4000-8000-000000000001');raise exception 'FAIL: Sales starts voice';exception when insufficient_privilege then perform pg_temp.voice_check(true,'Sales denied');end;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fa100000-0000-4000-8000-000000000001","session_id":"fa200000-0000-4000-8000-000000000001"}',true);
insert into voice_id select (public.pose_voice_start('fa400000-0000-4000-8000-000000000001')->>'id')::uuid;
select pg_temp.voice_check((select call_type='MOCK_CALL' and provider='simulator' and phone_e164 is null and status='ANSWERED' from calls where id=(select id from voice_id)),'honest active simulation');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare call uuid:=(select id from voice_id);result jsonb;begin
 begin perform public.pose_system_voice_update(call,'fa100000-0000-4000-8000-000000000002','turn','','{}');raise exception 'FAIL: wrong owner';exception when insufficient_privilege then perform pg_temp.voice_check(true,'owner checked');end;
 result:=public.pose_system_voice_update(call,'fa100000-0000-4000-8000-000000000001','turn','yes','{"state":{"phase":"needs","silences":0,"turns":1,"consents":{}},"text":"Unstored speech","interrupted":false}');
 perform pg_temp.voice_check(not exists(select 1 from call_turns where call_id=call),'unconsented speech absent');
 result:=public.pose_system_voice_update(call,'fa100000-0000-4000-8000-000000000001','turn','đồng ý','{"state":{"phase":"needs","silences":0,"turns":2,"consents":{"Transcript":true}},"text":"Consented reply","consent":{"purpose":"Transcript","granted":true},"interrupted":false}');
 perform pg_temp.voice_check((select count(*)=1 from call_turns where call_id=call),'transcript starts at explicit grant');
 perform public.pose_system_voice_update(call,'fa100000-0000-4000-8000-000000000001','barge_in','','{}');
 perform pg_temp.voice_check((select bool_and(interrupted) from call_turns where call_id=call),'barge-in persisted');
 perform public.pose_system_voice_finish(call,'CLOSED');
 perform pg_temp.voice_check((select status='COMPLETED' and transcript_status='Available' and recording_status='NotConsented' from calls where id=call),'finish materializes consented transcript');
 perform public.pose_system_voice_finish(call,'OTHER_REASON');
 perform pg_temp.voice_check((select end_reason='CLOSED' from calls where id=call) and (select count(*)=1 from call_transcripts where call_id=call),'terminal finish idempotent');
end $$;
reset role;
select 'PASS: '||n||' browser voice SQL checks; grants, ownership, consent, interruption and terminal idempotency.' result from voice_checks;
rollback;
