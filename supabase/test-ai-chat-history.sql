begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,created_at,updated_at)
values
 ('f7100000-0000-4000-8000-000000000001','authenticated','authenticated','history-one@example.test',now(),'{"role":"User"}',now(),now()),
 ('f7100000-0000-4000-8000-000000000002','authenticated','authenticated','history-two@example.test',now(),'{"role":"User"}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values ('f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001',now(),now()),
       ('f7200000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000002',now(),now());
set local role service_role;
insert into public.ai_chat_sessions(id,user_id,store_transcript,status,message_count,last_message_at)
values
 ('f7300000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001',true,'Active',2,now()),
 ('f7300000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000002',true,'Active',2,now()),
 ('f7300000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000001',false,'Active',2,now()),
 ('f7300000-0000-4000-8000-000000000004','f7100000-0000-4000-8000-000000000001',true,'Closed',2,now());
insert into public.ai_chat_messages(session_id,role,content)
values ('f7300000-0000-4000-8000-000000000001','user','Goi 0901234567 va history-one@example.test'),
       ('f7300000-0000-4000-8000-000000000002','user','Other user must stay private'),
       ('f7300000-0000-4000-8000-000000000003','user','Do not list this transcript'),
       ('f7300000-0000-4000-8000-000000000004','user','Do not list closed');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","session_id":"f7200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare rows record; n integer; begin
 select count(*) into n from public.pose_ai_list_sessions(1);
 if n<>1 then raise exception 'HISTORY_OWNER_SCOPE'; end if;
 select * into rows from public.pose_ai_list_sessions(1);
 if rows.id<>'f7300000-0000-4000-8000-000000000001' or rows.title like '%0901234567%' or rows.title like '%@%' or rows.title ~ '[0-9]{7,}' then raise exception 'HISTORY_MASKING'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform * from public.pose_ai_list_sessions(1); raise exception 'GUEST_HISTORY_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: M06 AI chat history SQL owner scope, consent filtering, closed filtering, and masked titles.' as result;
