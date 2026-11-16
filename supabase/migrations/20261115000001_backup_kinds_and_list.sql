-- Safety-copy kinds + bounded retention + metadata-only backup list.
-- 1) New backup kind 'pre_delete' (copies taken before deleting an entry/customer/reminder).
-- 2) Retention: regular backups 30 days / max 60; pre_delete 30 days / max 20;
--    pre_restore kept 30 days; the newest backup and the newest regular backup are never deleted.
-- 3) list_workspace_backups(): ids, kinds, times and counts only (no JSON payloads).
-- Existing backups are not changed or relabelled. Verified on staging.
begin;

alter table public.workspace_backups drop constraint if exists workspace_backups_backup_kind_check;
alter table public.workspace_backups add constraint workspace_backups_backup_kind_check
  check (backup_kind in ('daily', 'manual', 'scheduled', 'pre_restore', 'pre_delete'));

create or replace function public.prune_workspace_backups(p_owner uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.workspace_backups
   where owner_id = p_owner and id not in (
     select id from (select id from public.workspace_backups where owner_id = p_owner order by created_at desc, id desc limit 1) a
     union
     select id from (select id from public.workspace_backups where owner_id = p_owner and backup_kind in ('daily','manual','scheduled') order by created_at desc, id desc limit 1) b
     union
     select id from public.workspace_backups where owner_id = p_owner and backup_kind = 'pre_restore' and created_at >= now() - interval '30 days'
     union
     select id from (select id from public.workspace_backups where owner_id = p_owner and backup_kind = 'pre_delete' and created_at >= now() - interval '30 days' order by created_at desc, id desc limit 20) c
     union
     select id from (select id from public.workspace_backups where owner_id = p_owner and backup_kind in ('daily','manual','scheduled') and created_at >= now() - interval '30 days' order by created_at desc, id desc limit 60) d
   );
end;
$$;
revoke all on function public.prune_workspace_backups(uuid) from public, anon, authenticated;

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
  if kind not in ('manual', 'scheduled', 'pre_restore', 'pre_delete', 'daily') then raise exception 'Invalid backup kind'; end if;
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

create or replace function public.list_workspace_backups(p_limit integer default 200)
returns table(id uuid, backup_kind text, created_at timestamptz, entry_count integer, customer_count integer)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select b.id, b.backup_kind, b.created_at,
         case when jsonb_typeof(b.payload->'jobs') = 'array' then jsonb_array_length(b.payload->'jobs') else 0 end,
         public.hisaab_snapshot_customer_count(b.payload)
    from public.workspace_backups b
   where b.owner_id = auth.uid()
   order by b.created_at desc, b.id desc
   limit least(greatest(coalesce(p_limit, 200), 1), 200)
$$;
revoke all on function public.list_workspace_backups(integer) from public, anon;
grant execute on function public.list_workspace_backups(integer) to authenticated;

commit;
