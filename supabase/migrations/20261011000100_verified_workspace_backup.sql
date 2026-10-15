-- ADDITIVE ONLY. Review and apply to staging before any client invokes this RPC.
-- Prerequisite: Supabase pgcrypto installed in extensions schema (extensions.digest).
-- Existing save_workspace_backup(jsonb,text) remains unchanged.

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_extension extension
      join pg_catalog.pg_namespace namespace on namespace.oid = extension.extnamespace
     where extension.extname = 'pgcrypto' and namespace.nspname = 'extensions'
  ) then
    raise exception 'VERIFIED_BACKUP_REQUIRES_PGCRYPTO_IN_EXTENSIONS_SCHEMA';
  end if;
end;
$$;

create or replace function public.save_workspace_backup_verified(payload jsonb, kind text default 'pre_restore')
returns table(backup_id uuid, owner_id uuid, backup_kind text, payload_sha256 text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_id uuid;
  v_owner_out uuid;
  v_kind text;
  v_payload jsonb;
  v_created timestamptz;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then raise exception 'Invalid backup payload'; end if;
  if kind is null or kind not in ('daily', 'pre_restore') then raise exception 'Invalid backup kind'; end if;

  -- Serialize backup creation/retention per owner to avoid concurrent cleanup
  -- deleting a newly confirmed backup in a competing request.
  perform 1 from auth.users where id = v_owner for update;
  if not found then raise exception 'Invalid backup owner'; end if;

  -- Daily backups retain one-per-owner-per-day semantics, but the new call
  -- must create a fresh identity, not return the ID of an updated old row.
  if kind = 'daily' then
    delete from public.workspace_backups existing_daily
    where existing_daily.owner_id = v_owner and existing_daily.backup_kind = 'daily' and existing_daily.backup_day = v_today;
  end if;

  insert into public.workspace_backups(owner_id, payload, backup_kind, backup_day)
  values (v_owner, payload, kind, v_today)
  returning id, workspace_backups.owner_id, workspace_backups.backup_kind,
            workspace_backups.payload, workspace_backups.created_at
  into v_id, v_owner_out, v_kind, v_payload, v_created;

  -- Preserve legacy 8-backup retention and explicitly protect the new ID.
  delete from public.workspace_backups b
  where b.owner_id = v_owner and b.id <> v_id
    and b.id not in (
      select candidate.id from public.workspace_backups candidate
      where candidate.owner_id = v_owner and candidate.id <> v_id
      order by candidate.created_at desc, candidate.id desc limit 7
    );

  return query select v_id, v_owner_out, v_kind,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    v_created;
end;
$$;

revoke all on function public.save_workspace_backup_verified(jsonb,text) from public, anon;
grant execute on function public.save_workspace_backup_verified(jsonb,text) to authenticated;
