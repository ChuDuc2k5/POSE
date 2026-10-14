-- PostgreSQL search, public scope and snapshot fixtures roll back.
begin;
insert into public.property_projects(id,code,name,location) values
('fa100000-0000-4000-8000-000000000001','FX-SF-PROJECT','Dự án thử nghiệm','Hồ Chí Minh');
insert into public.property_products(project_id,code,name,location,description,property_type,area,bedrooms,price,publication,availability,transaction_type,price_period)
values
('fa100000-0000-4000-8000-000000000001','FX-SF-SALE','Căn hộ bán','Quận 7','Mô tả công khai đủ dài để kiểm thử.','Apartment',85,2,3200000000,'Published','Available','Sale','Total'),
('fa100000-0000-4000-8000-000000000001','FX-SF-RENT','Căn hộ thuê','Quận 7','Mô tả công khai đủ dài để kiểm thử.','Apartment',90,3,25000000,'Published','Available','Rent','Month'),
('fa100000-0000-4000-8000-000000000001','FX-SF-HIDDEN','Nhà nội bộ','Quận 7','Mô tả nội bộ đủ dài để kiểm thử.','House',100,4,5000000,'Hidden','Available','Rent','Month'),
('fa100000-0000-4000-8000-000000000001','FX-SF-NULL','Giá liên hệ','Quận 7','Mô tả công khai đủ dài để kiểm thử.','House',100,4,null,'Published','Sold','Rent','Month');
set local role anon;
do $$
declare r jsonb; s uuid; bad jsonb;
begin
  r:=public.pose_search_properties('{"q":"FX-SF","transaction":"Sale"}',1,12);
  if r->>'total'<>'1' or r->'items'->0->>'transaction_type'<>'Sale' or r->'items'->0->>'price_period'<>'Total' then raise exception 'SALE_FILTER'; end if;
  r:=public.pose_search_properties('{"q":"FX-SF","transaction":"Rent"}',1,12);s:=(r->>'snapshot')::uuid;
  if r->>'total'<>'2' or exists(select 1 from jsonb_array_elements(r->'items') x where x->>'transaction_type'<>'Rent' or x->>'price_period'<>'Month') then raise exception 'RENT_FILTER'; end if;
  if (select price_period from public.property_public_catalog where code='FX-SF-RENT')<>'Month' then raise exception 'DETAIL_PERIOD'; end if;
  if exists(select 1 from public.property_public_catalog where code='FX-SF-HIDDEN') then raise exception 'HIDDEN_EXPOSED'; end if;
  r:=public.pose_search_properties('{"q":"FX-SF"}',1,12);if r->>'total'<>'3' then raise exception 'ALL_TRANSACTIONS'; end if;
  r:=public.pose_search_properties('{"q":"Quận 7","project":"fa100000-0000-4000-8000-000000000001","transaction":"Sale"}',1,12);if r->>'total'<>'1' then raise exception 'KEYWORD_LOCATION'; end if;
  r:=public.pose_search_properties('{"q":"FX-SF","transaction":"Rent","minPrice":10000000,"maxPrice":30000000,"minArea":80,"maxArea":100,"bedrooms":2,"type":"Apartment","availability":"Available"}',1,12);
  if r->>'total'<>'1' or r->'items'->0->>'code'<>'FX-SF-RENT' then raise exception 'COMBINED_FILTER'; end if;
  r:=public.pose_search_properties('{"q":"FX-SF","transaction":"Rent","bedrooms":3}',1,12);if r->>'total'<>'2' then raise exception 'BEDROOM_MINIMUM'; end if;
  r:=public.pose_search_properties('{"q":"FX-SF","transaction":"Rent","minPrice":0}',1,12);if r->>'total'<>'1' then raise exception 'NULL_PRICE'; end if;
  r:=public.pose_search_properties('{"q":"FX-SF","transaction":"Rent"}',1,1,s);if r->>'total'<>'2' then raise exception 'SNAPSHOT_REUSE'; end if;
  begin perform public.pose_search_properties('{"q":"FX-SF","transaction":"Sale"}',1,1,s);raise exception 'TRANSACTION_SNAPSHOT_REUSED';exception when serialization_failure then null;end;
  foreach bad in array array['{"transaction":"Lease"}'::jsonb,'{"transaction":"sale"}','{"transaction":null}','{"transaction":1}','{"transaction":["Rent"]}','{"unknown":"Rent"}'] loop
    begin perform public.pose_search_properties(bad,1,12);raise exception 'INVALID_TRANSACTION_ACCEPTED';exception when invalid_parameter_value then null;end;
  end loop;
  begin select * from pose_private.property_search_snapshots;raise exception 'SNAPSHOT_EXPOSED';exception when insufficient_privilege then null;end;
  perform set_config('search_filters.snapshot',s::text,true);
end $$;
reset role;
update public.property_products set publication='Hidden',version=version+1 where code='FX-SF-RENT';
set local role anon;
do $$begin
  begin perform public.pose_search_properties('{"q":"FX-SF","transaction":"Rent"}',1,12,current_setting('search_filters.snapshot')::uuid);raise exception 'CHANGED_SNAPSHOT_ACCEPTED';exception when serialization_failure then null;end;
end $$;
set local role authenticated;
do $$declare r jsonb;begin
  r:=public.pose_search_properties('{"q":"FX-SF","transaction":"Rent"}',1,12);if r->>'total'<>'1' then raise exception 'AUTHENTICATED_SCOPE';end if;
end $$;
rollback;
select 'PASS: 20 search filter PostgreSQL checks; fixtures rolled back.' as result;
