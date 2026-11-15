-- Backup spec alignment (server side).
-- 1) Every "Back up now" / scheduled backup creates a NEW full snapshot (no "identical, skipped").
-- 2) Scheduled backups run on the server at the chosen time, even when the app is closed.
-- Retention is unchanged: 30 days, up to 60, newest and young safety copies protected.
-- Verified on staging before the owner runs it in production.
create extension if not exists pg_cron with schema pg_catalog;

begin;

-- Shared retention rule (internal only).
create or replace function public.prune_workspace_backups(p_owner uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare newest_id uuid;
begin
  select id into newest_id from public.workspace_backups
   where owner_id = p_owner order by created_at desc, id desc limit 1;
  if newest_id is null then return; end if;
  delete from public.workspace_backups
   where owner_id = p_owner and id <> newest_id
     and created_at < now() - interval '30 days';
  with protected as (
    select id from public.workspace_backups
     where owner_id = p_owner and (id = newest_id or
       (backup_kind = 'pre_restore' and created_at >= now() - interval '30 days'))
  ), slots as (
    select greatest(60 - count(*)::integer, 0) as available from protected
  ), kept as (
    select id from protected
    union
    select id from (
      select id from public.workspace_backups
       where owner_id = p_owner and id not in (select id from protected)
       order by created_at desc, id desc limit (select available from slots)
    ) remaining
  )
  delete from public.workspace_backups
   where owner_id = p_owner and id not in (select id from kept);
end;
$$;
revoke all on function public.prune_workspace_backups(uuid) from public, anon, authenticated;

-- Manual / scheduled / safety backup from the app: always a new row.
create or replace function public.save_workspace_backup(payload jsonb, kind text default 'daily')
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  saved public.workspace_backups%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'Invalid backup payload'; end if;
  if kind not in ('manual', 'scheduled', 'pre_restore', 'daily') then raise exception 'Invalid backup kind'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':workspace-backup', 0));
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
  perform public.prune_workspace_backups(uid);
  return jsonb_build_object('created', true, 'id', saved.id, 'created_at', saved.created_at);
end;
$$;
revoke all on function public.save_workspace_backup(jsonb, text) from public, anon;
grant execute on function public.save_workspace_backup(jsonb, text) to authenticated;

-- Server-side scheduled backups. Runs every 5 minutes from pg_cron.
-- A slot is taken when it is at least 2 minutes old (an open app goes first),
-- newer than the last run, and newer than the last settings change.
create or replace function public.run_due_workspace_backups()
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  s record; local_now timestamp; candidate timestamp; slot timestamptz;
  ws jsonb; made integer := 0;
begin
  for s in
    select b.* from public.workspace_backup_settings b
     where b.frequency in ('daily', 'weekly', 'monthly') and b.time_of_day is not null
       and exists(select 1 from pg_timezone_names z where z.name = b.tz)
       and exists(select 1 from public.subscriptions x
                   where x.owner_id = b.owner_id and x.status = 'active' and x.period_end > now())
  loop
    local_now := now() at time zone s.tz;
    candidate := date_trunc('day', local_now) + s.time_of_day;
    if s.frequency = 'daily' then
      if candidate > local_now then candidate := candidate - interval '1 day'; end if;
    elsif s.frequency = 'weekly' then
      if s.anchor_day is null then continue; end if;
      candidate := candidate - make_interval(days => ((extract(dow from candidate)::int - s.anchor_day + 7) % 7));
      if candidate > local_now then candidate := candidate - interval '7 days'; end if;
    else
      if s.anchor_day is null then continue; end if;
      candidate := date_trunc('month', local_now) + make_interval(days => s.anchor_day - 1) + s.time_of_day;
      if candidate > local_now then
        candidate := date_trunc('month', local_now - interval '1 month') + make_interval(days => s.anchor_day - 1) + s.time_of_day;
      end if;
    end if;
    slot := candidate at time zone s.tz;
    if slot > now() - interval '2 minutes' then continue; end if;
    if s.last_run_at is not null and s.last_run_at >= slot then continue; end if;
    if s.updated_at is not null and s.updated_at >= slot then continue; end if;

    perform pg_advisory_xact_lock(hashtextextended(s.owner_id::text || ':workspace-backup', 0));
    if exists(select 1 from public.workspace_backup_settings c
               where c.owner_id = s.owner_id and c.last_run_at is not null and c.last_run_at >= slot) then
      continue;
    end if;
    select w.payload into ws from public.workspaces w where w.owner_id = s.owner_id;
    if ws is null or jsonb_typeof(ws) <> 'object' then continue; end if;
    insert into public.workspace_backups(owner_id, payload, backup_kind, backup_day)
    values(s.owner_id, ws, 'scheduled', (now() at time zone 'utc')::date);
    update public.workspace_backup_settings set last_run_at = now(), updated_at = now()
     where owner_id = s.owner_id;
    perform public.prune_workspace_backups(s.owner_id);
    made := made + 1;
  end loop;
  return made;
end;
$$;
revoke all on function public.run_due_workspace_backups() from public, anon, authenticated;

commit;

select cron.unschedule(jobid) from cron.job where jobname = 'pakki-workspace-backups';
select cron.schedule('pakki-workspace-backups', '*/5 * * * *', 'select public.run_due_workspace_backups()');
