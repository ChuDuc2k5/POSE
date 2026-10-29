-- Hotfix 13: keep common legal question words out of full-text noise and add
-- the planning FAQ's short search aliases for "red book in planning" questions.
begin;

create or replace function pose_private.kb_query_text(p_query text) returns text language sql immutable
as $$select nullif(string_agg(token,' '),'') from
regexp_split_to_table(lower(pose_private.kb_unaccent(coalesce(p_query,''))),E'\\s+') token where
length(token)>1 and token not in
('co','can','nha','gia','la','o','va','khong','toi','minh','nao','bao','nhieu','muon','tim','cua','voi','tu','den','mot','nhung','dang','neu','thi','duoc','tren','lai','nam');$$;

update public.kb_documents
set body = body || E'\nAlias: dat so do trong quy hoach; duoc cap giay phep xay dung co thoi han hoac sua chua.'
where source_type='Faq'
  and pose_private.kb_unaccent(title) ilike '%dat nam trong quy hoach%'
  and body not like '%Alias: dat so do trong quy hoach%';

commit;
