-- Real PostgreSQL/RLS checks. Every test row and role change is rolled back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,created_at,updated_at)
values('fb100000-0000-4000-8000-000000000001','authenticated','authenticated','m02-fixture@example.test',now(),'{"role":"Admin"}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('fb200000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fb100000-0000-4000-8000-000000000001","session_id":"fb200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare j jsonb; j2 jsonb; s jsonb; p jsonb; p2 jsonb; m jsonb; base jsonb; v integer;
begin
  j:=public.pose_save_catalog('projects',null,0,'{"code":"FX-M02-A","name":"Dự án kiểm thử","location":"Thành phố Hồ Chí Minh","description":"Dự án thử nghiệm","amenities":"Công viên","archived":false}');
  j2:=public.pose_save_catalog('projects',null,0,'{"code":"FX-M02-B","name":"Dự án khác","location":"Thành phố Hồ Chí Minh","description":"","amenities":"","archived":false}');
  if (j->>'version')::integer<>0 then raise exception 'CREATE_VERSION_FAILED'; end if;
  begin perform public.pose_save_catalog('projects',null,0,'{"code":"FX-M02-A","name":"Trùng mã","location":"Hồ Chí Minh"}'); raise exception 'DUPLICATE_ACCEPTED'; exception when unique_violation then null; end;
  s:=public.pose_save_catalog('subdivisions',null,0,jsonb_build_object('project_id',j->>'id','code','FX-M02-Z','name','Phân khu A','location','Hồ Chí Minh','archived',false));
  begin perform public.pose_save_catalog('subdivisions',null,0,'{"project_id":"fb300000-0000-4000-8000-000000000099","code":"FX-M02-X","name":"Phân khu sai","location":"Hồ Chí Minh"}'); raise exception 'MISSING_PARENT_ACCEPTED'; exception when invalid_parameter_value then null; end;
  base:=jsonb_build_object('project_id',j->>'id','subdivision_id',s->>'id','code','FX-M02-P','name','Căn hộ kiểm thử','location','Hồ Chí Minh','description','Căn hộ có đầy đủ mô tả cho kiểm thử công bố.','property_type','Apartment','area',85,'bedrooms',2,'price',null,'publication','Draft','availability','Available');
  begin perform public.pose_save_catalog('properties',null,0,base||'{"area":-1}'); raise exception 'NEGATIVE_AREA_ACCEPTED'; exception when check_violation then null; end;
  begin perform public.pose_save_catalog('properties',null,0,base||'{"price":0}'); raise exception 'ZERO_PRICE_ACCEPTED'; exception when check_violation then null; end;
  begin perform public.pose_save_catalog('properties',null,0,base||jsonb_build_object('project_id',j2->>'id')); raise exception 'CROSS_PROJECT_SUBDIVISION_ACCEPTED'; exception when invalid_parameter_value then null; end;
  p:=public.pose_save_catalog('properties',null,0,base);
  if p->'price'<>'null'::jsonb then raise exception 'UNKNOWN_PRICE_NOT_NULL'; end if;
  if exists(select 1 from public.property_products where id=(p->>'id')::uuid and price=0) then raise exception 'NULL_TREATED_AS_ZERO'; end if;
  begin perform public.pose_save_catalog('properties',(p->>'id')::uuid,0,'{"publication":"Published","description":"Ngắn"}'); raise exception 'INCOMPLETE_PUBLISHED'; exception when check_violation then null; end;
  p:=public.pose_save_catalog('properties',(p->>'id')::uuid,0,'{"publication":"Published"}');
  begin perform public.pose_save_catalog('properties',(p->>'id')::uuid,0,'{"name":"Ghi đè"}'); raise exception 'STALE_VERSION_ACCEPTED'; exception when serialization_failure then null; end;
  begin perform public.pose_save_catalog('properties',(p->>'id')::uuid,1,'{"publication":"Hidden"}'); raise exception 'HIDDEN_WITHOUT_REASON'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_save_catalog('properties',(p->>'id')::uuid,1,'{"availability":"Sold"}'); raise exception 'SOLD_WITHOUT_REASON'; exception when invalid_parameter_value then null; end;
  p:=public.pose_save_catalog('properties',(p->>'id')::uuid,1,'{"availability":"Sold"}','Cập nhật theo thông tin quản lý');
  if p->>'publication'<>'Published' or p->>'availability'<>'Sold' then raise exception 'STATES_NOT_INDEPENDENT'; end if;
  begin perform public.pose_save_catalog('properties',(p->>'id')::uuid,2,'{"version":100}'); raise exception 'SERVER_FIELD_ACCEPTED'; exception when invalid_parameter_value then null; end;
  perform public.pose_save_catalog('properties',null,0,base||'{"code":"FX-M02-DRAFT"}');
  perform public.pose_save_catalog('properties',null,0,base||'{"code":"FX-M02-HIDDEN","publication":"Hidden"}','Ẩn để kiểm thử');
  perform public.pose_save_catalog('properties',null,0,base||'{"code":"FX-M02-ARCHIVED","publication":"Archived"}','Lưu trữ kiểm thử');
  p2:=public.pose_save_catalog('properties',null,0,base||jsonb_build_object('project_id',j2->>'id','subdivision_id',null,'code','FX-M02-INACTIVE','publication','Published'));
  perform public.pose_save_catalog('projects',(j2->>'id')::uuid,0,'{"archived":true}','Lưu trữ dự án kiểm thử');
  begin perform public.pose_save_catalog('properties',(p2->>'id')::uuid,0,'{"name":"Sửa dưới dự án lưu trữ"}'); raise exception 'ARCHIVED_PARENT_ACCEPTED'; exception when invalid_parameter_value then null; end;
  insert into storage.objects(bucket_id,name) values('property-files',(p->>'id')||'/fb400000-0000-4000-8000-000000000001.webp');
  m:=public.pose_save_catalog('media',null,2,jsonb_build_object('property_id',p->>'id','object_key',(p->>'id')||'/fb400000-0000-4000-8000-000000000001.webp','name','Ảnh công khai','media_type','Image','mime_type','image/webp','size_bytes',100,'checksum',repeat('a',64),'visibility','Public','visible',true,'sort_order',0));
  select version into v from public.property_products where id=(p->>'id')::uuid;
  if v<>3 then raise exception 'MEDIA_DID_NOT_ADVANCE_PRODUCT_VERSION'; end if;
  begin delete from storage.objects where bucket_id='property-files' and name=(p->>'id')||'/fb400000-0000-4000-8000-000000000001.webp'; exception when insufficient_privilege then null; end;
  if not exists(select 1 from storage.objects where bucket_id='property-files' and name=(p->>'id')||'/fb400000-0000-4000-8000-000000000001.webp') then raise exception 'LINKED_FILE_DELETE_ALLOWED'; end if;
  begin perform public.pose_save_catalog('media',null,2,jsonb_build_object('property_id',p->>'id')); raise exception 'STALE_UPLOAD_ACCEPTED'; exception when serialization_failure then null; end;
  insert into storage.objects(bucket_id,name) values('property-files',(p->>'id')||'/fb400000-0000-4000-8000-000000000002.pdf');
  perform public.pose_save_catalog('media',null,3,jsonb_build_object('property_id',p->>'id','object_key',(p->>'id')||'/fb400000-0000-4000-8000-000000000002.pdf','name','Tài liệu nội bộ','media_type','Document','mime_type','application/pdf','size_bytes',200,'checksum',repeat('b',64),'visibility','Internal','visible',true,'sort_order',1));
  m:=public.pose_save_catalog('media',(m->>'id')::uuid,0,'{"sort_order":5,"visible":false}');
  if (m->>'sort_order')::integer<>5 or (m->>'visible')::boolean then raise exception 'MEDIA_ORDER_VISIBILITY_FAILED'; end if;
  begin perform public.pose_save_catalog('media',(m->>'id')::uuid,0,'{"visible":true}'); raise exception 'STALE_MEDIA_ACCEPTED'; exception when serialization_failure then null; end;
  m:=public.pose_save_catalog('media',(m->>'id')::uuid,1,'{"visible":true,"removed":true}');
  if (m->>'visible')::boolean or not (m->>'removed')::boolean then raise exception 'UNLINK_NOT_HIDDEN'; end if;
  perform public.pose_save_catalog('media',(m->>'id')::uuid,2,'{"visible":true,"removed":false}');
  if not exists(select 1 from public.property_history where entity_id=(p->>'id')::uuid and reason='Cập nhật theo thông tin quản lý' and actor_id='fb100000-0000-4000-8000-000000000001') then raise exception 'AUDIT_MISSING'; end if;
  begin update public.property_products set name='Bypass' where id=(p->>'id')::uuid; raise exception 'DIRECT_WRITE_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update auth.users set raw_app_meta_data='{"role":"Sales"}' where id='fb100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  if exists(select 1 from public.property_products where code='FX-M02-DRAFT') then raise exception 'SALES_READ_DRAFT'; end if;
  if exists(select 1 from public.property_history where actor_id='fb100000-0000-4000-8000-000000000001') then raise exception 'SALES_READ_AUDIT'; end if;
  if exists(select 1 from storage.objects where bucket_id='property-files') then raise exception 'SALES_CAN_SIGN_FILES_DIRECTLY'; end if;
  begin perform public.pose_save_catalog('projects',null,0,'{"code":"FX-M02-FORGE","name":"Giả mạo","location":"Hồ Chí Minh"}'); raise exception 'ROLE_DOWNGRADE_IGNORED'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$
begin
  if (select count(*) from public.property_products where code like 'FX-M02-%')<>1 then raise exception 'GUEST_PUBLICATION_SCOPE_FAILED'; end if;
  if not exists(select 1 from public.property_products where code='FX-M02-P' and availability='Sold') then raise exception 'SOLD_STATUS_NOT_PRESERVED'; end if;
  if exists(select 1 from public.property_media where visibility='Internal' and name='Tài liệu nội bộ') then raise exception 'INTERNAL_FILE_EXPOSED'; end if;
  if (select count(*) from public.property_media where name='Ảnh công khai')<>1 then raise exception 'PUBLIC_MEDIA_NOT_VISIBLE'; end if;
  if exists(select 1 from storage.objects where bucket_id='property-files') then raise exception 'GUEST_CAN_SIGN_FILES_DIRECTLY'; end if;
  begin select * from public.property_history; raise exception 'GUEST_READ_AUDIT'; exception when insufficient_privilege then null; end;
  begin perform public.pose_save_catalog('projects',null,0,'{}'); raise exception 'GUEST_WRITE_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: M02 creation, uniqueness, parent scope, numeric validation, publication completeness, optimistic locking, independent availability, audit, media version/order/unlink, current roles and Guest RLS. Fixtures rolled back.' as result;
