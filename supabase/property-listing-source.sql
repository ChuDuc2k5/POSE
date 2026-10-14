-- Sale/rent listings and imported-listing provenance for M02/M03 products.
-- Apply after property-discovery.sql. Additive: existing products become
-- Sale listings with a total price; nothing is deleted.
begin;
alter table public.property_products
  add column transaction_type text not null default 'Sale' check (transaction_type in ('Sale','Rent')),
  add column price_period text not null default 'Total' check (price_period in ('Total','Month')),
  add column source_website text check (source_website is null or char_length(btrim(source_website)) between 3 and 120),
  add column source_url text check (source_url is null or source_url ~ '^https?://'),
  add column source_external_id text check (source_external_id is null or char_length(source_external_id) between 1 and 120),
  add column scraped_at timestamptz,
  add column data_quality text not null default 'Verified' check (data_quality in ('Verified','NeedsReview')),
  add column quality_notes text not null default '' check (char_length(quality_notes) <= 1000);
alter table public.property_products add constraint property_products_price_period
  check ((transaction_type='Sale' and price_period='Total') or (transaction_type='Rent' and price_period='Month'));
-- Re-importing the same listing updates it instead of creating a duplicate.
alter table public.property_products add constraint property_products_source_unique unique (source_website,source_external_id);

-- An imported listing may arrive without an area; it stays a draft until an
-- Admin fills it in, because a published product always shows its area.
alter table public.property_products alter column area drop not null;
alter table public.property_products add constraint property_products_published_area
  check (publication <> 'Published' or area is not null);

-- p.* is expanded when a view is created, so rebuild it to expose the new columns.
drop view public.property_public_catalog;
create view public.property_public_catalog with (security_invoker=true) as
select p.*, j.name as project_name, j.amenities, s.name as subdivision_name,
  p.version::text||':'||j.version::text||':'||coalesce(s.version::text,'') as revision,
  (select m.id from public.property_media m where m.property_id=p.id and m.media_type='Image'
   and m.visibility='Public' and m.visible and not m.removed order by m.sort_order,m.id limit 1) as cover_id
from public.property_products p join public.property_projects j on j.id=p.project_id
left join public.property_subdivisions s on s.id=p.subdivision_id
where p.publication='Published' and not j.archived and (p.subdivision_id is null or not s.archived);
revoke all on public.property_public_catalog from public,anon,authenticated;
grant select on public.property_public_catalog to anon,authenticated,service_role;
commit;
