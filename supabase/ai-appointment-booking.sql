-- M06: customer appointment booking and owner-scoped chat deletion.
-- Apply after ai-agent.sql, ai-chat-history.sql, property-discovery.sql and
-- lead-contact-foundation.sql.
begin;

create or replace function pose_private.ai_appointment_options(p_property uuid, p_start timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p record; v_area text; result jsonb;
begin
  select id,code,name,location into p from public.property_products
  where id=p_property and publication='Published' and availability='Available';
  if not found then raise exception 'PROPERTY_NOT_FOUND' using errcode='P0002'; end if;
  -- The ward/area is the first part of the location ("Phường Long Bình, Thành phố Hồ Chí Minh").
  v_area:=nullif(btrim(split_part(p.location,',',1)),'');
  select jsonb_build_object(
    'property',jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'location',p.location),
    'sales',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'full_name',x.full_name,'reason',x.reason,'recommended',x.rn=1) order by x.rn),'[]'::jsonb)
  ) into result
  from (
    select u.id,u.full_name,
      case when a.owner then 'Phụ trách căn này'
        when a.area_count>0 then 'Đã tư vấn '||a.area_count||' căn ở '||v_area
        else 'Lịch trống nhiều nhất tuần này' end as reason,
      row_number() over(order by a.owner desc,(a.area_count>0) desc,a.area_count desc,a.upcoming_count asc,u.full_name,u.id) as rn
    from public.users u
    cross join lateral (select
      exists(select 1 from public.property_sales_owners o where o.property_id=p.id and o.sales_id=u.id) as owner,
      (select count(distinct ap.property_id) from public.appointments ap join public.property_products prior on prior.id=ap.property_id
        where ap.sales_id=u.id and v_area is not null and prior.location ilike '%'||v_area||'%')::integer as area_count,
      (select count(*) from public.appointments upcoming where upcoming.sales_id=u.id and upcoming.status in ('SCHEDULED','CONFIRMED')
        and upcoming.appointment_time>=now() and upcoming.appointment_time<now()+interval '7 days')::integer as upcoming_count
    ) a
    where u.role='Sales' and u.account_status='active' and u.auth_user_id is not null
      and (p_start is null or not exists(
        select 1 from public.appointments busy
        where busy.sales_id=u.id and busy.status in ('SCHEDULED','CONFIRMED')
          and busy.appointment_time < p_start + interval '60 minutes'
          and coalesce(busy.ends_at,busy.appointment_time+interval '60 minutes') > p_start))
  ) x;
  return result;
end $$;

create or replace function public.pose_ai_appointment_options(p_property uuid,p_start timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_appointment_options(p_property,p_start); $$;

create or replace function pose_private.ai_create_appointment(p_property uuid,p_start timestamptz,p_end timestamptz,p_sales uuid,p_note text,p_session uuid,p_request_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account(); v_customer uuid; v_lead uuid; prop record; v_sales uuid; v_sales_name text; existing record; v_id uuid; opts jsonb; profile jsonb; v_phone text; v_auth auth.users;
begin
  if (select pose_private.pose_access_context()->>'role') is distinct from 'User' then raise exception 'CUSTOMER_REQUIRED' using errcode='42501'; end if;
  if p_property is null or p_start is null or p_request_key is null or char_length(btrim(p_request_key)) not between 8 and 200 or p_note is not null and char_length(p_note)>500 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if p_start < now()+interval '1 hour' or p_start > now()+interval '60 days' then raise exception 'TIME_WINDOW_INVALID' using errcode='22023'; end if;
  if (p_start at time zone 'Asia/Ho_Chi_Minh')::time < time '08:00' or (p_start at time zone 'Asia/Ho_Chi_Minh')::time >= time '20:00' then raise exception 'TIME_WINDOW_INVALID' using errcode='22023'; end if;
  if p_end is not null and (p_end<=p_start or p_end>p_start+interval '2 hours') then raise exception 'TIME_WINDOW_INVALID' using errcode='22023'; end if;
  p_end:=coalesce(p_end,p_start+interval '60 minutes');
  select * into prop from public.property_products where id=p_property and publication='Published' and availability='Available';
  if not found then raise exception 'PROPERTY_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,3));
  select c.id into v_customer from public.customers c where c.auth_user_id=actor limit 1;
  -- First booking creates the customer the same way the AI handoff does: a verified phone is required
  -- so the consultant can reach the customer.
  if v_customer is null then
    profile:=pose_private.read_profile(); select * into v_auth from auth.users where id=actor;
    v_phone:=profile->>'phone';
    if not coalesce((profile->>'phoneVerified')::boolean,false) or v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'PHONE_VERIFICATION_REQUIRED' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_phone,3));
    if exists(select 1 from public.customers c where ltrim(c.phone,'+')=ltrim(v_phone,'+') or v_phone like '+84%' and c.phone='0'||substring(v_phone from 4)) then raise exception 'IDENTITY_REVIEW_REQUIRED' using errcode='22023'; end if;
    insert into public.customers(full_name,phone,email,source,auth_user_id,phone_verified_at) values(profile->>'name',v_phone,v_auth.email,'WebChat',actor,v_auth.phone_confirmed_at) returning id into v_customer;
  end if;
  select l.id into v_lead from public.leads l where l.customer_id=v_customer and not l.archived and l.status not in ('CONVERTED','LOST') order by l.created_at limit 1;
  if v_lead is null then insert into public.leads(customer_id,source) values(v_customer,'WebChat') returning id into v_lead; end if;
  select a.* into existing from public.appointments a where a.idempotency_key=p_request_key and a.customer_id=v_customer limit 1;
  if found then return jsonb_build_object('appointment_id',existing.id,'start',existing.appointment_time,'sales_name',(select u.full_name from public.users u where u.id=existing.sales_id)); end if;
  if p_sales is null then opts:=pose_private.ai_appointment_options(p_property,p_start); v_sales:=(opts->'sales'->0->>'id')::uuid;
  else v_sales:=p_sales; end if;
  if v_sales is not null then
    select u.full_name into v_sales_name from public.users u where u.id=v_sales and u.role='Sales' and u.account_status='active';
    if v_sales_name is null then raise exception 'SALES_NOT_AVAILABLE' using errcode='22023'; end if;
    if exists(select 1 from public.appointments a where a.sales_id=v_sales and a.status in ('SCHEDULED','CONFIRMED') and a.appointment_time<p_end and coalesce(a.ends_at,a.appointment_time+interval '60 minutes')>p_start) then raise exception 'APPOINTMENT_OVERLAP' using errcode='23P01'; end if;
  end if;
  insert into public.appointments(lead_id,customer_id,sales_id,property_id,appointment_time,ends_at,location,status,notes,source,idempotency_key)
  values(v_lead,v_customer,v_sales,p_property,p_start,p_end,prop.location,'SCHEDULED',nullif(btrim(p_note),'') ,'AI',p_request_key)
  returning id into v_id;
  insert into public.property_history(entity_kind,entity_id,actor_id,action,reason,after_data,source)
  values('Appointment',v_id,actor,'appointment_requested','AI chat booking',jsonb_build_object('property_id',p_property,'customer_id',v_customer,'sales_id',v_sales,'appointment_time',p_start,'ends_at',p_end),'AI');
  return jsonb_build_object('appointment_id',v_id,'start',p_start,'sales_name',v_sales_name);
end $$;

create or replace function public.pose_ai_create_appointment(p_property uuid,p_start timestamptz,p_end timestamptz default null,p_sales uuid default null,p_note text default null,p_session uuid default null,p_request_key text default null)
returns jsonb language sql security invoker set search_path='' as $$ select pose_private.ai_create_appointment(p_property,p_start,p_end,p_sales,p_note,p_session,p_request_key); $$;

create or replace function pose_private.ai_delete_session(p_session uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account();
begin
  if not exists(select 1 from public.ai_chat_sessions where id=p_session and user_id=actor and store_transcript) then raise exception 'SESSION_NOT_FOUND' using errcode='P0002'; end if;
  update public.ai_extracted_preferences set source_session_id=null where source_session_id=p_session;
  delete from public.ai_action_log where session_id=p_session;
  delete from public.ai_chat_messages where session_id=p_session;
  delete from public.ai_chat_sessions where id=p_session and user_id=actor;
  return true;
end $$;

create or replace function public.pose_ai_delete_session(p_session uuid)
returns boolean language sql security invoker set search_path='' as $$ select pose_private.ai_delete_session(p_session); $$;

revoke all on function pose_private.ai_appointment_options(uuid,timestamptz),public.pose_ai_appointment_options(uuid,timestamptz),pose_private.ai_create_appointment(uuid,timestamptz,timestamptz,uuid,text,uuid,text),public.pose_ai_create_appointment(uuid,timestamptz,timestamptz,uuid,text,uuid,text),pose_private.ai_delete_session(uuid),public.pose_ai_delete_session(uuid) from public,anon;
grant execute on function pose_private.ai_appointment_options(uuid,timestamptz),pose_private.ai_create_appointment(uuid,timestamptz,timestamptz,uuid,text,uuid,text),pose_private.ai_delete_session(uuid) to authenticated;
grant execute on function public.pose_ai_appointment_options(uuid,timestamptz),public.pose_ai_create_appointment(uuid,timestamptz,timestamptz,uuid,text,uuid,text),public.pose_ai_delete_session(uuid) to authenticated;
commit;
