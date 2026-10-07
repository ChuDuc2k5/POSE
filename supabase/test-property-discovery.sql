-- Real PostgreSQL/RLS tests. All fixtures and state changes roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('fd100000-0000-4000-8000-000000000001','authenticated','authenticated','m03-one@example.test',now(),'{"role":"User"}','{"display_name":"Khách hàng một","role":"Admin"}',now(),now()),
('fd100000-0000-4000-8000-000000000002','authenticated','authenticated','m03-two@example.test',now(),'{"role":"User"}','{"display_name":"Khách hàng hai"}',now(),now()),
('fd100000-0000-4000-8000-000000000003','authenticated','authenticated','m03-three@example.test',now(),'{"role":"User"}','{"display_name":"Khách hàng ba"}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
select ('fd200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fd100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now() from generate_series(1,3) n;
insert into public.property_projects(id,code,name,location,amenities,archived)
values('fd300000-0000-4000-8000-000000000001','FX-M03-PROJECT','Dự án kiểm thử M03','Thành phố Hồ Chí Minh','Công viên',false),
('fd300000-0000-4000-8000-000000000002','FX-M03-ARCHIVED','Dự án lưu trữ','Hồ Chí Minh','',true);
insert into public.property_subdivisions(id,project_id,code,name,location,archived)
values('fd400000-0000-4000-8000-000000000001','fd300000-0000-4000-8000-000000000001','FX-M03-SUB','Phân khu ẩn','Hồ Chí Minh',true);
insert into public.property_products(id,project_id,code,name,location,description,property_type,area,bedrooms,price,publication,availability)
values
('fd500000-0000-4000-8000-000000000001','fd300000-0000-4000-8000-000000000001','FX-M03-KNOWN','Căn hộ M03','Quận 7, Hồ Chí Minh','Mô tả sản phẩm công khai dùng để kiểm thử.','Apartment',82.5,2,3200000000,'Published','Available'),
('fd500000-0000-4000-8000-000000000002','fd300000-0000-4000-8000-000000000001','FX-M03-UNKNOWN','Giá liên hệ','Quận 7, Hồ Chí Minh','Sản phẩm chưa công bố giá, liên hệ để được tư vấn.','Apartment',80,2,null,'Published','Available'),
('fd500000-0000-4000-8000-000000000003','fd300000-0000-4000-8000-000000000001','FX-M03-SOLD','Sản phẩm đã bán','Hà Nội','Sản phẩm công khai nhưng đã bán theo trạng thái quản lý.','House',100,3,2000000000,'Published','Sold'),
('fd500000-0000-4000-8000-000000000004','fd300000-0000-4000-8000-000000000001','FX-M03-HIDDEN','Sản phẩm nội bộ','Quận 7','Nội dung không được công khai tới khách hàng.','Apartment',85,2,3000000000,'Hidden','Available'),
('fd500000-0000-4000-8000-000000000005','fd300000-0000-4000-8000-000000000002','FX-M03-PARENT-HIDDEN','Dự án đã lưu trữ','Quận 7','Sản phẩm thuộc dự án đã được lưu trữ.','Apartment',85,2,3000000000,'Published','Available'),
('fd500000-0000-4000-8000-000000000006','fd300000-0000-4000-8000-000000000001','FX-M03-SUB-HIDDEN','Phân khu đã lưu trữ','Quận 7','Sản phẩm thuộc phân khu đã được lưu trữ.','Apartment',85,2,3000000000,'Published','Available'),
('fd500000-0000-4000-8000-000000000007','fd300000-0000-4000-8000-000000000001','FX-M03-VILLA','Biệt thự M03','Đà Nẵng','Biệt thự đang được giữ chỗ dùng để kiểm thử.','Villa',150,4,2500000000,'Published','Reserved');
update public.property_products set subdivision_id='fd400000-0000-4000-8000-000000000001' where code='FX-M03-SUB-HIDDEN';
insert into public.property_media(property_id,object_key,name,media_type,mime_type,size_bytes,checksum,visibility)
values('fd500000-0000-4000-8000-000000000001','fd500000-0000-4000-8000-000000000001/fd600000-0000-4000-8000-000000000001.pdf','M03 tài liệu công khai','Document','application/pdf',100,repeat('a',64),'Public'),
('fd500000-0000-4000-8000-000000000001','fd500000-0000-4000-8000-000000000001/fd600000-0000-4000-8000-000000000002.pdf','M03 tài liệu nội bộ','Document','application/pdf',100,repeat('b',64),'Internal');
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$
declare r jsonb; r2 jsonb; seen uuid[]:='{}'; snap uuid; i integer;
begin
  if (select count(*) from public.property_public_catalog where code like 'FX-M03-%')<>4 then raise exception 'PUBLIC_SCOPE_FAILED'; end if;
  if exists(select 1 from public.property_media where name='M03 tài liệu nội bộ') then raise exception 'INTERNAL_DOCUMENT_EXPOSED'; end if;
  r:=public.pose_search_properties('{"q":"FX-M03","project":"fd300000-0000-4000-8000-000000000001","location":"Quận 7","type":"Apartment","minPrice":3000000000,"maxPrice":4000000000,"minArea":80,"maxArea":90,"bedrooms":2,"availability":"Available"}',1,12);
  if r->>'total'<>'1' or r->'items'->0->>'code'<>'FX-M03-KNOWN' then raise exception 'COMBINED_FILTERS_FAILED'; end if;
  r:=public.pose_search_properties('{"q":"FX-M03","sort":"priceAsc"}',1,1); snap:=(r->>'snapshot')::uuid;
  for i in 1..4 loop
    r2:=public.pose_search_properties('{"q":"FX-M03","sort":"priceAsc"}',i,1,snap);
    if (r2->'items'->0->>'id')::uuid=any(seen) then raise exception 'PAGINATION_DUPLICATED'; end if;
    seen:=array_append(seen,(r2->'items'->0->>'id')::uuid);
  end loop;
  if cardinality(seen)<>4 or r2->'items'->0->>'code'<>'FX-M03-UNKNOWN' then raise exception 'NULL_PRICE_ORDER_FAILED'; end if;
  perform set_config('m03.snapshot',snap::text,true);
  r:=public.pose_search_properties('{"q":"FX-M03","minPrice":0,"maxPrice":1000000000000000}',1,50);
  if r->>'total'<>'3' then raise exception 'UNKNOWN_PRICE_TREATED_AS_ZERO'; end if;
  r:=public.pose_search_properties('{"q":"FX-M03-HIDDEN"}',1,12); if r->>'total'<>'0' then raise exception 'DIRECT_HIDDEN_SEARCH'; end if;
  r:=public.pose_search_properties('{"q":"%\"),publication.eq.Hidden"}',1,12); if r->>'total'<>'0' then raise exception 'FILTER_INJECTION'; end if;
  begin perform public.pose_search_properties('{"minPrice":10,"maxPrice":5}',1,12); raise exception 'REVERSED_RANGE_ACCEPTED'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_search_properties('{"publication":"Hidden"}',1,12); raise exception 'UNKNOWN_FILTER_ACCEPTED'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_search_properties('{}',1,51); raise exception 'UNBOUNDED_PAGE'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_search_properties('{"maxPrice":-1}',1,12); raise exception 'NEGATIVE_UPPER_PRICE'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_search_properties('{"q":null}',1,12); raise exception 'NULL_TEXT_FILTER'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_search_properties('{"minPrice":"1"}',1,12); raise exception 'STRING_NUMERIC_FILTER'; exception when invalid_parameter_value then null; end;
  r:=public.pose_search_properties('{"q":"FX-M03","sort":"priceAsc"}',1,1);
  if r->>'snapshot'<>snap::text then raise exception 'IDENTICAL_SNAPSHOT_NOT_REUSED'; end if;
  begin perform public.pose_search_properties('{}',2,1,snap); raise exception 'SNAPSHOT_FILTERS_CHANGED'; exception when serialization_failure then null; end;
  begin select * from pose_private.property_search_snapshots; raise exception 'SNAPSHOT_TABLE_EXPOSED'; exception when insufficient_privilege then null; end;
  begin perform public.pose_set_favorite('fd500000-0000-4000-8000-000000000001',true); raise exception 'GUEST_FAVORITE'; exception when insufficient_privilege then null; end;
  begin perform public.pose_read_inquiries(1,12); raise exception 'GUEST_INQUIRIES'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fd100000-0000-4000-8000-000000000001","session_id":"fd200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare r jsonb; r2 jsonb; input jsonb;
begin
  perform public.pose_read_profile();
  perform public.pose_update_profile('{"phone":"+84912345678"}',0);
  perform public.pose_set_favorite('fd500000-0000-4000-8000-000000000001',true);
  perform public.pose_set_favorite('fd500000-0000-4000-8000-000000000001',true);
  if (select count(*) from public.customer_property_favorites)<>1 then raise exception 'DUPLICATE_FAVORITE'; end if;
  begin perform public.pose_set_favorite('fd500000-0000-4000-8000-000000000004',true); raise exception 'FAVORITE_HIDDEN'; exception when no_data_found then null; end;
  begin insert into public.customer_property_favorites(user_id,property_id) values('fd100000-0000-4000-8000-000000000002','fd500000-0000-4000-8000-000000000001'); raise exception 'DIRECT_FAVORITE_WRITE'; exception when insufficient_privilege then null; end;
  input:='{"property_id":"fd500000-0000-4000-8000-000000000001","name":"Khách hàng một","phone":"+84912345678","country":"VN","channel":"Email","preferred_time":"Buổi chiều","message":"Tôi muốn được tư vấn về căn hộ.","consent":{"contact":true,"call":false,"ai":false,"transcript":false,"recording":false}}';
  r:=public.pose_submit_inquiry(input,'fd700000-0000-4000-8000-000000000001');
  if r->>'status'<>'PendingVerification' or (r->>'phone_verified')::boolean then raise exception 'UNVERIFIED_PHONE_ACCEPTED'; end if;
  perform set_config('m03.inquiry',r->>'id',true);
  r2:=public.pose_submit_inquiry(input,'fd700000-0000-4000-8000-000000000001');
  if r2->>'id'<>r->>'id' or not (r2->>'replayed')::boolean then raise exception 'INQUIRY_NOT_IDEMPOTENT'; end if;
  if (select count(*) from public.property_inquiries)<>1 then raise exception 'DUPLICATE_INQUIRY'; end if;
  if (select jsonb_array_length(consent_evidence) from public.property_inquiries limit 1)<>5 then raise exception 'CONSENT_EVIDENCE_MISSING'; end if;
  begin perform public.pose_submit_inquiry(input||'{"message":"Khác nội dung"}','fd700000-0000-4000-8000-000000000001'); raise exception 'KEY_REUSE_ACCEPTED'; exception when serialization_failure then null; end;
  begin perform public.pose_submit_inquiry(input||'{"channel":"Phone"}',gen_random_uuid()); raise exception 'PHONE_WITHOUT_CONSENT'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_submit_inquiry(input||'{"user_id":"fd100000-0000-4000-8000-000000000002"}',gen_random_uuid()); raise exception 'ACTOR_FORGED'; exception when invalid_parameter_value then null; end;
  begin perform public.pose_submit_inquiry(input||'{"property_id":"fd500000-0000-4000-8000-000000000004"}',gen_random_uuid()); raise exception 'INQUIRY_HIDDEN_PRODUCT'; exception when no_data_found then null; end;
  begin update public.property_inquiries set phone_verified=true; raise exception 'DIRECT_VERIFICATION'; exception when insufficient_privilege then null; end;
  r:=public.pose_confirm_inquiry(current_setting('m03.inquiry')::uuid);
  if r->>'status'<>'PendingVerification' then raise exception 'UNVERIFIED_PROMOTION'; end if;
  r:=public.pose_read_inquiries(1,12);
  if r->'items'->0 ? 'lead_id' or r->'items'->0 ? 'score' or r->'items'->0 ? 'notes' then raise exception 'INTERNAL_LEAD_DATA_EXPOSED'; end if;
end $$;
reset role;
do $$begin if exists(select 1 from public.leads l join public.customers c on c.id=l.customer_id where c.auth_user_id='fd100000-0000-4000-8000-000000000001') then raise exception 'UNVERIFIED_LEAD_CREATED'; end if; end $$;
update auth.users set phone='84912345678',phone_confirmed_at=now() where id='fd100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare r jsonb; input jsonb;
begin
  r:=public.pose_confirm_inquiry(current_setting('m03.inquiry')::uuid);
  if r->>'status'<>'Received' or not (r->>'phone_verified')::boolean or r->>'id'<>current_setting('m03.inquiry') then raise exception 'VERIFIED_PROMOTION_FAILED'; end if;
  perform public.pose_confirm_inquiry(current_setting('m03.inquiry')::uuid);
  select request_payload into input from public.property_inquiries where id=current_setting('m03.inquiry')::uuid;
  perform public.pose_submit_inquiry(input||'{"message":"Nhu cầu bổ sung về tiện ích của sản phẩm."}','fd700000-0000-4000-8000-000000000002');
end $$;
reset role;
do $$
declare cid uuid;
begin
  select id into cid from public.customers where auth_user_id='fd100000-0000-4000-8000-000000000001';
  if (select count(*) from public.leads where customer_id=cid)<>1 then raise exception 'DUPLICATE_OPEN_LEAD'; end if;
  if (select count(*) from public.property_inquiries where user_id='fd100000-0000-4000-8000-000000000001')<>2 then raise exception 'PENDING_INQUIRY_DUPLICATED'; end if;
  if exists(select 1 from public.leads where customer_id=cid and (lead_score is not null or temperature is not null)) then raise exception 'UNSUPPORTED_AUTO_SCORE'; end if;
  update public.leads set notes='Nhu cầu đã được nhân viên xác nhận',status='QUALIFIED' where customer_id=cid;
end $$;
set local role authenticated;
do $$declare input jsonb; begin
  select request_payload into input from public.property_inquiries where id=current_setting('m03.inquiry')::uuid;
  perform public.pose_submit_inquiry(input||'{"message":"Tư vấn bổ sung thứ hai."}','fd700000-0000-4000-8000-000000000003');
end $$;
select set_config('request.jwt.claims','{"sub":"fd100000-0000-4000-8000-000000000002","session_id":"fd200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
  if (public.pose_read_favorites(1,12)->>'total')::integer<>0 or (public.pose_read_inquiries(1,12)->>'total')::integer<>0 then raise exception 'OTHER_CUSTOMER_READ'; end if;
  if exists(select 1 from public.customer_property_favorites) or exists(select 1 from public.property_inquiries) then raise exception 'DIRECT_RLS_FAILED'; end if;
  begin perform public.pose_confirm_inquiry(current_setting('m03.inquiry')::uuid); raise exception 'OTHER_CUSTOMER_CONFIRM'; exception when no_data_found then null; end;
end $$;
reset role;
update public.property_products set publication='Hidden',version=version+1 where id='fd500000-0000-4000-8000-000000000001';
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$begin
  begin perform public.pose_search_properties('{"q":"FX-M03","sort":"priceAsc"}',2,1,current_setting('m03.snapshot')::uuid); raise exception 'CHANGED_SNAPSHOT_ACCEPTED'; exception when serialization_failure then null; end;
  if exists(select 1 from public.property_public_catalog where id='fd500000-0000-4000-8000-000000000001') then raise exception 'HIDDEN_DETAIL_EXPOSED'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fd100000-0000-4000-8000-000000000001","session_id":"fd200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare r jsonb;begin
  r:=public.pose_read_favorites(1,12); if r->'items'->0->'property'<>'null'::jsonb then raise exception 'HIDDEN_FAVORITE_CONTENT_EXPOSED'; end if;
  perform public.pose_set_favorite('fd500000-0000-4000-8000-000000000001',false);
  perform public.pose_set_favorite('fd500000-0000-4000-8000-000000000001',false);
  if (public.pose_read_favorites(1,12)->>'total')::integer<>0 then raise exception 'REMOVE_HIDDEN_FAVORITE_FAILED'; end if;
end $$;
reset role;
do $$begin
  if not exists(select 1 from public.leads l join public.customers c on c.id=l.customer_id where c.auth_user_id='fd100000-0000-4000-8000-000000000001' and l.notes='Nhu cầu đã được nhân viên xác nhận' and l.status='QUALIFIED') then raise exception 'HUMAN_DATA_OVERWRITTEN'; end if;
end $$;
update public.leads l set status='LOST' where l.customer_id in (select c.id from public.customers c where c.auth_user_id='fd100000-0000-4000-8000-000000000001');
set local role authenticated;
do $$declare r jsonb;begin
  r:=public.pose_submit_inquiry('{"property_id":null,"name":"Khách hàng một","phone":"+84912345678","country":"VN","channel":"Email","preferred_time":"","message":"Tôi có nhu cầu mới sau khi hồ sơ trước đã kết thúc.","consent":{"contact":true,"call":false,"ai":false,"transcript":false,"recording":false}}',gen_random_uuid());
  if r->>'status'<>'NeedsReview' then raise exception 'CLOSED_LEAD_AUTO_REOPENED'; end if;
end $$;
reset role;
update auth.users set raw_app_meta_data='{"role":"Sales"}' where id='fd100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin begin perform public.pose_read_favorites(1,12); raise exception 'ROLE_DOWNGRADE_IGNORED'; exception when insufficient_privilege then null; end; end $$;
reset role;
update auth.users set raw_app_meta_data='{"role":"User","account_status":"suspended"}' where id='fd100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin begin perform public.pose_read_inquiries(1,12); raise exception 'SUSPENDED_CUSTOMER_ALLOWED'; exception when insufficient_privilege then null; end; end $$;
reset role;
-- Phone collision with a legacy customer requires manual review; no automatic merge.
insert into public.customers(full_name,phone,source) values('Liên hệ cũ','84988888888','Legacy');
update auth.users set phone='84988888888',phone_confirmed_at=now() where id='fd100000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fd100000-0000-4000-8000-000000000003","session_id":"fd200000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$declare r jsonb; begin
  perform public.pose_read_profile();perform public.pose_update_profile('{"phone":"+84988888888"}',0);
  r:=public.pose_submit_inquiry('{"property_id":null,"name":"Khách hàng ba","phone":"+84988888888","country":"VN","channel":"Email","preferred_time":"","message":"Tôi muốn tư vấn một căn hộ phù hợp.","consent":{"contact":true,"call":false,"ai":false,"transcript":false,"recording":false}}',gen_random_uuid());
  if r->>'status'<>'NeedsReview' then raise exception 'IDENTITY_COLLISION_MERGED'; end if;
end $$;
rollback;
select 'PASS: M03 combined filters, stable snapshot pagination, unknown price, private publication/media, unique favorites, ownership/RLS, consent, idempotency, verification, one open Lead, human data preservation, phone conflicts and current roles. Fixtures rolled back.' as result;
