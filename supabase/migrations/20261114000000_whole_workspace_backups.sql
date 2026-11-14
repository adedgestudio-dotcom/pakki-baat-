-- Apply and verify on staging before the owner runs this in production.
-- Existing daily and pre_restore backups remain readable.
begin;
alter table public.workspace_backups
  drop constraint if exists workspace_backups_backup_kind_check;
alter table public.workspace_backups
  add constraint workspace_backups_backup_kind_check
  check (backup_kind in ('daily', 'manual', 'scheduled', 'pre_restore'));

drop function if exists public.save_workspace_backup(jsonb, text);
create function public.save_workspace_backup(payload jsonb, kind text default 'daily')
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  latest public.workspace_backups%rowtype;
  saved public.workspace_backups%rowtype;
  newest_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'Invalid backup payload'; end if;
  if kind not in ('manual', 'scheduled', 'pre_restore', 'daily') then raise exception 'Invalid backup kind'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':workspace-backup', 0));
  select * into latest from public.workspace_backups
   where owner_id = uid order by created_at desc, id desc limit 1;
  if kind in ('manual', 'scheduled') and latest.id is not null
     and md5(latest.payload::text) = md5(payload::text) and latest.payload = payload then
    return jsonb_build_object('created', false, 'id', latest.id, 'created_at', latest.created_at);
  end if;

  if kind = 'daily' then
    insert into public.workspace_backups(owner_id, payload, backup_kind, backup_day)
    values(uid, payload, kind, today)
    on conflict(owner_id, backup_day) where backup_kind = 'daily'
    do update set payload = excluded.payload, created_at = now()
    returning * into saved;
  else
    insert into public.workspace_backups(owner_id, payload, backup_kind, backup_day)
    values(uid, payload, kind, today) returning * into saved;
  end if;

  select id into newest_id from public.workspace_backups
   where owner_id = uid order by created_at desc, id desc limit 1;
  delete from public.workspace_backups
   where owner_id = uid and id <> newest_id
     and created_at < now() - interval '30 days';

  -- Young safety copies are protected. If they alone exceed 60, protection wins.
  with protected as (
    select id from public.workspace_backups
     where owner_id = uid and (id = newest_id or
       (backup_kind = 'pre_restore' and created_at >= now() - interval '30 days'))
  ), slots as (
    select greatest(60 - count(*)::integer, 0) as available from protected
  ), kept as (
    select id from protected
    union
    select id from (
      select id from public.workspace_backups
       where owner_id = uid and id not in (select id from protected)
       order by created_at desc, id desc limit (select available from slots)
    ) remaining
  )
  delete from public.workspace_backups
   where owner_id = uid and id not in (select id from kept);

  return jsonb_build_object('created', true, 'id', saved.id, 'created_at', saved.created_at);
end;
$$;
revoke all on function public.save_workspace_backup(jsonb, text) from public, anon;
grant execute on function public.save_workspace_backup(jsonb, text) to authenticated;

-- Keep the existing schedule table/RPC signature, but remove customer selection.
create or replace function public.set_backup_settings(
  frequency text, time_of_day time, tz text, anchor_day integer, customers text[], run_at timestamptz default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.subscriptions s
      where s.owner_id=uid and s.status='active' and s.period_end>now()) then
    raise exception 'Subscription inactive';
  end if;
  if frequency not in ('off','manual','daily','weekly','monthly') or frequency is null then raise exception 'Invalid backup frequency'; end if;
  if tz is null or not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Invalid backup timezone'; end if;
  if frequency in ('daily','weekly','monthly') and time_of_day is null then raise exception 'Choose a backup time'; end if;
  if frequency='weekly' and (anchor_day is null or anchor_day not between 0 and 6) then raise exception 'Invalid weekday'; end if;
  if frequency='monthly' and (anchor_day is null or anchor_day not between 1 and 28) then raise exception 'Invalid month day'; end if;
  insert into public.workspace_backup_settings(owner_id,frequency,time_of_day,tz,anchor_day,customers,last_run_at)
  values(uid,frequency,time_of_day,tz,anchor_day,'{}'::text[],run_at)
  on conflict(owner_id) do update set
    frequency=case when run_at is null then excluded.frequency else public.workspace_backup_settings.frequency end,
    time_of_day=case when run_at is null then excluded.time_of_day else public.workspace_backup_settings.time_of_day end,
    tz=case when run_at is null then excluded.tz else public.workspace_backup_settings.tz end,
    anchor_day=case when run_at is null then excluded.anchor_day else public.workspace_backup_settings.anchor_day end,
    customers='{}'::text[],
    last_run_at=coalesce(run_at,public.workspace_backup_settings.last_run_at),updated_at=now();
end $$;
revoke all on function public.set_backup_settings(text,time,text,integer,text[],timestamptz) from public, anon;
grant execute on function public.set_backup_settings(text,time,text,integer,text[],timestamptz) to authenticated;
commit;
