begin;

create table public.property_similar(
  property_id uuid not null references public.property_products(id) on delete cascade,
  similar_id uuid not null references public.property_products(id) on delete cascade,
  rank integer not null check (rank between 1 and 6),
  score double precision not null,
  embed_model text not null,
  computed_at timestamptz not null default now(),
  primary key(property_id, similar_id),
  check(property_id <> similar_id)
);
create unique index property_similar_rank_idx on public.property_similar(property_id, rank);
alter table public.property_similar enable row level security;
revoke all on public.property_similar from public, anon, authenticated;
grant all on public.property_similar to service_role;
create policy property_similar_no_direct_read on public.property_similar for select to anon, authenticated using(false);

create or replace function pose_private.property_similar_recompute(p_property uuid, p_embed_model text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501'; end if;
  delete from public.property_similar where property_id=p_property;
  if not exists(select 1 from public.property_public_catalog where id=p_property) then return 0; end if;
  if p_embed_model is null then
    with origin as (select * from public.property_public_catalog where id=p_property), candidates as (
      select p.id, 1-abs(p.price-o.price)/nullif(o.price,0) as score
      from public.property_public_catalog p cross join origin o
      where p.id<>p_property and p.transaction_type=o.transaction_type and p.property_type=o.property_type
        and p.availability in ('Available','Reserved') and p.price is not null and o.price is not null
        and p.price between o.price*.7 and o.price*1.3
        and regexp_replace(p.location,'.*,','')=regexp_replace(o.location,'.*,','')
      order by score desc,p.id limit 6
    ) insert into public.property_similar(property_id,similar_id,rank,score,embed_model)
      select p_property,id,row_number() over(order by score desc,id),score,'rule' from candidates;
    get diagnostics n=row_count; return n;
  end if;
  with vectors as (
    select d.source_id as id, avg(c.embedding) as vector
    from public.kb_documents d join public.kb_chunks c on c.document_id=d.id
    where d.source_type='Property' and d.published and c.embedding is not null and c.embed_model=p_embed_model
    group by d.source_id
  ), source as (select vector from vectors where id=p_property), candidates as (
    select v.id, 1-(v.vector operator(extensions.<=>) s.vector) as score
    from vectors v cross join source s join public.property_public_catalog p on p.id=v.id
    join public.property_public_catalog origin on origin.id=p_property
    where v.id<>p_property and p.transaction_type=origin.transaction_type and p.availability in ('Available','Reserved')
    order by v.vector operator(extensions.<=>) s.vector, v.id limit 6
  )
  insert into public.property_similar(property_id,similar_id,rank,score,embed_model)
  select p_property,id,row_number() over(order by score desc,id),score,p_embed_model from candidates;
  get diagnostics n=row_count; return n;
end $$;

create or replace function public.pose_system_remove_similar(p_property uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin delete from public.property_similar where property_id=p_property; get diagnostics n=row_count; return n; end $$;

create or replace function public.pose_system_recompute_similar(p_property uuid, p_embed_model text default null)
returns integer language sql security invoker set search_path='' as $$ select pose_private.property_similar_recompute(p_property,p_embed_model) $$;

create or replace function public.pose_similar_properties(p_property uuid, p_limit integer default 4)
returns table(id uuid, code text, name text, location text, description text, property_type text, area numeric, bedrooms integer, price numeric, price_period text, transaction_type text, availability text, updated_at timestamptz, cover_id uuid)
language sql stable security definer set search_path='' as $$
  select p.id,p.code,p.name,p.location,p.description,p.property_type,p.area,p.bedrooms,p.price,p.price_period,p.transaction_type,p.availability,p.updated_at,p.cover_id
  from public.property_similar s join public.property_public_catalog p on p.id=s.similar_id
  where s.property_id=p_property and p.publication='Published' and p.availability in ('Available','Reserved')
  order by s.rank, s.score desc, p.id limit greatest(0,least(coalesce(p_limit,4),4));
$$;
revoke all on function pose_private.property_similar_recompute(uuid,text), public.pose_system_recompute_similar(uuid,text), public.pose_system_remove_similar(uuid), public.pose_similar_properties(uuid,integer) from public,anon,authenticated;
grant execute on function public.pose_system_recompute_similar(uuid,text), public.pose_system_remove_similar(uuid) to service_role;
grant execute on function public.pose_similar_properties(uuid,integer) to anon,authenticated,service_role;
commit;
