-- Versioned automatic workspace backups.
-- Keeps one automatic snapshot per UTC day plus safety snapshots before restore.

create table if not exists public.workspace_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  backup_kind text not null default 'daily' check (backup_kind in ('daily','pre_restore')),
  backup_day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create unique index if not exists workspace_backups_daily_owner_day
  on public.workspace_backups(owner_id, backup_day)
  where backup_kind = 'daily';

create index if not exists workspace_backups_owner_created
  on public.workspace_backups(owner_id, created_at desc);

alter table public.workspace_backups enable row level security;

drop policy if exists "workspace_backups_select_own" on public.workspace_backups;
create policy "workspace_backups_select_own"
  on public.workspace_backups for select
  using (owner_id = auth.uid());

revoke all on public.workspace_backups from anon, authenticated;
grant select on public.workspace_backups to authenticated;

create or replace function public.save_workspace_backup(payload jsonb, kind text default 'daily')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'Invalid backup payload'; end if;
  if kind not in ('daily','pre_restore') then raise exception 'Invalid backup kind'; end if;

  if kind = 'daily' then
    insert into public.workspace_backups(owner_id,payload,backup_kind,backup_day)
    values(uid,payload,'daily',today)
    on conflict (owner_id, backup_day) where backup_kind = 'daily'
    do update set payload=excluded.payload, created_at=now();
  else
    insert into public.workspace_backups(owner_id,payload,backup_kind,backup_day)
    values(uid,payload,'pre_restore',today);
  end if;

  delete from public.workspace_backups
   where owner_id=uid
     and id not in (
       select id from public.workspace_backups
        where owner_id=uid
        order by created_at desc
        limit 8
     );
end;
$$;

revoke all on function public.save_workspace_backup(jsonb,text) from public;
grant execute on function public.save_workspace_backup(jsonb,text) to authenticated;
