-- Hotfix 10c: aggregate catalogue overviews for chat without sending listings to the model.
begin;
create or replace function public.pose_system_ai_catalogue_overview(p_transaction_type text default null)
returns jsonb language sql stable security definer set search_path='' as $$
with catalogue as (
  select p.*,
    case
      when p.location ~* '(^|[^[:alnum:]])(quận 2|quận 9|thủ đức)([^[:alnum:]]|$)' then 'Thủ Đức'
      when p.location ~* '(^|[^[:alnum:]])quận 1([^[:alnum:]]|$)' then 'Quận 1'
      when p.location ~* '(^|[^[:alnum:]])quận 3([^[:alnum:]]|$)' then 'Quận 3'
      when p.location ~* '(^|[^[:alnum:]])quận 4([^[:alnum:]]|$)' then 'Quận 4'
      when p.location ~* '(^|[^[:alnum:]])quận 5([^[:alnum:]]|$)' then 'Quận 5'
      when p.location ~* '(^|[^[:alnum:]])quận 7([^[:alnum:]]|$)' then 'Quận 7'
      when p.location ~* '(^|[^[:alnum:]])quận 10([^[:alnum:]]|$)' then 'Quận 10'
      when p.location ~* '(^|[^[:alnum:]])bình thạnh([^[:alnum:]]|$)' then 'Bình Thạnh'
      when p.location ~* '(^|[^[:alnum:]])phú nhuận([^[:alnum:]]|$)' then 'Phú Nhuận'
      when p.location ~* '(^|[^[:alnum:]])(vũng tàu|bà rịa)([^[:alnum:]]|$)' then 'Vũng Tàu'
      else coalesce(nullif(btrim(p.location),''),'Chưa rõ')
    end as area_label
  from public.property_public_catalog p
  where (p_transaction_type is null or p.transaction_type=p_transaction_type)
    and p.price is not null
    and p.price >= case when p.transaction_type='Rent' then 500000 else 50000000 end
), areas as (
  select area_label as label,count(*)::bigint as count from catalogue group by area_label order by count desc,label
), types as (
  select transaction_type,property_type,count(*)::bigint as count from catalogue group by transaction_type,property_type order by transaction_type, count desc,property_type
), projects as (
  select project_name as label,count(*)::bigint as count from catalogue where nullif(btrim(project_name),'') is not null group by project_name order by count desc,label
), prices as (
  select transaction_type,property_type,min(price) as min_price,max(price) as max_price from catalogue where price is not null group by transaction_type,property_type order by transaction_type,property_type
)
select jsonb_build_object(
  'areas',coalesce((select jsonb_agg(jsonb_build_object('label',label,'count',count)) from areas),'[]'::jsonb),
  'types',coalesce((select jsonb_agg(jsonb_build_object('transaction_type',transaction_type,'property_type',property_type,'count',count)) from types),'[]'::jsonb),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('label',label,'count',count)) from projects),'[]'::jsonb),
  'prices',coalesce((select jsonb_agg(jsonb_build_object('transaction_type',transaction_type,'property_type',property_type,'min_price',min_price,'max_price',max_price)) from prices),'[]'::jsonb)
);
$$;
revoke all on function public.pose_system_ai_catalogue_overview(text) from public,anon,authenticated;
grant execute on function public.pose_system_ai_catalogue_overview(text) to service_role;
commit;
