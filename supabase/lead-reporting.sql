-- Lead reporting: apply after lead-management.sql.
-- Read-only business RPCs. No tables, triggers, scoring or existing module functions are changed.
begin;
do $$ begin
  if to_regprocedure('pose_private.lead_staff()') is null
    or to_regprocedure('pose_private.lead_directory()') is null then
    raise exception 'REPORT_PREREQUISITE: apply lead-management.sql first';
  end if;
end $$;

create or replace function pose_private.report_leads(p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  staff text:=pose_private.lead_staff();
  directory uuid:=pose_private.lead_directory();
  today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
  date_from date; date_to date; sales uuid;
  status_filter text; temperature_filter text; archived_filter text;
  bucket text; result jsonb;
begin
  if jsonb_typeof(p_filters) is distinct from 'object'
    or exists(select 1 from jsonb_each(p_filters) f where f.key not in ('date_from','date_to','status','temperature','archived','sales_id') or jsonb_typeof(f.value)<>'string')
    or (p_filters ? 'date_from')<>(p_filters ? 'date_to') then
    raise exception 'REPORT_INVALID_FILTER' using errcode='22023';
  end if;
  if p_filters ? 'date_from' then
    if p_filters->>'date_from' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'
      or p_filters->>'date_to' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'REPORT_INVALID_DATE' using errcode='22023';
    end if;
    date_from:=(p_filters->>'date_from')::date; date_to:=(p_filters->>'date_to')::date;
  else
    date_from:=date_trunc('month',today::timestamp)::date; date_to:=today;
  end if;
  if date_from>date_to or date_to>today or date_to-date_from>3660 then
    raise exception 'REPORT_INVALID_RANGE' using errcode='22023';
  end if;
  status_filter:=p_filters->>'status'; temperature_filter:=p_filters->>'temperature';
  archived_filter:=coalesce(p_filters->>'archived','all');
  if (status_filter is not null and status_filter not in ('NEW','CONTACTED','QUALIFIED','FOLLOW_UP','CONVERTED','LOST'))
    or (temperature_filter is not null and temperature_filter not in ('HOT','WARM','COLD','UNRATED'))
    or archived_filter not in ('all','true','false') then
    raise exception 'REPORT_INVALID_FILTER' using errcode='22023';
  end if;
  if p_filters ? 'sales_id' then
    if staff<>'Admin' then raise exception 'REPORT_SALES_FILTER_FORBIDDEN' using errcode='42501'; end if;
    sales:=(p_filters->>'sales_id')::uuid;
  end if;
  bucket:=case when date_to-date_from<=30 then 'day' else 'month' end;

  with filtered as materialized (
    select l.id,l.status::text as status,coalesce(l.temperature::text,'UNRATED') as temperature,
      (l.created_at at time zone 'Asia/Ho_Chi_Minh')::date as created_day
    from public.leads l
    where l.created_at >= (date_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and l.created_at < ((date_to+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and (staff='Admin' or exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=directory))
      and (sales is null or exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=sales))
      and (status_filter is null or l.status::text=status_filter)
      and (temperature_filter is null or coalesce(l.temperature::text,'UNRATED')=temperature_filter)
      and (archived_filter='all' or l.archived=(archived_filter='true'))
  ), status_counts as (
    select status,count(*) as n from filtered group by status
  ), temperature_counts as (
    select temperature,count(*) as n from filtered group by temperature
  ), trend_counts as (
    select date_trunc(bucket,created_day::timestamp)::date as day,count(*) as n from filtered group by 1
  ), buckets as (
    select day::date as day from generate_series(date_trunc(bucket,date_from::timestamp),date_trunc(bucket,date_to::timestamp),
      case when bucket='day' then interval '1 day' else interval '1 month' end) day
  )
  select jsonb_build_object(
    'stats',(select jsonb_strip_nulls(jsonb_build_object('total',count(*),'converted',count(*) filter(where status='CONVERTED'),
      'unassigned',case when staff='Admin' then count(*) filter(where status not in ('CONVERTED','LOST') and not exists(
        select 1 from public.lead_assignments a where a.lead_id=f.id and a.is_active)) end)) from filtered f),
    'statuses',(select jsonb_agg(jsonb_build_object('key',v.key,'count',coalesce(s.n,0)) order by v.ord)
      from (values('NEW',1),('CONTACTED',2),('QUALIFIED',3),('FOLLOW_UP',4),('CONVERTED',5),('LOST',6)) v(key,ord)
      left join status_counts s on s.status=v.key),
    'temperatures',(select jsonb_agg(jsonb_build_object('key',v.key,'count',coalesce(t.n,0)) order by v.ord)
      from (values('HOT',1),('WARM',2),('COLD',3),('UNRATED',4)) v(key,ord)
      left join temperature_counts t on t.temperature=v.key),
    'trend',(select jsonb_agg(jsonb_build_object('date',b.day,'count',coalesce(t.n,0)) order by b.day)
      from buckets b left join trend_counts t on t.day=b.day),
    'bucket',bucket,'timezone','Asia/Ho_Chi_Minh','generated_at',now(),
    'filters',jsonb_strip_nulls(jsonb_build_object('date_from',date_from,'date_to',date_to,'status',status_filter,
      'temperature',temperature_filter,'archived',archived_filter,'sales_id',sales)),
    'scope',jsonb_build_object('role',staff)) into result;
  return result;
end $$;

create or replace function pose_private.report_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff text:=pose_private.lead_staff();
begin
  return jsonb_build_object('role',staff,'sales',case when staff='Admin' then coalesce((
    select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(btrim(u.full_name),''),'Sales'),
      'active',pose_private.lead_sales_valid(u.id)) order by u.full_name,u.id)
    from public.users u where u.role='Sales' or exists(select 1 from public.lead_assignments a where a.sales_id=u.id)
  ),'[]'::jsonb) else '[]'::jsonb end);
end $$;

revoke all on function pose_private.report_leads(jsonb),pose_private.report_options() from public,anon,authenticated;
create or replace function public.pose_report_leads(p_filters jsonb) returns jsonb
language sql stable security definer set search_path='' as $$ select pose_private.report_leads(p_filters); $$;
create or replace function public.pose_report_options() returns jsonb
language sql stable security definer set search_path='' as $$ select pose_private.report_options(); $$;
revoke all on function public.pose_report_leads(jsonb),public.pose_report_options() from public,anon,authenticated;
grant execute on function public.pose_report_leads(jsonb),public.pose_report_options() to authenticated;
notify pgrst,'reload schema';
commit;
