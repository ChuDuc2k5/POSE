begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function pose_private.kb_unaccent(value text) returns text
language sql immutable strict parallel safe set search_path='' as $$select extensions.unaccent('extensions.unaccent',value)$$;

create table public.kb_documents(
 id uuid primary key default gen_random_uuid(),
 source_type text not null check(source_type in('Property','Faq')),
 source_id uuid,
 title text not null,
 body text not null default '',
 metadata jsonb not null default '{}',
 content_hash text,
 source_updated_at timestamptz not null default now(),
 published boolean not null default false,
 updated_at timestamptz not null default now(),
 unique(source_type,source_id),
 check(source_type='Property' and source_id is not null or source_type='Faq')
);
create table public.kb_chunks(
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.kb_documents(id) on delete cascade,
 chunk_index integer not null check(chunk_index>=0),
 content text not null,
 header text not null,
 embedding extensions.vector(1024),
 embed_model text,
 tsv tsvector generated always as (to_tsvector('simple',pose_private.kb_unaccent(header||' '||content))) stored,
 created_at timestamptz not null default now(),
 unique(document_id,chunk_index),
 check((embedding is null)=(embed_model is null))
);
create index kb_chunks_embedding_hnsw on public.kb_chunks using hnsw(embedding extensions.vector_cosine_ops) with(m=16,ef_construction=64);
create index kb_chunks_tsv_gin on public.kb_chunks using gin(tsv);
create index kb_documents_source_updated_idx on public.kb_documents(source_type,source_updated_at);

alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
revoke all on public.kb_documents,public.kb_chunks from public,anon,authenticated;
grant all on public.kb_documents,public.kb_chunks to service_role;
create policy kb_documents_no_direct_read on public.kb_documents for select to anon,authenticated using(false);
create policy kb_chunks_no_direct_read on public.kb_chunks for select to anon,authenticated using(false);

create or replace function pose_private.kb_sync_documents(p_all boolean default false,p_embed_model text default null) returns table(document_id uuid)
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501';end if;
 insert into public.kb_documents(source_type,source_id,title,body,metadata,source_updated_at,published)
 select 'Property',p.id,p.name,p.description,jsonb_build_object('code',p.code),greatest(p.updated_at,j.updated_at),p.publication='Published' and not j.archived and (s.id is null or not s.archived)
 from public.property_products p join public.property_projects j on j.id=p.project_id left join public.property_subdivisions s on s.id=p.subdivision_id
 on conflict(source_type,source_id) do update set title=excluded.title,body=excluded.body,metadata=excluded.metadata,source_updated_at=excluded.source_updated_at,published=excluded.published;
 return query select d.id from public.kb_documents d where p_all or d.content_hash is null or d.source_updated_at>d.updated_at
   or exists(select 1 from public.kb_chunks c where c.document_id=d.id and c.embed_model is distinct from p_embed_model);
end$$;

create or replace function public.pose_system_kb_sweep(p_all boolean default false,p_embed_model text default null) returns table(document_id uuid)
language sql security invoker set search_path='' as $$select * from pose_private.kb_sync_documents(p_all,p_embed_model)$$;

create or replace function pose_private.kb_source(p_document uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501';end if;
 select case when d.source_type='Property' then jsonb_build_object(
  'document_id',d.id,'source_type',d.source_type,'source_id',d.source_id,'published',d.published,'source_updated_at',d.source_updated_at,
  'content_hash',d.content_hash,'embed_model',(select c.embed_model from public.kb_chunks c where c.document_id=d.id limit 1),
  'code',p.code,'name',p.name,'location',p.location,'property_type',p.property_type,'transaction_type',p.transaction_type,
  'description',p.description,'project_name',p.project_name,'amenities',p.amenities)
 else jsonb_build_object('document_id',d.id,'source_type',d.source_type,'source_id',d.source_id,'published',d.published,'source_updated_at',d.source_updated_at,
  'content_hash',d.content_hash,'embed_model',(select c.embed_model from public.kb_chunks c where c.document_id=d.id limit 1),'question',d.title,'answer',d.body) end into result
 from public.kb_documents d left join public.property_public_catalog p on d.source_type='Property' and p.id=d.source_id where d.id=p_document;
 return result;
end$$;
create or replace function public.pose_system_kb_source(p_document uuid) returns jsonb language sql security invoker set search_path='' as $$select pose_private.kb_source(p_document)$$;

create or replace function pose_private.kb_store_chunks(p_document uuid,p_hash text,p_source_updated_at timestamptz,p_embed_model text,p_chunks jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501';end if;
 if p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_chunks)<>'array' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 perform 1 from public.kb_documents where id=p_document for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 delete from public.kb_chunks where document_id=p_document;
 insert into public.kb_chunks(document_id,chunk_index,header,content,embedding,embed_model)
 select p_document,(v->>'chunk_index')::integer,v->>'header',v->>'content',case when v->'embedding' is null or v->'embedding'='null'::jsonb then null else (v->'embedding')::text::extensions.vector end,
   case when v->'embedding' is null or v->'embedding'='null'::jsonb then null else p_embed_model end from jsonb_array_elements(p_chunks)v;
 get diagnostics n=row_count;
 update public.kb_documents set content_hash=p_hash,source_updated_at=p_source_updated_at,updated_at=now() where id=p_document;
 return n;
end$$;
create or replace function public.pose_system_kb_store_chunks(p_document uuid,p_hash text,p_source_updated_at timestamptz,p_embed_model text,p_chunks jsonb) returns integer language sql security invoker set search_path='' as $$select pose_private.kb_store_chunks(p_document,p_hash,p_source_updated_at,p_embed_model,p_chunks)$$;
create or replace function public.pose_system_kb_remove_chunks(p_document uuid) returns integer language plpgsql security definer set search_path='' as $$declare n integer;begin if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501';end if;delete from public.kb_chunks where document_id=p_document;get diagnostics n=row_count;update public.kb_documents set content_hash=null,updated_at=now() where id=p_document;return n;end$$;

create or replace function pose_private.kb_query_text(p_query text) returns text language sql immutable as $$select nullif(string_agg(token,' '),'') from regexp_split_to_table(lower(pose_private.kb_unaccent(coalesce(p_query,''))),E'\\s+') token where length(token)>1 and token not in ('co','can','nha','gia','la','o','va','khong','toi','minh','nao','bao','nhieu','muon','tim','cua','voi','tu','den','mot','nhung','dang');$$;

create or replace function pose_private.kb_search(p_query text,p_embedding extensions.vector(1024),p_embed_model text,p_filters jsonb default '{}',p_context uuid[] default '{}')
returns table(chunk_id uuid,document_id uuid,source_id uuid,source_type text,header text,content text,vector_rank bigint,text_rank bigint,similarity double precision,code text,name text,price numeric,availability text,updated_at timestamptz,location text,property_type text,transaction_type text,price_period text)
language sql stable security definer set search_path='' as $$
with eligible as(
 select c.*,d.source_id,d.source_type,p.code,p.name,p.price,p.availability,p.updated_at,p.location,p.property_type,p.transaction_type,p.price_period
 from public.kb_chunks c join public.kb_documents d on d.id=c.document_id left join public.property_public_catalog p on d.source_type='Property' and p.id=d.source_id
 where d.published and (d.source_type='Faq' or p.id is not null)
 and (cardinality(p_context)=0 or d.source_type='Faq' or d.source_id=any(p_context))
 and (not(p_filters?'transaction_type') or d.source_type='Faq' or p.transaction_type=p_filters->>'transaction_type')
 and (not(p_filters?'type') or d.source_type='Faq' or p.property_type=p_filters->>'type')
 and (not(p_filters?'types') or d.source_type='Faq' or p.property_type=any(array(select jsonb_array_elements_text(p_filters->'types'))))
 and (not(p_filters?'minPrice') or d.source_type='Faq' or p.price>=(p_filters->>'minPrice')::numeric)
 and (not(p_filters?'maxPrice') or d.source_type='Faq' or case when p_filters->>'maxPriceExclusive'='true' then p.price<(p_filters->>'maxPrice')::numeric else p.price<=(p_filters->>'maxPrice')::numeric end)
 and (not(p_filters?'location') or d.source_type='Faq' or strpos(lower(p.location),lower(p_filters->>'location'))>0 or exists(select 1 from jsonb_array_elements_text(coalesce(p_filters->'location_aliases','[]'::jsonb)) wanted where strpos(pose_private.kb_unaccent(lower(coalesce(p.location,''))),pose_private.kb_unaccent(lower(wanted)))>0))
),v as(select e.id,row_number()over(order by e.embedding operator(extensions.<=>) p_embedding)r,1-(e.embedding operator(extensions.<=>) p_embedding)s from eligible e where p_embedding is not null and e.embedding is not null and e.embed_model=p_embed_model order by e.embedding operator(extensions.<=>) p_embedding limit 20),
t as(select e.id,row_number()over(order by ts_rank_cd(e.tsv,websearch_to_tsquery('simple',pose_private.kb_query_text(p_query)))desc)e_rank from eligible e where pose_private.kb_query_text(p_query) is not null and e.tsv@@websearch_to_tsquery('simple',pose_private.kb_query_text(p_query)) order by ts_rank_cd(e.tsv,websearch_to_tsquery('simple',pose_private.kb_query_text(p_query)))desc limit 20)
select e.id,e.document_id,e.source_id,e.source_type,e.header,e.content,v.r,t.e_rank,v.s,e.code,e.name,e.price,e.availability,e.updated_at,e.location,e.property_type,e.transaction_type,e.price_period
from eligible e left join v on v.id=e.id left join t on t.id=e.id where v.id is not null or t.id is not null;
$$;
create or replace function public.pose_search_knowledge(p_query text,p_embedding extensions.vector(1024) default null,p_embed_model text default null,p_filters jsonb default '{}',p_context uuid[] default '{}')
returns table(chunk_id uuid,document_id uuid,source_id uuid,source_type text,header text,content text,vector_rank bigint,text_rank bigint,similarity double precision,code text,name text,price numeric,availability text,updated_at timestamptz,location text,property_type text,transaction_type text,price_period text)
language sql security invoker set search_path='' as $$select * from pose_private.kb_search(p_query,p_embedding,p_embed_model,p_filters,p_context)$$;
create or replace function public.pose_system_search_knowledge(p_query text,p_embedding extensions.vector(1024) default null,p_embed_model text default null,p_filters jsonb default '{}',p_context uuid[] default '{}')
returns table(chunk_id uuid,document_id uuid,source_id uuid,source_type text,header text,content text,vector_rank bigint,text_rank bigint,similarity double precision,code text,name text,price numeric,availability text,updated_at timestamptz,location text,property_type text,transaction_type text,price_period text)
language sql security invoker set search_path='' as $$select * from pose_private.kb_search(p_query,p_embedding,p_embed_model,p_filters,p_context)$$;

revoke all on function pose_private.kb_sync_documents(boolean,text),pose_private.kb_source(uuid),pose_private.kb_store_chunks(uuid,text,timestamptz,text,jsonb),pose_private.kb_search(text,vector,text,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.pose_system_kb_sweep(boolean,text),public.pose_system_kb_source(uuid),public.pose_system_kb_store_chunks(uuid,text,timestamptz,text,jsonb),public.pose_system_kb_remove_chunks(uuid),public.pose_system_search_knowledge(text,vector,text,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.pose_system_kb_sweep(boolean,text),public.pose_system_kb_source(uuid),public.pose_system_kb_store_chunks(uuid,text,timestamptz,text,jsonb),public.pose_system_kb_remove_chunks(uuid),public.pose_system_search_knowledge(text,vector,text,jsonb,uuid[]) to service_role;
grant execute on function pose_private.kb_sync_documents(boolean,text),pose_private.kb_source(uuid),pose_private.kb_store_chunks(uuid,text,timestamptz,text,jsonb) to service_role;
grant execute on function pose_private.kb_search(text,vector,text,jsonb,uuid[]),public.pose_search_knowledge(text,vector,text,jsonb,uuid[]) to anon,authenticated,service_role;
commit;
