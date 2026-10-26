-- Hotfix 10d: let the existing catalogue overview aggregate within a hard budget.
-- The TypeScript formatter owns ward/former-district grouping; this RPC only
-- filters the published catalogue and returns the aggregate rows.
drop function if exists public.pose_system_ai_catalogue_overview(text);
create function public.pose_system_ai_catalogue_overview(
  p_transaction_type text default null,
  p_max_price numeric default null,
  p_property_type text default null
)
returns jsonb language sql stable security definer set search_path='' as $$
with catalogue as (
  select p.*
  from public.property_public_catalog p
  where (p_transaction_type is null or p.transaction_type=p_transaction_type)
    and (p_max_price is null or p.price is not null and p.price <= p_max_price)
    and (p_property_type is null or p.property_type=p_property_type)
), areas as (
  select location as label,count(*)::bigint as count,min(price) as min_price,max(price) as max_price
  from catalogue group by location order by count desc,label
), types as (
  select transaction_type,property_type,count(*)::bigint as count
  from catalogue group by transaction_type,property_type order by transaction_type,count desc,property_type
), projects as (
  select project_name as label,count(*)::bigint as count
  from catalogue where nullif(btrim(project_name),'') is not null group by project_name order by count desc,label
), prices as (
  select transaction_type,property_type,min(price) as min_price,max(price) as max_price
  from catalogue where price is not null group by transaction_type,property_type order by transaction_type,property_type
)
select jsonb_build_object(
  'areas',coalesce((select jsonb_agg(jsonb_build_object('label',label,'count',count,'min_price',min_price,'max_price',max_price)) from areas),'[]'::jsonb),
  'types',coalesce((select jsonb_agg(jsonb_build_object('transaction_type',transaction_type,'property_type',property_type,'count',count)) from types),'[]'::jsonb),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('label',label,'count',count)) from projects),'[]'::jsonb),
  'prices',coalesce((select jsonb_agg(jsonb_build_object('transaction_type',transaction_type,'property_type',property_type,'min_price',min_price,'max_price',max_price)) from prices),'[]'::jsonb)
);
$$;
revoke all on function public.pose_system_ai_catalogue_overview(text,numeric,text) from public,anon,authenticated;
grant execute on function public.pose_system_ai_catalogue_overview(text,numeric,text) to service_role;
