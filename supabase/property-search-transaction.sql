-- Apply after property-listing-source.sql. Preserve snapshot filters and fingerprint checks.
begin;
create or replace function pose_private.search_properties(p_filters jsonb,p_page integer,p_size integer,p_snapshot uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snap pose_private.property_search_snapshots; rows jsonb; fresh text; n integer; key text; value numeric; reusable uuid;
begin
  if p_filters is null or jsonb_typeof(p_filters)<>'object' or p_page is null or p_page not between 1 and 10000
     or p_size is null or p_size not between 1 and 50 or exists(select 1 from jsonb_object_keys(p_filters) k
       where not k=any(array['q','location','project','type','transaction','minPrice','maxPrice','minArea','maxArea','bedrooms','availability','sort']))
     or coalesce(p_filters->>'sort','newest') not in ('newest','priceAsc','priceDesc','areaAsc','areaDesc')
     or char_length(coalesce(p_filters->>'q',''))>120 or char_length(coalesce(p_filters->>'location',''))>120
     or (p_filters ? 'type' and p_filters->>'type' not in ('Apartment','House','Land','Villa','Office','Shop'))
     or (p_filters ? 'transaction' and p_filters->>'transaction' not in ('Sale','Rent'))
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
  foreach key in array array['q','location','project','type','availability','sort','transaction'] loop
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
        and (not p_filters ? 'transaction' or p.transaction_type=p_filters->>'transaction')
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
commit;
