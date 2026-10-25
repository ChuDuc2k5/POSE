-- Apply after the existing M02/M03 schema scripts. Additive: preserve products,
-- media, references and audit records. No physical deletion or new public data.
begin;

alter table public.property_products
  add column created_by uuid references auth.users(id) on delete restrict,
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete restrict,
  add constraint property_deletion_metadata check ((deleted_at is null) = (deleted_by is null));

-- Only an actual creation event proves ownership. Imported/unknown legacy rows
-- remain NULL, rather than being assigned to the migration operator.
update public.property_products p set created_by=h.actor_id
from (select distinct on (entity_id) entity_id,actor_id
      from public.property_history where entity_kind='properties' and action='properties_created'
      order by entity_id,created_at,id) h
where p.id=h.entity_id;

create index properties_creator_active_idx on public.property_products(created_by,updated_at desc,id) where deleted_at is null;
create index properties_trash_idx on public.property_products(deleted_at desc,id) where deleted_at is not null;
create index properties_deleted_by_idx on public.property_products(deleted_by) where deleted_by is not null;

create function pose_private.property_lifecycle_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.created_by:=auth.uid();
    new.deleted_at:=null;
    new.deleted_by:=null;
  else
    if new.created_by is distinct from old.created_by then
      raise exception 'IMMUTABLE_CREATOR' using errcode='42501';
    end if;
    if old.deleted_at is not null and new.deleted_at is not null then
      raise exception 'PRODUCT_TRASHED' using errcode='22023';
    end if;
  end if;
  return new;
end; $$;
revoke all on function pose_private.property_lifecycle_guard() from public,anon,authenticated;
create trigger property_lifecycle_guard before insert or update on public.property_products
for each row execute function pose_private.property_lifecycle_guard();

create function pose_private.property_media_lifecycle_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare product public.property_products;
begin
  -- Serialize media changes with delete/restore; the existing save RPC already
  -- takes the same parent lock before taking a media lock.
  select * into product from public.property_products where id=new.property_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if product.deleted_at is not null then raise exception 'PRODUCT_TRASHED' using errcode='22023'; end if;
  return new;
end; $$;
revoke all on function pose_private.property_media_lifecycle_guard() from public,anon,authenticated;
create trigger property_media_lifecycle_guard before insert or update on public.property_media
for each row execute function pose_private.property_media_lifecycle_guard();

create function pose_private.catalog_lifecycle(p_id uuid,p_version integer,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; product public.property_products; before_row jsonb; result jsonb;
begin
  actor:=pose_private.require_account();
  if not pose_private.catalog_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_id is null or p_version is null or p_version<0 or p_action is null or p_action not in ('delete','restore') then
    raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if p_reason is null or char_length(btrim(p_reason))<3 or char_length(p_reason)>1000 then
    raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  select * into product from public.property_products where id=p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if product.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if (p_action='delete' and product.deleted_at is not null) or (p_action='restore' and product.deleted_at is null) then
    raise exception 'INVALID_LIFECYCLE' using errcode='22023'; end if;
  before_row:=to_jsonb(product);
  if p_action='delete' then
    update public.property_products set deleted_at=now(),deleted_by=actor,version=version+1,updated_at=now()
    where id=p_id returning to_jsonb(property_products.*) into result;
  else
    -- Restoring never republishes a potentially outdated listing automatically.
    update public.property_products set deleted_at=null,deleted_by=null,publication='Draft',version=version+1,updated_at=now()
    where id=p_id returning to_jsonb(property_products.*) into result;
  end if;
  insert into public.property_history(entity_kind,entity_id,actor_id,action,reason,before_data,after_data)
  values('properties',p_id,actor,case when p_action='delete' then 'properties_deleted' else 'properties_restored' end,btrim(p_reason),before_row,result);
  return result;
end; $$;
revoke all on function pose_private.catalog_lifecycle(uuid,integer,text,text) from public,anon;
grant execute on function pose_private.catalog_lifecycle(uuid,integer,text,text) to authenticated;
create function public.pose_catalog_lifecycle(p_id uuid,p_version integer,p_action text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select pose_private.catalog_lifecycle(p_id,p_version,p_action,p_reason);
$$;
revoke all on function public.pose_catalog_lifecycle(uuid,integer,text,text) from public,anon;
grant execute on function public.pose_catalog_lifecycle(uuid,integer,text,text) to authenticated;

alter policy properties_public on public.property_products using (
  deleted_at is null and publication='Published'
  and exists(select 1 from public.property_projects j where j.id=project_id and not j.archived)
  and (subdivision_id is null or exists(select 1 from public.property_subdivisions s where s.id=subdivision_id and not s.archived))
);
alter policy media_admin on public.property_media using (
  (select pose_private.catalog_admin()) and exists(select 1 from public.property_products p where p.id=property_id and p.deleted_at is null)
);
alter policy media_public on public.property_media using (
  visibility='Public' and visible and not removed
  and exists(select 1 from public.property_products p where p.id=property_id and p.deleted_at is null and p.publication='Published'
    and exists(select 1 from public.property_projects j where j.id=p.project_id and not j.archived)
    and (p.subdivision_id is null or exists(select 1 from public.property_subdivisions s where s.id=p.subdivision_id and not s.archived)))
);

-- Preserve the exact existing public columns (including Sale/Rent provenance),
-- without exposing the new creator/deletion metadata. The explicit predicate
-- also protects privileged M03 snapshot searches which cannot rely on RLS.
do $$
declare existing_view text;
begin
  existing_view:=rtrim(pg_get_viewdef('public.property_public_catalog'::regclass,true), E';\n ');
  execute format('create or replace view public.property_public_catalog with (security_invoker=true) as select listing.* from (%s) listing where exists(select 1 from public.property_products current_product where current_product.id=listing.id and current_product.deleted_at is null)',existing_view);
end; $$;
notify pgrst,'reload schema';
commit;
