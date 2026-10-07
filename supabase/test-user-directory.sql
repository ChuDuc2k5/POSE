-- Transactional fixtures only: no real accounts, emails, or role changes persist.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
values('fd000000-0000-4000-8000-000000000001','directory-user@example.test',now(),'{"display_name":"Khách hàng kiểm thử","role":"Admin"}','{"provider":"email","role":"User","account_status":"active"}'),
 ('fd000000-0000-4000-8000-000000000002','directory-pending@example.test',null,'{"display_name":"Tài khoản chờ xác minh"}','{"provider":"email"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
values('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',now(),now());
do $$ begin
 if not exists(select 1 from public.users where auth_user_id='fd000000-0000-4000-8000-000000000001' and role='User' and role_label='Khách hàng' and email_verified) then raise exception 'Signup/default role sync failed'; end if;
 if not exists(select 1 from public.user_directory where auth_user_id='fd000000-0000-4000-8000-000000000002' and role='User' and access_state='Chờ xác minh email') then raise exception 'Pending signup sync failed'; end if;
end $$;
update auth.users set raw_user_meta_data=raw_user_meta_data||'{"role":"Admin","account_status":"active"}',last_sign_in_at=now(),email='directory-renamed@example.test'
where id='fd000000-0000-4000-8000-000000000001';
do $$ begin
 if not exists(select 1 from public.users where auth_user_id='fd000000-0000-4000-8000-000000000001' and role='User' and last_sign_in_at is not null and email='directory-renamed@example.test') then raise exception 'Editable metadata escalated permissions or identity sync failed'; end if;
 begin update public.users set email='forged@example.test' where auth_user_id='fd000000-0000-4000-8000-000000000001'; raise exception 'Managed email allowed'; exception when invalid_parameter_value then null; end;
 begin update public.users set role='Owner' where auth_user_id='fd000000-0000-4000-8000-000000000001'; raise exception 'Invalid role allowed'; exception when check_violation then null; end;
end $$;
insert into public.account_profiles(user_id,display_name,contact_phone)
values('fd000000-0000-4000-8000-000000000001','Tên hồ sơ đã cập nhật','+84901234567'),
 ('fd000000-0000-4000-8000-000000000002','Hồ sơ dùng chung số liên hệ','+84901234567');
do $$ begin
 if not exists(select 1 from public.users where auth_user_id='fd000000-0000-4000-8000-000000000001' and full_name='Tên hồ sơ đã cập nhật' and contact_phone='+84901234567') then raise exception 'Profile sync failed'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fd100000-0000-4000-8000-000000000001","app_metadata":{"role":"User"}}',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.users)<>1 or (select count(*) from public.user_directory)<>1 then raise exception 'Customer directory visibility failed'; end if;
 if (select count(*) from public.user_access_history)<>0 then raise exception 'Customer can read access audit'; end if;
 begin update public.users set role='Admin' where auth_user_id=auth.uid(); raise exception 'Customer can escalate permissions'; exception when insufficient_privilege then null; end;
 begin perform pose_private.sync_user_directory(auth.uid()); raise exception 'Customer can call private sync'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.users set role='Sales' where auth_user_id='fd000000-0000-4000-8000-000000000001';
do $$ begin
 if (select raw_app_meta_data->>'role' from auth.users where id='fd000000-0000-4000-8000-000000000001')<>'Sales' then raise exception 'Table Editor role did not reach Auth'; end if;
 if (select raw_app_meta_data->>'provider' from auth.users where id='fd000000-0000-4000-8000-000000000001')<>'email' then raise exception 'Provider metadata overwritten'; end if;
 if public.pose_access_context()->>'role'<>'Sales' then raise exception 'Current role not applied to stale JWT'; end if;
 if (select count(*) from public.user_access_history where auth_user_id='fd000000-0000-4000-8000-000000000001')<>1 then raise exception 'Role audit missing or duplicated'; end if;
end $$;
update public.users set role='Admin' where auth_user_id='fd000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.user_directory where auth_user_id='fd000000-0000-4000-8000-000000000002') then raise exception 'Admin cannot see pending accounts'; end if;
 if (select count(*) from public.user_access_history where auth_user_id='fd000000-0000-4000-8000-000000000001')<>2 then raise exception 'Admin audit visibility failed'; end if;
end $$;
reset role;
update public.users set account_status='suspended' where auth_user_id='fd000000-0000-4000-8000-000000000001';
do $$ begin
 if (public.pose_access_context()->>'active')::boolean then raise exception 'Suspended account remains active'; end if;
 if not exists(select 1 from public.users where auth_user_id='fd000000-0000-4000-8000-000000000001' and status='INACTIVE') then raise exception 'Legacy status not synchronized'; end if;
end $$;
update public.users set account_status='active' where auth_user_id='fd000000-0000-4000-8000-000000000001';
update auth.users set raw_app_meta_data=raw_app_meta_data||'{"role":"User","account_status":"active"}' where id='fd000000-0000-4000-8000-000000000001';
do $$ begin
 if not exists(select 1 from public.users where auth_user_id='fd000000-0000-4000-8000-000000000001' and role='User' and account_status='active') then raise exception 'Auth-to-directory downgrade failed'; end if;
 if public.pose_access_context()->>'role'<>'User' then raise exception 'Downgrade ignored until JWT refresh'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform 1 from public.users; raise exception 'Guest can read directory'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.user_directory; raise exception 'Guest can read directory view'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: Auth signup/backfill, identity/profile sync, metadata forgery defense, Table Editor role/status propagation, audit, immediate downgrade and RLS. Fixtures rolled back.' as result;
