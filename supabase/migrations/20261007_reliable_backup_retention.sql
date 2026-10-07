-- Reliable backup retention and immutable daily recovery points.
-- Users choose 15 or 30 days. Backups remain owned by auth.uid(), never by email.

create table if not exists public.workspace_backup_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  retention_days integer not null default 15 check (retention_days in (15,30)),
  updated_at timestamptz not null default now()
);

alter table public.workspace_backup_preferences enable row level security;

drop policy if exists "workspace_backup_preferences_select_own" on public.workspace_backup_preferences;
create policy "workspace_backup_preferences_select_own"
  on public.workspace_backup_preferences for select
  using (owner_id = auth.uid());

revoke all on public.workspace_backup_preferences from anon, authenticated;
grant select on public.workspace_backup_preferences to authenticated;

create or replace function public.set_workspace_backup_retention(days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if days not in (15,30) then raise exception 'Retention must be 15 or 30 days'; end if;
  insert into public.workspace_backup_preferences(owner_id,retention_days,updated_at)
  values(uid,days,now())
  on conflict(owner_id) do update
    set retention_days=excluded.retention_days, updated_at=now();
end;
$$;

revoke all on function public.set_workspace_backup_retention(integer) from public;
grant execute on function public.set_workspace_backup_retention(integer) to authenticated;

create or replace function public.save_workspace_backup(payload jsonb, kind text default 'daily')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  keep_days integer := 15;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'Invalid backup payload'; end if;
  if kind not in ('daily','pre_restore') then raise exception 'Invalid backup kind'; end if;

  select retention_days into keep_days
    from public.workspace_backup_preferences
   where owner_id=uid;
  keep_days := coalesce(keep_days,15);

  if kind='daily' then
    -- Immutable daily point: the first verified snapshot for a day is preserved.
    insert into public.workspace_backups(owner_id,payload,backup_kind,backup_day)
    values(uid,payload,'daily',today)
    on conflict (owner_id,backup_day) where backup_kind='daily' do nothing;
  else
    insert into public.workspace_backups(owner_id,payload,backup_kind,backup_day)
    values(uid,payload,'pre_restore',today);
  end if;

  -- Delete only recovery points older than the user's chosen window.
  delete from public.workspace_backups
   where owner_id=uid
     and backup_day < today-(keep_days-1);
end;
$$;

revoke all on function public.save_workspace_backup(jsonb,text) from public;
grant execute on function public.save_workspace_backup(jsonb,text) to authenticated;
