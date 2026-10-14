-- M02. Apply after auth-access.sql and account-profile.sql.
begin;
create table public.property_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  location text not null check (char_length(btrim(location)) between 2 and 300),
  description text not null default '' check (char_length(description) <= 10000),
  amenities text not null default '' check (char_length(amenities) <= 3000),
  archived boolean not null default false,
  version integer not null default 0, updated_at timestamptz not null default now()
);
create table public.property_subdivisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.property_projects(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  location text not null check (char_length(btrim(location)) between 2 and 300),
  description text not null default '' check (char_length(description) <= 10000),
  amenities text not null default '' check (char_length(amenities) <= 3000),
  archived boolean not null default false,
  version integer not null default 0, updated_at timestamptz not null default now(),
  unique(project_id,code), unique(project_id,id)
);
create table public.property_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.property_projects(id) on delete restrict,
  subdivision_id uuid,
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  location text not null check (char_length(btrim(location)) between 2 and 300),
  description text not null default '' check (char_length(description) <= 10000),
  property_type text not null check (property_type in ('Apartment','House','Land','Villa','Office','Shop')),
  area numeric(12,2) not null check (area > 0 and area <= 1000000000),
  bedrooms integer check (bedrooms between 0 and 100),
  price numeric(18,2) check (price > 0 and price <= 1000000000000000),
  currency text not null default 'VND' check (currency = 'VND'),
  publication text not null default 'Draft' check (publication in ('Draft','Published','Hidden','Archived')),
  availability text not null default 'Unavailable' check (availability in ('Available','Reserved','Sold','Unavailable')),
  version integer not null default 0, updated_at timestamptz not null default now(),
  foreign key(project_id,subdivision_id) references public.property_subdivisions(project_id,id) on delete restrict,
  check (publication <> 'Published' or char_length(btrim(description)) >= 20)
);
create table public.property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.property_products(id) on delete restrict,
  object_key text not null unique,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  media_type text not null check (media_type in ('Image','Document')),
  mime_type text not null check (mime_type in ('image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  visibility text not null default 'Internal' check (visibility in ('Public','Internal')),
  visible boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  removed boolean not null default false,
  version integer not null default 0, updated_at timestamptz not null default now(),
  check ((media_type='Image' and mime_type='image/webp' and size_bytes<=10485760) or (media_type='Document' and mime_type='application/pdf'))
);
create table public.property_history (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null, entity_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null, reason text not null default '',
  before_data jsonb, after_data jsonb not null,
  source text not null default 'Admin', created_at timestamptz not null default now()
);
create index property_subdivisions_project_idx on public.property_subdivisions(project_id);
create index properties_parent_idx on public.property_products(project_id,subdivision_id);
create index properties_subdivision_idx on public.property_products(subdivision_id);
create index properties_publication_idx on public.property_products(publication,updated_at desc,id);
create index property_media_property_idx on public.property_media(property_id,sort_order,id);
create index property_history_entity_idx on public.property_history(entity_kind,entity_id,created_at desc);
create index property_history_actor_idx on public.property_history(actor_id);

create function pose_private.catalog_admin() returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce(c->>'role'='Admin' and (c->>'active')::boolean and (c->>'session_valid')::boolean,false)
  from (select pose_private.pose_access_context() c) context;
$$;
revoke all on function pose_private.catalog_admin() from public,anon;
grant execute on function pose_private.catalog_admin() to authenticated;

alter table public.property_projects enable row level security;
alter table public.property_subdivisions enable row level security;
alter table public.property_products enable row level security;
alter table public.property_media enable row level security;
alter table public.property_history enable row level security;
revoke all on public.property_projects,public.property_subdivisions,public.property_products,public.property_media,public.property_history from anon,authenticated;
grant select on public.property_projects,public.property_subdivisions,public.property_products,public.property_media to anon,authenticated;
grant select on public.property_history to authenticated;
create policy projects_admin on public.property_projects for select to authenticated using ((select pose_private.catalog_admin()));
create policy projects_public on public.property_projects for select to anon,authenticated using (not archived);
create policy subdivisions_admin on public.property_subdivisions for select to authenticated using ((select pose_private.catalog_admin()));
create policy subdivisions_public on public.property_subdivisions for select to anon,authenticated using (not archived and exists(select 1 from public.property_projects p where p.id=project_id and not p.archived));
create policy properties_admin on public.property_products for select to authenticated using ((select pose_private.catalog_admin()));
create policy properties_public on public.property_products for select to anon,authenticated using (
  publication='Published' and exists(select 1 from public.property_projects p where p.id=project_id and not p.archived)
  and (subdivision_id is null or exists(select 1 from public.property_subdivisions s where s.id=subdivision_id and not s.archived))
);
create policy media_admin on public.property_media for select to authenticated using ((select pose_private.catalog_admin()));
create policy media_public on public.property_media for select to anon,authenticated using (
  visibility='Public' and visible and not removed and exists(select 1 from public.property_products p
  where p.id=property_id and p.publication='Published' and exists(select 1 from public.property_projects j where j.id=p.project_id and not j.archived)
  and (p.subdivision_id is null or exists(select 1 from public.property_subdivisions s where s.id=p.subdivision_id and not s.archived)))
);
create policy history_admin on public.property_history for select to authenticated using ((select pose_private.catalog_admin()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('property-files','property-files',false,20971520,array['image/webp','application/pdf']);
-- Browser clients cannot sign/download files directly. All downloads use the
-- application gateway, which checks current publication and file permissions.
create policy property_files_admin_read on storage.objects for select to authenticated
using (bucket_id='property-files' and (select pose_private.catalog_admin()));
create policy property_files_admin_insert on storage.objects for insert to authenticated
with check (bucket_id='property-files' and (select pose_private.catalog_admin())
  and exists(select 1 from public.property_products p where p.id::text=(storage.foldername(storage.objects.name))[1]));
create policy property_files_admin_cleanup on storage.objects for delete to authenticated
using (bucket_id='property-files' and (select pose_private.catalog_admin())
  and not exists(select 1 from public.property_media m where m.object_key=storage.objects.name));

-- Single transaction for version, parent constraints and immutable history.
-- No DELETE API: archive records or remove a media link without deleting history.
create function pose_private.save_catalog(p_kind text,p_id uuid,p_version integer,p_data jsonb,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid; old_data jsonb; result jsonb; old_version integer; parent uuid; allowed text[];
  j public.property_projects; s public.property_subdivisions; p public.property_products; m public.property_media;
begin
  p_reason := coalesce(p_reason,'');
  actor := pose_private.require_account();
  if not pose_private.catalog_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or p_version is null or p_version<0 or char_length(p_reason)>1000 then
    raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if p_kind='projects' then allowed:=array['code','name','location','description','amenities','archived'];
  elsif p_kind='subdivisions' then allowed:=array['project_id','code','name','location','description','amenities','archived'];
  elsif p_kind='properties' then allowed:=array['project_id','subdivision_id','code','name','location','description','property_type','area','bedrooms','price','publication','availability'];
  elsif p_kind='media' then
    allowed:=case when p_id is null then array['property_id','object_key','name','media_type','mime_type','size_bytes','checksum','visibility','visible','sort_order']
      else array['name','visibility','visible','sort_order','removed'] end;
  else raise exception 'INVALID_KIND' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where not k=any(allowed)) then raise exception 'INVALID_FIELD' using errcode='22023'; end if;
  if p_id is null and p_kind<>'media' and p_version<>0 then raise exception 'INVALID_VERSION' using errcode='22023'; end if;
  if p_kind='media' then
    if p_id is null then parent:=(p_data->>'property_id')::uuid;
    else select property_id into parent from public.property_media where id=p_id; end if;
    select * into p from public.property_products where id=parent for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  end if;
  if p_id is not null then
    if p_kind='projects' then select to_jsonb(t),version into old_data,old_version from public.property_projects t where id=p_id for update;
    elsif p_kind='subdivisions' then select to_jsonb(t),version into old_data,old_version from public.property_subdivisions t where id=p_id for update;
    elsif p_kind='properties' then select to_jsonb(t),version into old_data,old_version from public.property_products t where id=p_id for update;
    else select to_jsonb(t),version into old_data,old_version from public.property_media t where id=p_id for update; end if;
    if old_data is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if old_version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  end if;
  if p_kind in ('projects','subdivisions') then
    if coalesce((p_data->>'archived')::boolean,false) and (old_data is null or not (old_data->>'archived')::boolean) and char_length(btrim(p_reason))<3 then
      raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
    if p_kind='projects' then
      j:=jsonb_populate_record(null::public.property_projects,coalesce(old_data,'{}'::jsonb)||p_data);
      if p_id is null then
        insert into public.property_projects(code,name,location,description,amenities,archived)
        values(upper(btrim(j.code)),btrim(j.name),btrim(j.location),coalesce(j.description,''),coalesce(j.amenities,''),coalesce(j.archived,false)) returning to_jsonb(property_projects.*) into result;
      else
        update public.property_projects set code=upper(btrim(j.code)),name=btrim(j.name),location=btrim(j.location),description=j.description,amenities=j.amenities,archived=j.archived,version=version+1,updated_at=now()
        where id=p_id returning to_jsonb(property_projects.*) into result;
      end if;
    else
      s:=jsonb_populate_record(null::public.property_subdivisions,coalesce(old_data,'{}'::jsonb)||p_data);
      perform 1 from public.property_projects where id=s.project_id and not archived for share;
      if not found then raise exception 'PARENT_INACTIVE' using errcode='22023'; end if;
      if p_id is null then
        insert into public.property_subdivisions(project_id,code,name,location,description,amenities,archived)
        values(s.project_id,upper(btrim(s.code)),btrim(s.name),btrim(s.location),coalesce(s.description,''),coalesce(s.amenities,''),coalesce(s.archived,false)) returning to_jsonb(property_subdivisions.*) into result;
      else
        update public.property_subdivisions set project_id=s.project_id,code=upper(btrim(s.code)),name=btrim(s.name),location=btrim(s.location),description=s.description,amenities=s.amenities,archived=s.archived,version=version+1,updated_at=now()
        where id=p_id returning to_jsonb(property_subdivisions.*) into result;
      end if;
    end if;
  elsif p_kind='properties' then
    p:=jsonb_populate_record(null::public.property_products,coalesce(old_data,'{}'::jsonb)||p_data);
    perform 1 from public.property_projects where id=p.project_id and not archived for share;
    if not found then raise exception 'PARENT_INACTIVE' using errcode='22023'; end if;
    if p.subdivision_id is not null then
      perform 1 from public.property_subdivisions where id=p.subdivision_id and project_id=p.project_id and not archived for share;
      if not found then raise exception 'PARENT_INACTIVE' using errcode='22023'; end if;
    end if;
    if ((p.publication in ('Hidden','Archived') and p.publication is distinct from old_data->>'publication')
      or (old_data is not null and p.availability is distinct from old_data->>'availability')) and char_length(btrim(p_reason))<3 then
      raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
    if p_id is null then
      insert into public.property_products(project_id,subdivision_id,code,name,location,description,property_type,area,bedrooms,price,publication,availability)
      values(p.project_id,p.subdivision_id,upper(btrim(p.code)),btrim(p.name),btrim(p.location),coalesce(p.description,''),p.property_type,p.area,p.bedrooms,p.price,coalesce(p.publication,'Draft'),coalesce(p.availability,'Unavailable')) returning to_jsonb(property_products.*) into result;
    else
      update public.property_products set project_id=p.project_id,subdivision_id=p.subdivision_id,code=upper(btrim(p.code)),name=btrim(p.name),location=btrim(p.location),description=p.description,property_type=p.property_type,area=p.area,bedrooms=p.bedrooms,price=p.price,publication=p.publication,availability=p.availability,version=version+1,updated_at=now()
      where id=p_id returning to_jsonb(property_products.*) into result;
    end if;
  else
    m:=jsonb_populate_record(null::public.property_media,coalesce(old_data,'{}'::jsonb)||p_data);
    if p_id is null then
      if p.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
      if m.object_key !~ ('^'||parent::text||'/[a-f0-9-]{36}\.(webp|pdf)$') or not exists(select 1 from storage.objects where bucket_id='property-files' and name=m.object_key) then
        raise exception 'FILE_NOT_FOUND' using errcode='22023'; end if;
      insert into public.property_media(property_id,object_key,name,media_type,mime_type,size_bytes,checksum,visibility,visible,sort_order)
      values(parent,m.object_key,btrim(m.name),m.media_type,m.mime_type,m.size_bytes,m.checksum,coalesce(m.visibility,'Internal'),coalesce(m.visible,true),coalesce(m.sort_order,0)) returning to_jsonb(property_media.*) into result;
    else
      update public.property_media set name=btrim(m.name),visibility=m.visibility,visible=m.visible and not m.removed,sort_order=m.sort_order,removed=m.removed,version=version+1,updated_at=now()
      where id=p_id returning to_jsonb(property_media.*) into result;
    end if;
    update public.property_products set version=version+1,updated_at=now() where id=parent;
  end if;
  insert into public.property_history(entity_kind,entity_id,actor_id,action,reason,before_data,after_data)
  values(case when p_kind='media' then 'properties' else p_kind end,
    case when p_kind='media' then parent else (result->>'id')::uuid end,actor,
    p_kind||case when p_id is null then '_created' else '_updated' end,btrim(p_reason),old_data,result);
  return result;
end; $$;
revoke all on function pose_private.save_catalog(text,uuid,integer,jsonb,text) from public,anon;
grant execute on function pose_private.save_catalog(text,uuid,integer,jsonb,text) to authenticated;
create function public.pose_save_catalog(p_kind text,p_id uuid,p_version integer,p_data jsonb,p_reason text default '')
returns jsonb language sql security invoker set search_path='' as $$ select pose_private.save_catalog(p_kind,p_id,p_version,p_data,p_reason); $$;
revoke all on function public.pose_save_catalog(text,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.pose_save_catalog(text,uuid,integer,jsonb,text) to authenticated;
commit;
