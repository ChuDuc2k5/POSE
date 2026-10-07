-- Integration checks against PostgreSQL. All fixture rows are rolled back.
begin;
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('fa100000-0000-4000-8000-000000000001','authenticated','authenticated','m01-fixture-a@example.test',now(),'{"role":"Sales"}','{"display_name":"Fixture A"}',now(),now()),
       ('fa100000-0000-4000-8000-000000000002','authenticated','authenticated','m01-fixture-b@example.test',now(),'{"role":"User"}','{"display_name":"Fixture B"}',now(),now());
insert into auth.sessions(id, user_id, created_at, updated_at)
values ('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',now(),now()),
       ('fa200000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000002',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000001","session_id":"fa200000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"role":"Admin"}}',true);
do $$
declare profile jsonb;
begin
  if public.pose_access_context()->>'role' <> 'Sales' then raise exception 'Trusted role check failed'; end if;
  profile := public.pose_update_profile('{"name":"Updated A","phone":"+84912345678","notificationsEnabled":false}',0);
  if profile->>'name' <> 'Updated A' or (profile->>'phoneVerified')::boolean or (profile->>'version')::integer <> 1 then raise exception 'Profile update failed'; end if;
  begin perform public.pose_update_profile('{"name":"Stale"}',0); raise exception 'Stale version accepted'; exception when serialization_failure then null; end;
  begin perform public.pose_update_profile('{"role":"Admin"}',1); raise exception 'Role escalation accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_update_profile('{"user_id":"fa100000-0000-4000-8000-000000000002"}',1); raise exception 'Owner overwrite accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_record_phone_verification('+84912345678'); raise exception 'Unverified phone accepted'; exception when invalid_parameter_value then null; end;
  insert into storage.objects(bucket_id, name) values('account-avatars','fa100000-0000-4000-8000-000000000001/fixture.png');
  profile := public.pose_update_profile('{"avatarPath":"fa100000-0000-4000-8000-000000000001/fixture.png"}',1);
  if profile->>'avatarPath' <> 'fa100000-0000-4000-8000-000000000001/fixture.png' then raise exception 'Own avatar not saved'; end if;
  begin insert into storage.objects(bucket_id, name) values('account-avatars','fa100000-0000-4000-8000-000000000002/forged.png'); raise exception 'Other avatar upload allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000002","session_id":"fa200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
begin
  if exists(select 1 from public.account_profiles where user_id='fa100000-0000-4000-8000-000000000001') then raise exception 'Other profile visible'; end if;
  if exists(select 1 from public.account_history where user_id='fa100000-0000-4000-8000-000000000001') then raise exception 'Other history visible'; end if;
  if exists(select 1 from storage.objects where bucket_id='account-avatars' and name='fa100000-0000-4000-8000-000000000001/fixture.png') then raise exception 'Other avatar visible'; end if;
  begin update public.account_profiles set display_name='Forged'; raise exception 'Direct profile writes allowed'; exception when insufficient_privilege then null; end;
  begin select * from pose_private.account_security; raise exception 'Private security table accessible'; exception when insufficient_privilege then null; end;
  if not public.pose_recovery_ticket('begin') or not public.pose_recovery_ticket('claim') then raise exception 'Recovery claim failed'; end if;
  if public.pose_recovery_ticket('claim') then raise exception 'Recovery ticket reused'; end if;
  if not public.pose_recovery_ticket('finish') then raise exception 'Recovery finalization failed'; end if;
  if (public.pose_access_context()->>'session_valid')::boolean then raise exception 'Older session not revoked'; end if;
  begin perform public.pose_read_profile(); raise exception 'Revoked session still reads profile'; exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: profile validation, version conflict, RLS ownership, private state, one-time recovery and session revocation; fixture rows rolled back.' as result;
