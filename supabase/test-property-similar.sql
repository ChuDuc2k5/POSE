begin;
do $$ begin
  if to_regclass('public.property_similar') is null then raise exception 'property_similar table missing'; end if;
  if not exists(select 1 from pg_proc where proname='pose_similar_properties') then raise exception 'similar RPC missing'; end if;
  if not exists(select 1 from pg_class where relname='property_similar' and relrowsecurity) then raise exception 'similar RLS missing'; end if;
end $$;
select 'property_similar checks complete' as result;
rollback;
