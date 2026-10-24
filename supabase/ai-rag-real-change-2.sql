-- Apply after ai-rag-real-change-1.sql. This is intentionally not applied by the evaluator.
-- It widens both retrieval legs and makes post-2025 ward/district aliases searchable.
begin;
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
 and (not(p_filters?'minPrice') or d.source_type='Faq' or p.price>=(p_filters->>'minPrice')::numeric)
 and (not(p_filters?'maxPrice') or d.source_type='Faq' or p.price<=(p_filters->>'maxPrice')::numeric)
 and (not(p_filters?'location') or d.source_type='Faq' or strpos(pose_private.kb_unaccent(lower(coalesce(p.location,''))),pose_private.kb_unaccent(lower(p_filters->>'location')))>0 or strpos(pose_private.kb_unaccent(lower(c.header)),pose_private.kb_unaccent(lower(p_filters->>'location')))>0)
),v as(
 select e.id,row_number()over(order by (e.embedding operator(extensions.<=>) p_embedding)-case when e.source_id=any(p_context) then 0.02 else 0 end)e_rank,1-(e.embedding operator(extensions.<=>) p_embedding)s
 from eligible e where p_embedding is not null and e.embedding is not null and e.embed_model=p_embed_model
 order by (e.embedding operator(extensions.<=>) p_embedding)-case when e.source_id=any(p_context) then 0.02 else 0 end limit 40
),t as(
 select e.id,row_number()over(order by ts_rank_cd(e.tsv,websearch_to_tsquery('simple',pose_private.kb_query_text(p_query)))desc,case when e.source_id=any(p_context) then 0 else 1 end)e_rank
 from eligible e where pose_private.kb_query_text(p_query) is not null and e.tsv@@websearch_to_tsquery('simple',pose_private.kb_query_text(p_query))
 order by ts_rank_cd(e.tsv,websearch_to_tsquery('simple',pose_private.kb_query_text(p_query)))desc,case when e.source_id=any(p_context) then 0 else 1 end limit 40
)
select e.id,e.document_id,e.source_id,e.source_type,e.header,e.content,v.e_rank,t.e_rank,v.s,e.code,e.name,e.price,e.availability,e.updated_at,e.location,e.property_type,e.transaction_type,e.price_period
from eligible e left join v on v.id=e.id left join t on t.id=e.id where v.id is not null or t.id is not null;
$$;
commit;
