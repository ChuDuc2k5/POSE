begin;

alter table public.property_inquiries drop constraint if exists property_inquiries_source_check;
alter table public.property_inquiries add constraint property_inquiries_source_check
  check (source = any (array['CustomerWeb','GuestWeb','AIBooking']));
alter table public.property_inquiries drop constraint if exists inquiry_guest_source;
alter table public.property_inquiries add constraint inquiry_guest_source
  check (source = 'AIBooking' or ((source='GuestWeb') = (user_id is null)));

create or replace function pose_private.admin_inquiries(p_page integer,p_unread boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; n integer; unread integer;
begin
  perform pose_private.require_account();
  if not pose_private.catalog_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_page is null or p_page not between 1 and 10000 or p_unread is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  select count(*) into unread from public.property_inquiry_notifications where read_at is null;
  select count(*) into n from public.property_inquiry_notifications where not p_unread or read_at is null;
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id),'[]'::jsonb) into items from (
    select i.id,i.property_id,case when i.source='AIBooking' then 'Đặt lịch AI · '||coalesce(i.property_name,'Tư vấn theo nhu cầu') else i.property_name end as property_name,i.name,i.phone,i.email,i.channel,i.preferred_time,i.message,i.status,i.phone_verified,i.consent,i.source,i.created_at,n.read_at
    from public.property_inquiries i join public.property_inquiry_notifications n on n.inquiry_id=i.id
    where not p_unread or n.read_at is null order by i.created_at desc,i.id limit 12 offset (p_page-1)*12
  ) x;
  return jsonb_build_object('items',items,'total',n,'unread',unread,'page',p_page,'pageSize',12);
end $$;

revoke all on function pose_private.admin_inquiries(integer,boolean) from public,anon;
grant execute on function pose_private.admin_inquiries(integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
