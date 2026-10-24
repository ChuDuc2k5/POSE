begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ begin if pose_private.kb_query_text('Căn Nhà  gần CHỢ') <> 'gan cho' then raise exception 'KB_QUERY_TEXT_TOKENIZATION'; end if; end $$;
insert into public.kb_documents(id,source_type,title,body,published) values
('f8a00000-0000-4000-8000-000000000001','Faq','Bản nháp không công bố','Không được trả về',false),
('f8a00000-0000-4000-8000-000000000002','Faq','Câu hỏi đã công bố','Hồ sơ chung cho khách hàng',true);
insert into public.kb_chunks(document_id,chunk_index,header,content,embedding,embed_model) values
('f8a00000-0000-4000-8000-000000000001',0,'Hỏi đáp · Bản nháp không công bố','Không được trả về',('['||'1,'||repeat('0,',1022)||'0]')::vector,'fake'),
('f8a00000-0000-4000-8000-000000000002',0,'Hỏi đáp · Hồ sơ','Hồ sơ chung cho khách hàng',('['||'1,'||repeat('0,',1022)||'0]')::vector,'fake');
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform * from public.kb_chunks; raise exception 'DIRECT_KB_READ'; exception when insufficient_privilege then null; end;
 begin perform * from public.kb_documents; raise exception 'DIRECT_KB_DOCUMENT_READ'; exception when insufficient_privilege then null; end;
 if exists(select 1 from public.pose_search_knowledge('hồ sơ',('['||'1,'||repeat('0,',1022)||'0]')::vector,'fake','{}','{}') where header like '%Bản nháp%') then raise exception 'UNPUBLISHED_FAQ_RETURNED'; end if;
 if not exists(select 1 from public.pose_search_knowledge('hồ sơ',('['||'1,'||repeat('0,',1022)||'0]')::vector,'fake','{}','{}') where header like '%Hồ sơ%') then raise exception 'PUBLISHED_FAQ_MISSING'; end if;
end $$;
rollback;
select 'PASS: M06 knowledge RLS, unpublished FAQ exclusion, cosine vector query and generated full-text index.' as result;
