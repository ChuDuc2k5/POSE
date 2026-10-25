-- Keep existing embeddings when an indexer without an embedding model stores chunks.
-- Several local backends share this database; one started without AI_EMBED_* settings
-- re-indexed every document with empty vectors, which silently broke semantic search.
begin;

create or replace function pose_private.kb_store_chunks(p_document uuid,p_hash text,p_source_updated_at timestamptz,p_embed_model text,p_chunks jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SYSTEM_REQUIRED' using errcode='42501';end if;
 if p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_chunks)<>'array' then raise exception 'INVALID_INPUT' using errcode='22023';end if;
 perform 1 from public.kb_documents where id=p_document for update;if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 -- An indexer that cannot embed must not replace chunks that already carry vectors.
 if not exists(select 1 from jsonb_array_elements(p_chunks) v where v->'embedding' is not null and v->'embedding'<>'null'::jsonb)
    and exists(select 1 from public.kb_chunks where document_id=p_document and embedding is not null) then
   select count(*) into n from public.kb_chunks where document_id=p_document;
   return n;
 end if;
 delete from public.kb_chunks where document_id=p_document;
 insert into public.kb_chunks(document_id,chunk_index,header,content,embedding,embed_model)
 select p_document,(v->>'chunk_index')::integer,v->>'header',v->>'content',case when v->'embedding' is null or v->'embedding'='null'::jsonb then null else (v->'embedding')::text::extensions.vector end,
   case when v->'embedding' is null or v->'embedding'='null'::jsonb then null else p_embed_model end from jsonb_array_elements(p_chunks)v;
 get diagnostics n=row_count;
 update public.kb_documents set content_hash=p_hash,source_updated_at=p_source_updated_at,updated_at=now() where id=p_document;
 return n;
end $$;

commit;
