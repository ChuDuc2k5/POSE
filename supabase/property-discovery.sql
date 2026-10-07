-- M03 customer discovery. Apply after property-management.sql and user-directory.sql.
begin;
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

create table pose_private.property_search_snapshots (
  id uuid primary key default gen_random_uuid(), filters jsonb not null,
  ids uuid[] not null, fingerprint text not null,
  expires_at timestamptz not null default now()+interval '10 minutes'
);
create index property_search_expiry_idx on pose_private.property_search_snapshots(expires_at);
alter table pose_private.property_search_snapshots enable row level security;
create policy snapshots_no_direct_access on pose_private.property_search_snapshots for all to anon,authenticated using(false) with check(false);
revoke all on pose_private.property_search_snapshots from public,anon,authenticated;

create function pose_private.search_properties(p_filters jsonb,p_page integer,p_size integer,p_snapshot uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snap pose_private.property_search_snapshots; rows jsonb; fresh text; n integer; key text; value numeric; reusable uuid;
begin
  if p_filters is null or jsonb_typeof(p_filters)<>'object' or p_page is null or p_page not between 1 and 10000
     or p_size is null or p_size not between 1 and 50 or exists(select 1 from jsonb_object_keys(p_filters) k
       where not k=any(array['q','location','project','type','minPrice','maxPrice','minArea','maxArea','bedrooms','availability','sort']))
     or coalesce(p_filters->>'sort','newest') not in ('newest','priceAsc','priceDesc','areaAsc','areaDesc')
     or char_length(coalesce(p_filters->>'q',''))>120 or char_length(coalesce(p_filters->>'location',''))>120
     or (p_filters ? 'type' and p_filters->>'type' not in ('Apartment','House','Land','Villa','Office','Shop'))
     or (p_filters ? 'availability' and p_filters->>'availability' not in ('Available','Reserved','Sold','Unavailable'))
     or (p_filters ? 'bedrooms' and (p_filters->>'bedrooms')::integer not between 0 and 100)
     or (p_filters ? 'minPrice' and (p_filters->>'minPrice')::numeric < 0)
     or (p_filters ? 'maxPrice' and (p_filters->>'maxPrice')::numeric > 1000000000000000)
     or (p_filters ? 'minArea' and (p_filters->>'minArea')::numeric < 0)
     or (p_filters ? 'maxArea' and (p_filters->>'maxArea')::numeric > 1000000000)
     or (p_filters->>'minPrice')::numeric > (p_filters->>'maxPrice')::numeric
     or (p_filters->>'minArea')::numeric > (p_filters->>'maxArea')::numeric then
    raise exception 'INVALID_FILTER' using errcode='22023';
  end if;
  foreach key in array array['q','location','project','type','availability','sort'] loop
    if p_filters ? key and jsonb_typeof(p_filters->key) is distinct from 'string' then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
  end loop;
  foreach key in array array['minPrice','maxPrice','minArea','maxArea','bedrooms'] loop
    if p_filters ? key then
      if jsonb_typeof(p_filters->key) is distinct from 'number' then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
      value:=(p_filters->>key)::numeric;
      if value<0 or value>(case when key like '%Price' then 1000000000000000 when key='bedrooms' then 100 else 1000000000 end)
        or (key='bedrooms' and value<>trunc(value)) then raise exception 'INVALID_FILTER' using errcode='22023'; end if;
    end if;
  end loop;
  if p_snapshot is null then
    -- Literal substring matching: punctuation cannot inject a PostgREST expression.
    select coalesce(array_agg(x.id),'{}'::uuid[]),coalesce(md5(string_agg(x.id::text||':'||x.revision,',')),'')
      into snap.ids,snap.fingerprint from (
      select p.id,p.revision from public.property_public_catalog p
      where (not p_filters ? 'q' or strpos(lower(p.code||' '||p.name||' '||p.project_name),lower(p_filters->>'q'))>0)
        and (not p_filters ? 'location' or strpos(lower(p.location),lower(p_filters->>'location'))>0)
        and (not p_filters ? 'project' or p.project_id=(p_filters->>'project')::uuid)
        and (not p_filters ? 'type' or p.property_type=p_filters->>'type')
        and (not p_filters ? 'availability' or p.availability=p_filters->>'availability')
        and (not p_filters ? 'minPrice' or p.price >= (p_filters->>'minPrice')::numeric)
        and (not p_filters ? 'maxPrice' or p.price <= (p_filters->>'maxPrice')::numeric)
        and (not p_filters ? 'minArea' or p.area >= (p_filters->>'minArea')::numeric)
        and (not p_filters ? 'maxArea' or p.area <= (p_filters->>'maxArea')::numeric)
        and (not p_filters ? 'bedrooms' or p.bedrooms=(p_filters->>'bedrooms')::integer)
      order by case when coalesce(p_filters->>'sort','newest')='newest' then p.updated_at end desc nulls last,
        case when p_filters->>'sort'='priceAsc' then p.price end asc nulls last,
        case when p_filters->>'sort'='priceDesc' then p.price end desc nulls last,
        case when p_filters->>'sort'='areaAsc' then p.area end asc nulls last,
        case when p_filters->>'sort'='areaDesc' then p.area end desc nulls last,p.id
      limit 10001
    ) x;
    if cardinality(snap.ids)>10000 then raise exception 'FILTER_TOO_BROAD' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(730003);
    delete from pose_private.property_search_snapshots where expires_at<=now();
    select id into reusable from pose_private.property_search_snapshots where filters=p_filters and fingerprint=snap.fingerprint order by expires_at desc limit 1;
    if reusable is not null then select * into snap from pose_private.property_search_snapshots where id=reusable;
    else
      if (select count(*) from pose_private.property_search_snapshots)>=1000 then raise exception 'SEARCH_BUSY' using errcode='53300'; end if;
      insert into pose_private.property_search_snapshots(filters,ids,fingerprint)
      values(p_filters,snap.ids,snap.fingerprint) returning * into snap;
    end if;
  else
    select * into snap from pose_private.property_search_snapshots where id=p_snapshot and expires_at>now() and filters=p_filters;
    if not found then raise exception 'SEARCH_EXPIRED' using errcode='40001'; end if;
    select coalesce(md5(string_agg(p.id::text||':'||p.revision,',' order by u.ord)),'') into fresh
    from unnest(snap.ids) with ordinality u(id,ord) join public.property_public_catalog p on p.id=u.id;
    if fresh<>snap.fingerprint then raise exception 'SEARCH_CHANGED' using errcode='40001'; end if;
  end if;
  n:=cardinality(snap.ids);
  select coalesce(jsonb_agg(to_jsonb(p)-'revision' order by u.ord),'[]'::jsonb) into rows
  from unnest(snap.ids) with ordinality u(id,ord) join public.property_public_catalog p on p.id=u.id
  where u.ord between (p_page-1)*p_size+1 and p_page*p_size;
  return jsonb_build_object('items',rows,'total',n,'page',p_page,'pageSize',p_size,'snapshot',snap.id,'expiresAt',snap.expires_at);
end $$;
-- Guest discovery is an intentionally public operation. No other private grants change.
grant usage on schema pose_private to anon;
revoke all on function pose_private.search_properties(jsonb,integer,integer,uuid) from public;
grant execute on function pose_private.search_properties(jsonb,integer,integer,uuid) to anon,authenticated;
create function public.pose_search_properties(p_filters jsonb,p_page integer,p_size integer,p_snapshot uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select pose_private.search_properties(p_filters,p_page,p_size,p_snapshot); $$;
revoke all on function public.pose_search_properties(jsonb,integer,integer,uuid) from public;
grant execute on function public.pose_search_properties(jsonb,integer,integer,uuid) to anon,authenticated;

create function pose_private.require_customer() returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare uid uuid:=pose_private.require_account();
begin
  if pose_private.pose_access_context()->>'role'<>'User' then raise exception 'CUSTOMER_REQUIRED' using errcode='42501'; end if;
  return uid;
end $$;
revoke all on function pose_private.require_customer() from public,anon;
grant execute on function pose_private.require_customer() to authenticated;

create table public.customer_property_favorites (
  user_id uuid not null references auth.users(id) on delete restrict,
  property_id uuid not null references public.property_products(id) on delete restrict,
  created_at timestamptz not null default now(), primary key(user_id,property_id)
);
create index customer_property_favorites_property_idx on public.customer_property_favorites(property_id);
create index customer_property_favorites_user_created_idx on public.customer_property_favorites(user_id,created_at desc,property_id);
alter table public.customer_property_favorites enable row level security;
revoke all on public.customer_property_favorites from public,anon,authenticated;
grant select on public.customer_property_favorites to authenticated;
create policy favorites_owner on public.customer_property_favorites for select to authenticated using (user_id=(select pose_private.require_customer()));
create function pose_private.set_favorite(p_property uuid,p_saved boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_customer();
begin
  if p_property is null or p_saved is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if p_saved then
    perform 1 from public.property_public_catalog where id=p_property;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    insert into public.customer_property_favorites(user_id,property_id) values(uid,p_property) on conflict do nothing;
  else delete from public.customer_property_favorites where user_id=uid and property_id=p_property; end if;
  return jsonb_build_object('property_id',p_property,'saved',p_saved);
end $$;
create function pose_private.read_favorites(p_page integer,p_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_customer(); result jsonb; total integer;
begin
  if p_page is null or p_page not between 1 and 10000 or p_size is null or p_size not between 1 and 50 then raise exception 'INVALID_PAGE' using errcode='22023'; end if;
  select count(*) into total from public.customer_property_favorites where user_id=uid;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.property_id),'[]'::jsonb) into result from (
    select f.property_id,f.created_at,case when p.id is null then null else to_jsonb(p)-'revision' end as property
    from public.customer_property_favorites f left join public.property_public_catalog p on p.id=f.property_id
    where f.user_id=uid order by f.created_at desc,f.property_id limit p_size offset (p_page-1)*p_size
  ) x;
  return jsonb_build_object('items',result,'total',total,'page',p_page,'pageSize',p_size);
end $$;
revoke all on function pose_private.set_favorite(uuid,boolean),pose_private.read_favorites(integer,integer) from public,anon;
grant execute on function pose_private.set_favorite(uuid,boolean),pose_private.read_favorites(integer,integer) to authenticated;
create function public.pose_set_favorite(p_property uuid,p_saved boolean) returns jsonb
language sql security invoker set search_path='' as $$select pose_private.set_favorite(p_property,p_saved);$$;
create function public.pose_read_favorites(p_page integer,p_size integer) returns jsonb
language sql security invoker set search_path='' as $$select pose_private.read_favorites(p_page,p_size);$$;
revoke all on function public.pose_set_favorite(uuid,boolean),public.pose_read_favorites(integer,integer) from public,anon;
grant execute on function public.pose_set_favorite(uuid,boolean),public.pose_read_favorites(integer,integer) to authenticated;

-- Link verified customers to Auth. Preserve legacy data, require review on phone collisions.
alter table public.customers add column auth_user_id uuid unique references auth.users(id) on delete restrict;
alter table public.customers add column phone_verified_at timestamptz;
create unique index leads_one_open_customer_idx on public.leads(customer_id) where status not in ('CONVERTED','LOST');
create table public.property_inquiries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
  property_id uuid references public.property_products(id) on delete restrict, property_name text,
  customer_id uuid references public.customers(id) on delete restrict, lead_id uuid references public.leads(id) on delete restrict,
  name text not null check(char_length(name) between 2 and 80), phone text not null check(phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text not null, country text not null check(country in ('VN','International')),
  channel text not null check(channel in ('Email','Phone')), preferred_time text not null default '' check(char_length(preferred_time)<=200),
  message text not null check(char_length(message)<=3000),
  status text not null check(status in ('PendingVerification','Received','NeedsReview')),
  phone_verified boolean not null, consent jsonb not null, consent_evidence jsonb not null,
  request_key uuid not null, payload_fingerprint text not null, request_payload jsonb not null, created_at timestamptz not null default now(), unique(user_id,request_key)
);
create index property_inquiries_user_created_idx on public.property_inquiries(user_id,created_at desc,id);
create index property_inquiries_property_idx on public.property_inquiries(property_id);
create index property_inquiries_customer_idx on public.property_inquiries(customer_id);
create index property_inquiries_lead_idx on public.property_inquiries(lead_id);
alter table public.property_inquiries enable row level security;
revoke all on public.property_inquiries from public,anon,authenticated;
grant select on public.property_inquiries to authenticated;
create policy inquiries_owner on public.property_inquiries for select to authenticated using(user_id=(select pose_private.require_customer()));

create function pose_private.submit_inquiry(p_data jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_customer(); a auth.users; existing public.property_inquiries; product public.property_products;
  cid uuid; lid uuid; verified boolean; state text; consent jsonb; evidence jsonb; result public.property_inquiries;
  hash text; pname text; purpose text; v_phone text; profphone text;
begin
  if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object'
    or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(array['property_id','name','phone','country','channel','preferred_time','message','consent']))
    or char_length(btrim(coalesce(p_data->>'name',''))) not between 2 and 80
    or coalesce(p_data->>'phone','') !~ '^\+[1-9][0-9]{7,14}$'
    or coalesce(p_data->>'country','') not in ('VN','International')
    or (p_data->>'country'='VN' and p_data->>'phone' !~ '^\+84[0-9]{9}$')
    or coalesce(p_data->>'channel','') not in ('Email','Phone')
    or char_length(coalesce(p_data->>'preferred_time',''))>200
    or char_length(coalesce(p_data->>'message',''))>3000
    or jsonb_typeof(p_data->'consent') is distinct from 'object'
    or (p_data->'consent'->'contact') is distinct from 'true'::jsonb then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  consent:=p_data->'consent';
  foreach purpose in array array['name','phone','country','channel'] loop
    if jsonb_typeof(p_data->purpose) is distinct from 'string' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  foreach purpose in array array['preferred_time','message'] loop
    if p_data ? purpose and jsonb_typeof(p_data->purpose) is distinct from 'string' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(consent) k where not k=any(array['contact','call','ai','transcript','recording'])) then raise exception 'INVALID_CONSENT' using errcode='22023'; end if;
  foreach purpose in array array['contact','call','ai','transcript','recording'] loop
    if jsonb_typeof(consent->purpose) is distinct from 'boolean' then raise exception 'INVALID_CONSENT' using errcode='22023'; end if;
  end loop;
  if p_data->>'channel'='Phone' and not (consent->>'call')::boolean then raise exception 'CALL_CONSENT_REQUIRED' using errcode='22023'; end if;
  hash:=md5(p_data::text);
  -- Serialize this customer's submissions and verified identity matching atomically.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,3));
  select * into a from auth.users where id=uid;
  select contact_phone into profphone from public.account_profiles where user_id=uid;
  v_phone:=p_data->>'phone';
  verified:=coalesce(a.phone_confirmed_at is not null and ltrim(a.phone,'+')=ltrim(v_phone,'+') and profphone=v_phone,false);
  select * into existing from public.property_inquiries where user_id=uid and request_key=p_key;
  if found then
    if existing.payload_fingerprint<>hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    if existing.status<>'PendingVerification' or not verified then
      return jsonb_build_object('id',existing.id,'status',existing.status,'phone_verified',existing.phone_verified,'created_at',existing.created_at,'replayed',true);
    end if;
  end if;
  if existing.id is null and (select count(*) from public.property_inquiries where user_id=uid and created_at>now()-interval '1 hour')>=10 then raise exception 'INQUIRY_LIMIT' using errcode='53300'; end if;
  if p_data->>'property_id' is not null then
    select * into product from public.property_products p where p.id=(p_data->>'property_id')::uuid
      and exists(select 1 from public.property_public_catalog x where x.id=p.id);
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    pname:=product.name;
  elsif char_length(btrim(coalesce(p_data->>'message','')))<10 then raise exception 'NEEDS_REQUIRED' using errcode='22023'; end if;
  state:=case when verified then 'Received' else 'PendingVerification' end;
  if verified then
    perform pg_advisory_xact_lock(hashtextextended(v_phone,3));
    select c.id into cid from public.customers c where c.phone=v_phone and c.auth_user_id=uid for update;
    if cid is null and exists(select 1 from public.customers c where ltrim(c.phone,'+')=ltrim(v_phone,'+') or c.auth_user_id=uid
      or (p_data->>'country'='VN' and c.phone='0'||substring(v_phone from 4))) then
      state:='NeedsReview';
    else
      if cid is null then insert into public.customers(full_name,phone,email,source,auth_user_id,phone_verified_at)
        values(btrim(p_data->>'name'),v_phone,a.email,'Web',uid,a.phone_confirmed_at) returning id into cid; end if;
      select l.id into lid from public.leads l where l.customer_id=cid and l.status not in ('CONVERTED','LOST') for update;
      if lid is null and exists(select 1 from public.leads l where l.customer_id=cid) then state:='NeedsReview';
      elsif lid is null then insert into public.leads(customer_id) values(cid) returning id into lid; end if;
    end if;
  end if;
  select jsonb_agg(jsonb_build_object('purpose',x.key,'channel',p_data->>'channel','status',case when x.value='true'::jsonb then 'Granted' else 'Declined' end,
    'source','CustomerWeb','recorded_at',now(),'version','2026-10-05','user_id',uid)) into evidence from jsonb_each(consent) x;
  if existing.id is not null then
    update public.property_inquiries set customer_id=cid,lead_id=lid,status=state,phone_verified=verified where id=existing.id returning * into result;
  else
    insert into public.property_inquiries(user_id,property_id,property_name,customer_id,lead_id,name,phone,email,country,channel,preferred_time,message,status,phone_verified,consent,consent_evidence,request_key,payload_fingerprint,request_payload)
    values(uid,product.id,pname,cid,lid,btrim(p_data->>'name'),v_phone,a.email,p_data->>'country',p_data->>'channel',coalesce(p_data->>'preferred_time',''),coalesce(p_data->>'message',''),state,verified,consent,evidence,p_key,hash,p_data)
    returning * into result;
  end if;
  return jsonb_build_object('id',result.id,'status',result.status,'phone_verified',result.phone_verified,'created_at',result.created_at,'replayed',false);
end $$;
create function pose_private.confirm_inquiry(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_customer(); inquiry public.property_inquiries;
begin
  select * into inquiry from public.property_inquiries where id=p_id and user_id=uid;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  return pose_private.submit_inquiry(inquiry.request_payload,inquiry.request_key);
end $$;
create function pose_private.read_inquiries(p_page integer,p_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_customer(); result jsonb; n integer;
begin
  if p_page is null or p_page not between 1 and 10000 or p_size is null or p_size not between 1 and 50 then raise exception 'INVALID_PAGE' using errcode='22023'; end if;
  select count(*) into n from public.property_inquiries where user_id=uid;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) into result from (
    select id,property_id,property_name,name,phone,email,country,channel,preferred_time,message,status,phone_verified,consent,created_at
    from public.property_inquiries where user_id=uid order by created_at desc,id limit p_size offset (p_page-1)*p_size
  ) x;
  return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',p_size);
end $$;
revoke all on function pose_private.submit_inquiry(jsonb,uuid),pose_private.read_inquiries(integer,integer),pose_private.confirm_inquiry(uuid) from public,anon;
grant execute on function pose_private.submit_inquiry(jsonb,uuid),pose_private.read_inquiries(integer,integer),pose_private.confirm_inquiry(uuid) to authenticated;
create function public.pose_submit_inquiry(p_data jsonb,p_key uuid) returns jsonb
language sql security invoker set search_path='' as $$ select pose_private.submit_inquiry(p_data,p_key); $$;
create function public.pose_read_inquiries(p_page integer,p_size integer) returns jsonb
language sql security invoker set search_path='' as $$ select pose_private.read_inquiries(p_page,p_size); $$;
create function public.pose_confirm_inquiry(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select pose_private.confirm_inquiry(p_id); $$;
revoke all on function public.pose_submit_inquiry(jsonb,uuid),public.pose_read_inquiries(integer,integer),public.pose_confirm_inquiry(uuid) from public,anon;
grant execute on function public.pose_submit_inquiry(jsonb,uuid),public.pose_read_inquiries(integer,integer),public.pose_confirm_inquiry(uuid) to authenticated;
commit;
