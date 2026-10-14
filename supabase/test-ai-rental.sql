begin;
do $$
declare project uuid; product uuid;
begin
 insert into public.property_projects(code,name,location) values('M06-RENTAL','TERAVA rental fixture','Quận 7') returning id into project;
 insert into public.property_products(project_id,code,name,location,description,property_type,area,bedrooms,price,publication,availability,transaction_type,price_period)
 values(project,'Q7-R01','Căn hộ 2 phòng ngủ','Quận 7','Căn hộ kiểm thử giá thuê hàng tháng.','Apartment',80,2,25000000,'Published','Available','Rent','Month') returning id into product;
 if not exists(select 1 from public.property_public_catalog where id=product and transaction_type='Rent' and price_period='Month' and price=25000000) then raise exception 'RENTAL_EVIDENCE_MISSING'; end if;
 begin
  update public.property_products set price_period='Total' where id=product;
  raise exception 'MONTHLY_RENT_ACCEPTED_AS_TOTAL';
 exception when check_violation then null; end;
 begin
  update public.property_products set transaction_type='Sale' where id=product;
  raise exception 'SALE_ACCEPTED_AS_MONTHLY';
 exception when check_violation then null; end;
 update public.property_products set publication='Hidden' where id=product;
 if exists(select 1 from public.property_public_catalog where id=product) then raise exception 'HIDDEN_RENTAL_EXPOSED'; end if;
end $$;
rollback;
select 'PASS: M06 rental SQL evidence, monthly/total constraints and Published-only retrieval. Fixtures rolled back.' as result;
