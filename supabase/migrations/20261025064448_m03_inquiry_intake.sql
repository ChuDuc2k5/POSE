-- M03: accept requests without requiring phone OTP. Unverified contacts stay
-- unverified and are never automatically linked to a customer or callable Lead.
begin;
create table pose_private.m03_browser_sessions (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days'
);
alter table pose_private.m03_browser_sessions enable row level security;
revoke all on pose_private.m03_browser_sessions from public,anon,authenticated,service_role;
create policy browser_sessions_no_direct_access on pose_private.m03_browser_sessions for all to anon,authenticated using(false) with check(false);
alter table public.property_inquiries alter column user_id drop not null;
alter table public.property_inquiries
  add column if not exists guest_session_id uuid,
  add column if not exists source text not null default 'CustomerWeb',
  add column if not exists email_verified_at timestamptz,
  add column browser_session_hash text references pose_private.m03_browser_sessions(token_hash) on delete restrict;
-- Preserve the pre-existing verified-email guest flow, and add a separate,
-- explicitly unverified browser capability without impersonating that flow.
do $$ declare c record;
begin
  for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint
           where conrelid='public.property_inquiries'::regclass and contype='c' loop
    if (c.definition like '%user_id IS NULL%' and c.definition like '%guest_session_id%')
       or (c.definition like '%GuestWeb%' and c.definition like '%guest_session_id%') then
      execute format('alter table public.property_inquiries drop constraint %I',c.conname);
    end if;
  end loop;
end $$;
alter table public.property_inquiries add constraint inquiry_owner_scope
  check(num_nonnulls(user_id,guest_session_id,browser_session_hash)=1);
alter table public.property_inquiries add constraint inquiry_guest_source
  check((source='GuestWeb')=(user_id is null));
create unique index inquiry_browser_request_key_idx on public.property_inquiries(browser_session_hash,request_key) where browser_session_hash is not null;
create index inquiry_browser_created_idx on public.property_inquiries(browser_session_hash,created_at desc,id) where browser_session_hash is not null;
-- Existing requests are accepted for manual follow-up; verification evidence,
-- customer/Lead links and consent remain unchanged.
update public.property_inquiries set status='Received' where status='PendingVerification';

create or replace function pose_private.submit_inquiry(p_data jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=pose_private.require_customer(); a auth.users; existing public.property_inquiries; product public.property_products;
  cid uuid; lid uuid; verified boolean; state text; consent jsonb; evidence jsonb; result public.property_inquiries;
  hash text; pname text; purpose text; v_phone text; profphone text;
begin
  if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object'
    or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(array['property_id','name','phone','country','channel','preferred_time','message','consent']))
    or char_length(btrim(coalesce(p_data->>'name',''))) not between 2 and 80
    or coalesce(p_data->>'phone','') !~ '^\+[1-9][0-9]{7,14}$'
    or coalesce(p_data->>'country','') not in ('VN','International')
    or (p_data->>'country'='VN' and p_data->>'phone' !~ '^\+84[0-9]{9}$')
    or coalesce(p_data->>'channel','') not in ('Email','Phone')
    or char_length(coalesce(p_data->>'preferred_time',''))>200
    or char_length(coalesce(p_data->>'message',''))>3000
    or jsonb_typeof(p_data->'consent') is distinct from 'object'
    or (p_data->'consent'->'contact') is distinct from 'true'::jsonb then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  consent:=p_data->'consent';
  foreach purpose in array array['name','phone','country','channel'] loop
    if jsonb_typeof(p_data->purpose) is distinct from 'string' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  foreach purpose in array array['preferred_time','message'] loop
    if p_data ? purpose and jsonb_typeof(p_data->purpose) is distinct from 'string' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(consent) k where not k=any(array['contact','call','ai','transcript','recording'])) then raise exception 'INVALID_CONSENT' using errcode='22023'; end if;
  foreach purpose in array array['contact','call','ai','transcript','recording'] loop
    if jsonb_typeof(consent->purpose) is distinct from 'boolean' then raise exception 'INVALID_CONSENT' using errcode='22023'; end if;
  end loop;
  if p_data->>'channel'='Phone' and not (consent->>'call')::boolean then raise exception 'CALL_CONSENT_REQUIRED' using errcode='22023'; end if;
  hash:=md5(p_data::text);
  -- Serialize this customer's submissions and verified identity matching atomically.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,3));
  select * into a from auth.users where id=uid;
  select contact_phone into profphone from public.account_profiles where user_id=uid;
  v_phone:=p_data->>'phone';
  verified:=coalesce(a.phone_confirmed_at is not null and ltrim(a.phone,'+')=ltrim(v_phone,'+') and profphone=v_phone,false);
  select * into existing from public.property_inquiries where user_id=uid and request_key=p_key;
  if found then
    if existing.payload_fingerprint<>hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    if existing.status<>'PendingVerification' or not verified then
      return jsonb_build_object('id',existing.id,'status',existing.status,'phone_verified',existing.phone_verified,'created_at',existing.created_at,'replayed',true);
    end if;
  end if;
  if existing.id is null and (select count(*) from public.property_inquiries where user_id=uid and created_at>now()-interval '1 hour')>=10 then raise exception 'INQUIRY_LIMIT' using errcode='53300'; end if;
  if p_data->>'property_id' is not null then
    select * into product from public.property_products p where p.id=(p_data->>'property_id')::uuid
      and exists(select 1 from public.property_public_catalog x where x.id=p.id);
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    pname:=product.name;
  elsif char_length(btrim(coalesce(p_data->>'message','')))<10 then raise exception 'NEEDS_REQUIRED' using errcode='22023'; end if;
  state:='Received'; -- Phone verification is optional for intake, never fabricated.
  if verified then
    perform pg_advisory_xact_lock(hashtextextended(v_phone,3));
    select c.id into cid from public.customers c where c.phone=v_phone and c.auth_user_id=uid for update;
    if cid is null and exists(select 1 from public.customers c where ltrim(c.phone,'+')=ltrim(v_phone,'+') or c.auth_user_id=uid
      or (p_data->>'country'='VN' and c.phone='0'||substring(v_phone from 4))) then
      state:='NeedsReview';
    else
      if cid is null then insert into public.customers(full_name,phone,email,source,auth_user_id,phone_verified_at)
        values(btrim(p_data->>'name'),v_phone,a.email,'Web',uid,a.phone_confirmed_at) returning id into cid; end if;
      select l.id into lid from public.leads l where l.customer_id=cid and l.status not in ('CONVERTED','LOST') for update;
      if lid is null and exists(select 1 from public.leads l where l.customer_id=cid) then state:='NeedsReview';
      elsif lid is null then insert into public.leads(customer_id) values(cid) returning id into lid; end if;
    end if;
  end if;
  select jsonb_agg(jsonb_build_object('purpose',x.key,'channel',p_data->>'channel','status',case when x.value='true'::jsonb then 'Granted' else 'Declined' end,
    'source','CustomerWeb','recorded_at',now(),'version','2026-10-05','user_id',uid)) into evidence from jsonb_each(consent) x;
  if existing.id is not null then
    update public.property_inquiries set customer_id=cid,lead_id=lid,status=state,phone_verified=verified where id=existing.id returning * into result;
  else
    insert into public.property_inquiries(user_id,property_id,property_name,customer_id,lead_id,name,phone,email,country,channel,preferred_time,message,status,phone_verified,consent,consent_evidence,request_key,payload_fingerprint,request_payload)
    values(uid,product.id,pname,cid,lid,btrim(p_data->>'name'),v_phone,a.email,p_data->>'country',p_data->>'channel',coalesce(p_data->>'preferred_time',''),coalesce(p_data->>'message',''),state,verified,consent,evidence,p_key,hash,p_data)
    returning * into result;
  end if;
  return jsonb_build_object('id',result.id,'status',result.status,'phone_verified',result.phone_verified,'created_at',result.created_at,'replayed',false);
end $$;

create function pose_private.submit_browser_inquiry(p_data jsonb,p_key uuid,p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.property_inquiries; result public.property_inquiries; product public.property_products;
  evidence jsonb; purpose text; session_expiry timestamptz; email text;
begin
  if p_key is null or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_data) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(array['property_id','name','phone','country','channel','preferred_time','message','consent','email'])) then
    raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  foreach purpose in array array['name','phone','country','channel','preferred_time','message','email'] loop
    if jsonb_typeof(p_data->purpose) is distinct from 'string' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  email:=lower(btrim(p_data->>'email'));
  if char_length(btrim(p_data->>'name')) not between 2 and 80
     or p_data->>'phone' !~ '^\+[1-9][0-9]{7,14}$'
     or p_data->>'country' not in ('VN','International')
     or (p_data->>'country'='VN' and p_data->>'phone' !~ '^\+84[0-9]{9}$')
     or p_data->>'channel' not in ('Email','Phone')
     or char_length(p_data->>'preferred_time')>200 or char_length(p_data->>'message')>3000
     or char_length(email)>254 or (p_data->>'channel'='Email' and email='')
     or (email<>'' and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
     or jsonb_typeof(p_data->'consent') is distinct from 'object' then
    raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_data->'consent') k where not k=any(array['contact','call','ai','transcript','recording'])) then
    raise exception 'INVALID_CONSENT' using errcode='22023'; end if;
  foreach purpose in array array['contact','call','ai','transcript','recording'] loop
    if jsonb_typeof(p_data->'consent'->purpose) is distinct from 'boolean' then raise exception 'INVALID_CONSENT' using errcode='22023'; end if;
  end loop;
  if p_data->'consent'->'contact' is distinct from 'true'::jsonb
     or (p_data->>'channel'='Phone' and p_data->'consent'->'call' is distinct from 'true'::jsonb) then
    raise exception 'INVALID_CONSENT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_hash,9));
  insert into pose_private.m03_browser_sessions(token_hash) values(p_session_hash) on conflict do nothing;
  select expires_at into session_expiry from pose_private.m03_browser_sessions where token_hash=p_session_hash;
  if session_expiry<=now() then raise exception 'BROWSER_SESSION_EXPIRED' using errcode='42501'; end if;
  select * into existing from public.property_inquiries where browser_session_hash=p_session_hash and request_key=p_key;
  if found then
    if existing.request_payload<>p_data then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return jsonb_build_object('id',existing.id,'status',existing.status,'phone_verified',false,'created_at',existing.created_at,'replayed',true);
  end if;
  if (select count(*) from public.property_inquiries where browser_session_hash=p_session_hash and created_at>now()-interval '1 hour')>=10 then
    raise exception 'INQUIRY_LIMIT' using errcode='53300'; end if;
  if p_data->>'property_id' is not null then
    select * into product from public.property_products p where p.id=(p_data->>'property_id')::uuid
      and exists(select 1 from public.property_public_catalog v where v.id=p.id);
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  elsif char_length(btrim(p_data->>'message'))<10 then raise exception 'NEEDS_REQUIRED' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('purpose',x.key,'channel',p_data->>'channel','status',case when x.value='true'::jsonb then 'Granted' else 'Declined' end,
    'source','GuestWeb','recorded_at',now(),'version','2026-10-25','phone_verified',false)) into evidence from jsonb_each(p_data->'consent') x;
  insert into public.property_inquiries(user_id,browser_session_hash,source,property_id,property_name,name,phone,email,country,channel,preferred_time,message,status,phone_verified,consent,consent_evidence,request_key,payload_fingerprint,request_payload)
  values(null,p_session_hash,'GuestWeb',product.id,product.name,btrim(p_data->>'name'),p_data->>'phone',email,p_data->>'country',p_data->>'channel',p_data->>'preferred_time',btrim(p_data->>'message'),'Received',false,p_data->'consent',evidence,p_key,md5(p_data::text),p_data)
  returning * into result;
  return jsonb_build_object('id',result.id,'status',result.status,'phone_verified',false,'created_at',result.created_at,'replayed',false);
end $$;
create function pose_private.read_browser_inquiries(p_session_hash text,p_page integer,p_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; total integer;
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' or p_page is null or p_page not between 1 and 10000 or p_size is null or p_size not between 1 and 50 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if not exists(select 1 from pose_private.m03_browser_sessions where token_hash=p_session_hash and expires_at>now()) then
    return jsonb_build_object('items','[]'::jsonb,'total',0,'page',p_page,'pageSize',p_size); end if;
  select count(*) into total from public.property_inquiries where browser_session_hash=p_session_hash;
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id),'[]'::jsonb) into items from (
    select id,property_id,property_name,name,phone,email,channel,preferred_time,message,status,phone_verified,consent,created_at
    from public.property_inquiries where browser_session_hash=p_session_hash order by created_at desc,id limit p_size offset (p_page-1)*p_size
  ) x;
  return jsonb_build_object('items',items,'total',total,'page',p_page,'pageSize',p_size);
end $$;
revoke all on function pose_private.submit_browser_inquiry(jsonb,uuid,text),pose_private.read_browser_inquiries(text,integer,integer) from public,anon,authenticated;
grant usage on schema pose_private to service_role;
grant execute on function pose_private.submit_browser_inquiry(jsonb,uuid,text),pose_private.read_browser_inquiries(text,integer,integer) to service_role;
create function public.pose_submit_browser_inquiry(p_data jsonb,p_key uuid,p_session_hash text) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.submit_browser_inquiry(p_data,p_key,p_session_hash); $$;
create function public.pose_read_browser_inquiries(p_session_hash text,p_page integer,p_size integer) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.read_browser_inquiries(p_session_hash,p_page,p_size); $$;
revoke all on function public.pose_submit_browser_inquiry(jsonb,uuid,text),public.pose_read_browser_inquiries(text,integer,integer) from public,anon,authenticated;
grant execute on function public.pose_submit_browser_inquiry(jsonb,uuid,text),public.pose_read_browser_inquiries(text,integer,integer) to service_role;

create table public.property_inquiry_notifications (
  inquiry_id uuid primary key references public.property_inquiries(id) on delete restrict,
  created_at timestamptz not null default now(),read_at timestamptz,read_by uuid references auth.users(id) on delete restrict
);
alter table public.property_inquiry_notifications enable row level security;
revoke all on public.property_inquiry_notifications from public,anon,authenticated;
grant select on public.property_inquiry_notifications to authenticated;
create policy inquiry_notifications_admin on public.property_inquiry_notifications for select to authenticated using((select pose_private.catalog_admin()));
create index inquiry_notifications_unread_idx on public.property_inquiry_notifications(created_at desc,inquiry_id) where read_at is null;
create index inquiry_notifications_reader_idx on public.property_inquiry_notifications(read_by) where read_by is not null;
create function pose_private.inquiry_received_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.property_inquiry_notifications(inquiry_id) values(new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function pose_private.inquiry_received_notification() from public,anon,authenticated;
create trigger m03_inquiry_received after insert on public.property_inquiries for each row execute function pose_private.inquiry_received_notification();
insert into public.property_inquiry_notifications(inquiry_id) select id from public.property_inquiries where status in ('Received','NeedsReview');
create function pose_private.admin_inquiries(p_page integer,p_unread boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; n integer; unread integer;
begin
  perform pose_private.require_account();
  if not pose_private.catalog_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_page is null or p_page not between 1 and 10000 or p_unread is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  select count(*) into unread from public.property_inquiry_notifications where read_at is null;
  select count(*) into n from public.property_inquiry_notifications where not p_unread or read_at is null;
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id),'[]'::jsonb) into items from (
    select i.id,i.property_id,i.property_name,i.name,i.phone,i.email,i.channel,i.preferred_time,i.message,i.status,i.phone_verified,i.consent,i.created_at,n.read_at
    from public.property_inquiries i join public.property_inquiry_notifications n on n.inquiry_id=i.id
    where not p_unread or n.read_at is null order by i.created_at desc,i.id limit 12 offset (p_page-1)*12
  ) x;
  return jsonb_build_object('items',items,'total',n,'unread',unread,'page',p_page,'pageSize',12);
end $$;
create function pose_private.read_admin_inquiry(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account();
begin
  if not pose_private.catalog_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  update public.property_inquiry_notifications set read_at=coalesce(read_at,now()),read_by=coalesce(read_by,actor) where inquiry_id=p_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('id',p_id,'read',true);
end $$;
revoke all on function pose_private.admin_inquiries(integer,boolean),pose_private.read_admin_inquiry(uuid) from public,anon;
grant execute on function pose_private.admin_inquiries(integer,boolean),pose_private.read_admin_inquiry(uuid) to authenticated;
create function public.pose_admin_inquiries(p_page integer,p_unread boolean) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.admin_inquiries(p_page,p_unread); $$;
create function public.pose_read_admin_inquiry(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select pose_private.read_admin_inquiry(p_id); $$;
revoke all on function public.pose_admin_inquiries(integer,boolean),public.pose_read_admin_inquiry(uuid) from public,anon;
grant execute on function public.pose_admin_inquiries(integer,boolean),public.pose_read_admin_inquiry(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
