begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.property_projects(id,code,name,location,description)
values('f9a00000-0000-4000-8000-000000000001','SIM-P','Similar Project','Quận 7','Published project for similarity tests.');
insert into public.property_products(id,project_id,code,name,location,description,property_type,area,bedrooms,price,publication,availability,transaction_type,price_period)
values
 ('f9a00000-0000-4000-8000-000000000001','f9a00000-0000-4000-8000-000000000001','SIM-1','Source home','Phường Tân Phú, Quận 7','A published source property for similarity tests.','Apartment',80,2,100,'Published','Available','Sale','Total'),
 ('f9a00000-0000-4000-8000-000000000002','f9a00000-0000-4000-8000-000000000001','SIM-2','Close home','Phường Tân Phú, Quận 7','A published close property for similarity tests.','Apartment',80,2,110,'Published','Available','Sale','Total'),
 ('f9a00000-0000-4000-8000-000000000003','f9a00000-0000-4000-8000-000000000001','SIM-3','Different home','Phường Tân Phú, Quận 7','A published different property for similarity tests.','Apartment',80,2,120,'Published','Reserved','Sale','Total'),
 ('f9a00000-0000-4000-8000-000000000004','f9a00000-0000-4000-8000-000000000001','SIM-4','Sold close home','Phường Tân Phú, Quận 7','A sold property that must not be suggested.','Apartment',80,2,105,'Published','Sold','Sale','Total');
insert into public.kb_documents(id,source_type,source_id,title,body,published)
select id,'Property',id,code,'Similarity test document',true from public.property_products where code like 'SIM-%';
insert into public.kb_chunks(document_id,chunk_index,header,content,embedding,embed_model)
values
 ('f9a00000-0000-4000-8000-000000000001',0,'SIM-1','source',('['||'1,'||repeat('0,',1022)||'0]')::extensions.vector,'fake'),
 ('f9a00000-0000-4000-8000-000000000002',0,'SIM-2','close',('['||'0.9,0.1,'||repeat('0,',1021)||'0]')::extensions.vector,'fake'),
 ('f9a00000-0000-4000-8000-000000000003',0,'SIM-3','different',('['||'0,1,'||repeat('0,',1021)||'0]')::extensions.vector,'fake'),
 ('f9a00000-0000-4000-8000-000000000004',0,'SIM-4','sold',('['||'0.99,0.01,'||repeat('0,',1021)||'0]')::extensions.vector,'fake');
select public.pose_system_recompute_similar('f9a00000-0000-4000-8000-000000000001','fake');
do $$ begin
  if to_regclass('public.property_similar') is null then raise exception 'property_similar table missing'; end if;
  if not exists(select 1 from pg_proc where proname='pose_similar_properties') then raise exception 'similar RPC missing'; end if;
  if not exists(select 1 from pg_class where relname='property_similar' and relrowsecurity) then raise exception 'similar RLS missing'; end if;
  if (select array_agg(code order by rank)::text from public.property_similar s join public.property_public_catalog p on p.id=s.similar_id where s.property_id='f9a00000-0000-4000-8000-000000000001') <> '{SIM-2,SIM-3}' then raise exception 'similar cosine ordering or availability filter failed'; end if;
  if exists(select 1 from public.pose_similar_properties('f9a00000-0000-4000-8000-000000000001',4) where code='SIM-4') then raise exception 'sold similar property returned'; end if;
end $$;
select 'property_similar checks complete' as result;
rollback;
