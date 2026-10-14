-- Real PostgreSQL tests; auth fixtures and effects are rolled back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,created_at,updated_at)
select ('f6100000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','m06-'||n||'@example.test',now(),jsonb_build_object('role',case n when 3 then 'Sales' when 4 then 'Admin' else 'User' end),now(),now() from generate_series(1,6) n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select ('f6200000-0000-4000-8000-00000000000'||n)::uuid,('f6100000-0000-4000-8000-00000000000'||n)::uuid,now(),now() from generate_series(1,6) n;
update auth.users set phone='84901234561',phone_confirmed_at=now() where id='f6100000-0000-4000-8000-000000000001';
update auth.users set phone='84901234566',phone_confirmed_at=now() where id='f6100000-0000-4000-8000-000000000006';
insert into public.account_profiles(user_id,display_name,contact_phone) values
('f6100000-0000-4000-8000-000000000001','Khách M06 đã xác minh','+84901234561'),
('f6100000-0000-4000-8000-000000000006','Khách M06 trùng số cũ','+84901234566');
insert into public.customers(id,full_name,phone,auth_user_id,source) values
('f6400000-0000-4000-8000-000000000002','Khách hàng từ yêu cầu trước','+84901234562','f6100000-0000-4000-8000-000000000002','Web'),
('f6400000-0000-4000-8000-000000000006','Khách cũ chưa liên kết','+84901234566',null,'Manual');
insert into public.leads(id,customer_id,status,preferred_location) values('f6700000-0000-4000-8000-000000000002','f6400000-0000-4000-8000-000000000002','FOLLOW_UP','Đà Nẵng');
insert into public.users(id,full_name,email,auth_user_id,role,account_status,email_verified)
select ('f6500000-0000-4000-8000-00000000000'||n)::uuid,'Nhân viên M06','m06-'||n||'@example.test',('f6100000-0000-4000-8000-00000000000'||n)::uuid,case n when 3 then 'Sales' else 'Admin' end,'active',true from generate_series(3,4) n
where not exists(select 1 from public.users u where u.auth_user_id=('f6100000-0000-4000-8000-00000000000'||n)::uuid);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000001',null,repeat('a',64),true,'Gọi 0901234567','Tôi là trợ lý AI của TERAVA.','[]','[]','{}',null);
select public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000001',null,true,'Tôi mua căn hộ Hồ Chí Minh ngân sách 2 tỷ đến 3 tỷ tháng tới. Tôi sẵn sàng tư vấn.','Tôi là trợ lý AI của TERAVA.','[]','[]','{}',null);
select public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000003',null,repeat('b',64),false,'Không lưu hội thoại','Tôi là trợ lý AI của TERAVA.','[]','[]','{}',null);
select public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000004','f6100000-0000-4000-8000-000000000005',null,false,'Xin tư vấn','Tôi là trợ lý AI của TERAVA.','[]','[]','{}',null);
select public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000005','f6100000-0000-4000-8000-000000000006',null,false,'Xin tư vấn','Tôi là trợ lý AI của TERAVA.','[]','[]','{}',null);
select public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000006','f6100000-0000-4000-8000-000000000002',null,false,'Xin tư vấn cho nhu cầu trước','Tôi là trợ lý AI của TERAVA.','[]','[]','{}',null);
do $$ begin
 if public.pose_system_ai_read_guest('f6300000-0000-4000-8000-000000000001',repeat('a',64))->>'id' is null then raise exception 'OWN_GUEST_READ'; end if;
 begin perform public.pose_system_ai_read_guest('f6300000-0000-4000-8000-000000000001',repeat('b',64));raise exception 'OTHER_GUEST_READ';exception when no_data_found then null;end;
 begin perform public.pose_system_ai_read_guest('f6300000-0000-4000-8000-000000000002',repeat('a',64));raise exception 'GUEST_READ_USER';exception when no_data_found then null;end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.ai_chat_messages where content like '%0901234567%') then raise exception 'GUEST_PHONE_STORED'; end if;
 if exists(select 1 from public.ai_chat_messages where session_id='f6300000-0000-4000-8000-000000000003') then raise exception 'NO_CONSENT_TRANSCRIPT'; end if;
 if exists(select 1 from public.leads l join public.customers c on c.id=l.customer_id where c.auth_user_id='f6100000-0000-4000-8000-000000000001') then raise exception 'AUTOMATIC_LEAD'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000001","session_id":"f6200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare a jsonb;b jsonb;begin
 if (select count(*) from public.ai_chat_sessions where id::text like 'f6300000-%')<>1 then raise exception 'USER_RLS';end if;
 begin perform public.pose_system_ai_commit_chat(gen_random_uuid(),null,repeat('a',64),false,'x','x','[]','[]','{}',null);raise exception 'USER_SYSTEM_WRITE';exception when insufficient_privilege then null;end;
 begin perform public.pose_system_record_ai_extraction(gen_random_uuid(),'Chat',gen_random_uuid(),'needs.v1','{}','role-check');raise exception 'USER_EXTRACTION';exception when insufficient_privilege then null;end;
 begin perform public.pose_system_apply_lead_score(gen_random_uuid(),'{}','role-check');raise exception 'USER_SCORE';exception when insufficient_privilege then null;end;
 begin perform public.pose_ai_read_session('f6300000-0000-4000-8000-000000000001');raise exception 'USER_READ_GUEST';exception when no_data_found then null;end;
 a:=public.pose_ai_request_handoff('f6300000-0000-4000-8000-000000000002','Xin chuyên viên tư vấn',now()+interval '3 days',now()+interval '3 days 1 hour','handoff-key-01');
 b:=public.pose_ai_request_handoff('f6300000-0000-4000-8000-000000000002','Xin chuyên viên tư vấn',now()+interval '3 days',now()+interval '3 days 1 hour','handoff-key-01');
 if a is distinct from b or a->>'status'<>'Pending' then raise exception 'HANDOFF_REPLAY';end if;
 begin perform public.pose_ai_request_handoff('f6300000-0000-4000-8000-000000000002','Nội dung khác',null,null,'handoff-key-01');raise exception 'KEY_REUSE';exception when serialization_failure then null;end;
end $$;
reset role;
do $$ declare lead uuid;begin
 select lead_id into lead from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002';
 if (select count(*) from public.lead_tasks where lead_id=lead and kind='Handoff')<>1 or (select count(*) from public.appointments where lead_id=lead)<>1 then raise exception 'HANDOFF_DUPLICATED';end if;
 if not exists(select 1 from public.leads l join public.customers c on c.id=l.customer_id where l.id=lead and l.status='NEW' and l.source='WebChat' and c.auth_user_id='f6100000-0000-4000-8000-000000000001' and c.phone='+84901234561' and c.phone_verified_at is not null) then raise exception 'HANDOFF_CUSTOMER_MAPPING';end if;
 if not exists(select 1 from public.appointments where lead_id=lead and status='SCHEDULED' and source='AI' and customer_id=(select customer_id from public.leads where id=lead)) then raise exception 'HANDOFF_LEGACY_PENDING';end if;
 update public.leads set budget_min=1000000000,preferred_location='Hà Nội',needs='{"locations":{"value":["Hà Nội"],"confidence":1,"evidence":"Hà Nội","confirmed_by":"human"}}' where id=lead;
 insert into public.lead_assignments(lead_id,sales_id) select lead,u.id from public.users u where u.auth_user_id='f6100000-0000-4000-8000-000000000003';
 insert into public.calls(id,lead_id,customer_id,call_type,status) select 'f6600000-0000-4000-8000-000000000001',id,customer_id,'AI_AUTO_CALL','COMPLETED' from public.leads where id=lead;
 insert into public.call_transcripts(call_id,transcript) values('f6600000-0000-4000-8000-000000000001','Ngân sách 4 tỷ, hoặc 3 tỷ. Tôi sẵn sàng tư vấn.');
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
 do $$ declare lead uuid;fields jsonb;result jsonb;before_count integer;begin
 -- Session contents are accessible only through scoped read APIs outside the service role.
 select lead_id into lead from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002';
 fields:='{"locations":{"value":["Hồ Chí Minh"],"confidence":0.9,"evidence":"Hồ Chí Minh"},"budget_min_vnd":{"value":2000000000,"confidence":0.9,"evidence":"2 tỷ"},"budget_max_vnd":{"value":3000000000,"confidence":0.9,"evidence":"3 tỷ"},"timeline":{"value":"lt3m","confidence":0.9,"evidence":"tháng tới"}}';
 result:=public.pose_system_record_ai_extraction(lead,'Chat','f6300000-0000-4000-8000-000000000002','needs.v1',fields,'extract-key-01');
 if result->'locations'->>'confirmed_by'<>'human' or result->'locations'->'value'<>'["Hà Nội"]'::jsonb or result->>'review_required'<>'true' then raise exception 'HUMAN_OVERWRITE';end if;
 perform public.pose_system_record_ai_extraction(lead,'Chat','f6300000-0000-4000-8000-000000000002','needs.v1',fields,'extract-key-01');
 if (select count(*) from public.lead_events where lead_id=lead and action='needs_extracted')<>1 then raise exception 'EXTRACTION_REPLAY';end if;
 if (select count(*) from public.lead_tasks where lead_id=lead and kind='Review')<>1 then raise exception 'CONFLICT_TASK_DUPLICATE';end if;
 if (select count(*) from public.ai_extracted_preferences where lead_id=lead)<>4 or not exists(select 1 from public.ai_extracted_preferences where lead_id=lead and field_name='locations' and status='Conflict' and source_kind='Chat' and source_session_id='f6300000-0000-4000-8000-000000000002' and evidence='Hồ Chí Minh' and schema_version='needs.v1') then raise exception 'EXTRACTION_PROVENANCE';end if;
 if not exists(select 1 from public.leads where id=lead and budget_min=1000000000 and budget_max=3000000000 and preferred_location='Hà Nội' and expected_timeline='lt3m') then raise exception 'TYPED_COLUMN_PRESERVATION';end if;
 perform public.pose_system_record_ai_extraction(lead,'Call','f6600000-0000-4000-8000-000000000001','needs.v1','{"budget_max_vnd":{"value":4000000000,"confidence":0.9,"evidence":"4 tỷ"}}','call-extract-01');
 perform public.pose_system_record_ai_extraction(lead,'Call','f6600000-0000-4000-8000-000000000001','needs.v1','{"budget_max_vnd":{"value":4000000000,"confidence":0.9,"evidence":"4 tỷ"}}','call-extract-01');
 if (select budget_max from public.leads where id=lead)<>4000000000 or not exists(select 1 from public.ai_extracted_preferences where lead_id=lead and source_call_id='f6600000-0000-4000-8000-000000000001' and evidence='4 tỷ') or (select count(*) from public.ai_extracted_preferences where idempotency_key='call-extract-01:budget_max_vnd')<>1 then raise exception 'CALL_TYPED_EXTRACTION_REPLAY';end if;
 if not exists(select 1 from public.ai_extracted_preferences where idempotency_key='extract-key-01:budget_max_vnd' and status='Superseded') then raise exception 'SUPERSEDED_PROVENANCE';end if;
 begin perform public.pose_system_record_ai_extraction(lead,'Chat','f6300000-0000-4000-8000-000000000002','needs.v1','{"phone":{"value":"+84901234567","confidence":1,"evidence":"phone"}}','invalid-phone');raise exception 'PHONE_EXTRACTION';exception when invalid_parameter_value then null;end;
 begin perform public.pose_system_record_ai_extraction(lead,'Chat','f6300000-0000-4000-8000-000000000002','needs.v1','{"timeline":{"value":null,"confidence":1,"evidence":"phone"}}','invalid-null');raise exception 'NULL_EXTRACTION';exception when invalid_parameter_value then null;end;
 result:='{"score":85,"classification":"Hot","rule_version":"BR-04.v1","intent":true,"unknown":[],"breakdown":{"budget":{"points":30,"value":"match","evidence":"3 tỷ"},"area_type":{"points":25,"value":"both","evidence":"Hồ Chí Minh căn hộ"},"timeline":{"points":20,"value":"lt3m","evidence":"tháng tới"},"contact":{"points":0,"value":"none","evidence":"chưa có số xác minh"},"next_step":{"points":10,"value":"appointment","evidence":"đề nghị hẹn"}}}';
 perform public.pose_system_apply_lead_score(lead,result,'score-key-01');
 perform public.pose_system_apply_lead_score(lead,result,'score-key-01');
 if (select count(*) from public.lead_events where lead_id=lead and action='score_applied')<>1 then raise exception 'SCORE_REPLAY';end if;
 perform public.pose_system_apply_lead_score(lead,result,'score-key-02');
 if (select count(*) from public.lead_tasks where lead_id=lead and priority='High' and kind='Review')<>1 then raise exception 'HOT_TASK_DUPLICATE';end if;
 begin perform public.pose_system_apply_lead_score(lead,result||'{"score":100}','score-invalid-01');raise exception 'SCORE_TOTAL_TRUSTED';exception when invalid_parameter_value then null;end;
 begin perform public.pose_system_apply_lead_score(lead,result||'{"classification":"Cold"}','score-invalid-02');raise exception 'SCORE_THRESHOLD_TRUSTED';exception when invalid_parameter_value then null;end;
 begin perform public.pose_system_apply_lead_score(lead,jsonb_set(result,'{breakdown,budget,points}','29'),'score-invalid-03');raise exception 'DIMENSION_TRUSTED';exception when invalid_parameter_value then null;end;
 begin perform public.pose_system_apply_lead_score('f6700000-0000-4000-8000-000000000002',jsonb_set(result,'{breakdown,contact}','{"value":"ready","points":15,"evidence":"ready"}')||'{"score":100}','score-invalid-04');raise exception 'PHONE_SCORE_TRUSTED';exception when invalid_parameter_value then null;end;
 if (select status from public.leads where id=lead)<>'NEW' then raise exception 'SCORE_CHANGED_STAGE';end if;
 if not exists(select 1 from public.leads where id=lead and lead_score=85 and temperature='HOT') then raise exception 'LEGACY_SCORE_COLUMNS';end if;
 perform public.pose_system_apply_lead_score(lead,result||'{"source_kind":"Call","source_id":"f6600000-0000-4000-8000-000000000001"}','call-score-01');
 perform public.pose_system_apply_lead_score(lead,result||'{"source_kind":"Call","source_id":"f6600000-0000-4000-8000-000000000001"}','call-score-01');
 if (select count(*) from public.ai_analyses where idempotency_key='call-score-01')<>1 or not exists(select 1 from public.ai_analyses where lead_id=lead and lead_score=85 and temperature='HOT' and raw_analysis->>'rule_version'='BR-04.v1') then raise exception 'CALL_ANALYSIS_REPLAY';end if;
 select message_count into before_count from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002';
 begin perform public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000001',null,true,'Không ghi khi xung đột','Không ghi khi xung đột','[]','[]','{}',result||'{"needs_version":-1}');raise exception 'STALE_CHAT_SCORE';exception when serialization_failure then null;end;
 if (select message_count from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002')<>before_count or exists(select 1 from public.ai_chat_messages where content='Không ghi khi xung đột') then raise exception 'PARTIAL_CHAT_WRITE';end if;
 perform public.pose_system_ai_commit_chat('f6300000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000001',null,true,'Tôi cần tư vấn','Tôi là trợ lý AI của TERAVA.','[]','[]','{}',result||jsonb_build_object('needs_version',(select version from public.leads where id=lead)));
 if (select message_count from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002')<>before_count+2 then raise exception 'CHAT_SCORE_ATOMIC_COMMIT';end if;
 perform public.pose_system_apply_lead_score('f6700000-0000-4000-8000-000000000002','{"score":20,"classification":"Unrated","rule_version":"BR-04.v1","intent":true,"unknown":["budget","area_type","next_step"],"breakdown":{"budget":{"points":0,"value":null,"evidence":null},"area_type":{"points":0,"value":null,"evidence":null},"timeline":{"points":20,"value":"lt3m","evidence":"tháng tới"},"contact":{"points":0,"value":"none","evidence":"không có số xác minh"},"next_step":{"points":0,"value":null,"evidence":null}}}','unrated-score-01');
 if not exists(select 1 from public.leads where id='f6700000-0000-4000-8000-000000000002' and temperature is null and lead_score=20 and status='FOLLOW_UP') then raise exception 'UNRATED_NULL_TEMPERATURE';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
update public.leads set budget_max=4000000000 where id=(select lead_id from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare lead uuid;begin
 select lead_id into lead from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002';
 perform public.pose_system_record_ai_extraction(lead,'Call','f6600000-0000-4000-8000-000000000001','needs.v1','{"budget_max_vnd":{"value":3000000000,"confidence":0.9,"evidence":"3 tỷ"}}','human-typed-01');
 if (select budget_max from public.leads where id=lead)<>4000000000 then raise exception 'HUMAN_TYPED_CONFIRMATION_OVERWRITTEN';end if;
 begin perform public.pose_system_record_ai_extraction('f6700000-0000-4000-8000-000000000002','Call','f6600000-0000-4000-8000-000000000001','needs.v1','{}','other-call-01');raise exception 'OTHER_CALL_SOURCE';exception when invalid_parameter_value then null;end;
 begin perform public.pose_system_record_ai_extraction('f6700000-0000-4000-8000-000000000002','Chat','f6300000-0000-4000-8000-000000000006','needs.v1','{"timeline":{"value":"lt3m","confidence":0.9,"evidence":"tư vấn"}}','no-storage-01');raise exception 'NONCONSENTED_EXTRACTION';exception when invalid_parameter_value then null;end;
end $$;
reset role;
insert into public.ai_action_log(session_id,tool,args_hash,decision,reason,rule_version) values('f6300000-0000-4000-8000-000000000002','read_leads',repeat('a',64),'blocked','TOOL_NOT_ALLOWED','guard.v1');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000002","session_id":"f6200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000002') then raise exception 'OTHER_USER_SESSION';end if;
 if exists(select 1 from public.ai_action_log) then raise exception 'USER_LOG';end if;
 begin perform public.pose_ai_request_handoff('f6300000-0000-4000-8000-000000000002','Xin tư vấn',null,null,'other-user-key');raise exception 'OTHER_HANDOFF';exception when no_data_found then null;end;
 perform public.pose_ai_request_handoff('f6300000-0000-4000-8000-000000000006','Bổ sung nhu cầu cho yêu cầu trước',null,null,'m03-reuse-key');
end $$;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000005","session_id":"f6200000-0000-4000-8000-000000000005","role":"authenticated"}',true);
do $$ begin
 begin perform public.pose_ai_request_handoff('f6300000-0000-4000-8000-000000000004','Xin tư vấn',null,null,'unverified-key');raise exception 'UNVERIFIED_CREATED_CUSTOMER';exception when invalid_parameter_value then if SQLERRM<>'PHONE_VERIFICATION_REQUIRED' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000006","session_id":"f6200000-0000-4000-8000-000000000006","role":"authenticated"}',true);
do $$ begin
 begin perform public.pose_ai_request_handoff('f6300000-0000-4000-8000-000000000005','Xin tư vấn',null,null,'collision-key');raise exception 'PHONE_COLLISION_MERGED';exception when invalid_parameter_value then if SQLERRM<>'IDENTITY_REVIEW_REQUIRED' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.customers where auth_user_id in ('f6100000-0000-4000-8000-000000000005','f6100000-0000-4000-8000-000000000006')) then raise exception 'FAILED_HANDOFF_PARTIAL_CUSTOMER';end if;
 if (select count(*) from public.leads where customer_id='f6400000-0000-4000-8000-000000000002')<>1 or not exists(select 1 from public.ai_chat_sessions where id='f6300000-0000-4000-8000-000000000006' and lead_id='f6700000-0000-4000-8000-000000000002') then raise exception 'M03_LEAD_NOT_REUSED';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000003","session_id":"f6200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ declare l public.leads;begin
 if exists(select 1 from public.ai_action_log) then raise exception 'SALES_LOG';end if;
 select x.* into l from public.leads x join public.customers c on c.id=x.customer_id where c.auth_user_id='f6100000-0000-4000-8000-000000000001';
 if l.id is null or not pose_private.lead_assigned_to_me(l.id) or pose_private.current_directory_id() is distinct from (select sales_id from public.lead_assignments where lead_id=l.id and is_active) then raise exception 'DIRECTORY_ASSIGNMENT_MAPPING';end if;
 if exists(select 1 from public.leads where id='f6700000-0000-4000-8000-000000000002') then raise exception 'SALES_OTHER_LEAD_RLS';end if;
 if not exists(select 1 from public.ai_extracted_preferences where lead_id=l.id) or not exists(select 1 from public.ai_analyses where lead_id=l.id) then raise exception 'SALES_PROVENANCE_RLS';end if;
 begin perform public.pose_override_lead_score('f6700000-0000-4000-8000-000000000002',0,'Hot','Không được phân công');raise exception 'UNOWNED_OVERRIDE';exception when insufficient_privilege then null;end;
 begin perform public.pose_override_lead_score(l.id,l.version,'Warm','x');raise exception 'OVERRIDE_REASON';exception when invalid_parameter_value then null;end;
 perform public.pose_override_lead_score(l.id,l.version,'Warm','Khách xác nhận thay đổi');
 if not exists(select 1 from public.leads where id=l.id and temperature='WARM') then raise exception 'OVERRIDE_LEGACY_TEMPERATURE';end if;
 begin perform public.pose_override_lead_score(l.id,l.version,'Cold','Kiểm tra lại');raise exception 'OVERRIDE_VERSION';exception when serialization_failure then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000004","session_id":"f6200000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$ begin if not exists(select 1 from public.ai_action_log where tool='read_leads') then raise exception 'ADMIN_LOG';end if;end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform public.pose_ai_request_handoff(gen_random_uuid(),'Xin tư vấn',null,null,'guest-key-01');raise exception 'GUEST_HANDOFF';exception when insufficient_privilege then null;end;
 begin perform public.pose_system_ai_read_guest(gen_random_uuid(),repeat('a',64));raise exception 'GUEST_DIRECT_SESSION';exception when insufficient_privilege then null;end;
 begin perform * from public.ai_action_log;raise exception 'GUEST_LOG';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: M06 SQL legacy identity, M03 lead reuse, verified-phone handoff, collision denial, directory assignments, SCHEDULED proposals, field/call provenance, typed/human preservation, idempotency, score re-validation, null Unrated, overrides and RLS. Fixtures rolled back.' as result;
