-- Phase 1C-C staging-only safety: suspension is a write freeze, never a
-- return to untracked legacy saves. Apply explicitly to staging after review.
begin;

create or replace function public.guard_atomic_hisaab_workspace_write() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare mode_enabled boolean; activated_at timestamptz; allowed_writer text;
begin
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then raise exception 'WORKSPACE_OWNER_IMMUTABLE'; end if;
    new.revision := old.revision + 1;
  end if;
  select enabled, enabled_at into mode_enabled, activated_at
    from public.workspace_ledger_modes where owner_id = new.owner_id;
  if found and activated_at is not null and not mode_enabled then
    raise exception 'LEDGER_MODE_SUSPENDED';
  end if;
  if coalesce(mode_enabled, false) then
    select pg_get_userbyid(p.proowner) into allowed_writer from pg_proc p
      where p.oid = 'public.save_workspace_with_ledger(jsonb,bigint)'::regprocedure;
    if current_user <> allowed_writer or
       current_setting('app.hisaab_atomic_owner', true) is distinct from new.owner_id::text then
      raise exception 'LEDGER_MODE_REQUIRES_ATOMIC_SAVE';
    end if;
  end if;
  return new;
end; $$;

create or replace function public.guard_atomic_hisaab_ledger_insert() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare mode_enabled boolean; activated_at timestamptz; allowed_writer text;
begin
  select enabled, enabled_at into mode_enabled, activated_at
    from public.workspace_ledger_modes where owner_id = new.owner_id;
  if found and activated_at is not null and not mode_enabled then
    raise exception 'LEDGER_MODE_SUSPENDED';
  end if;
  if coalesce(mode_enabled, false) then
    select pg_get_userbyid(p.proowner) into allowed_writer from pg_proc p
      where p.oid = 'public.save_workspace_with_ledger(jsonb,bigint)'::regprocedure;
    if current_user <> allowed_writer or
       current_setting('app.hisaab_atomic_owner', true) is distinct from new.owner_id::text then
      raise exception 'LEDGER_MODE_REQUIRES_ATOMIC_SAVE';
    end if;
  end if;
  return new;
end; $$;

create function public.suspend_workspace_hisaab_ledger(target_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare workspace public.workspaces%rowtype; mode public.workspace_ledger_modes%rowtype;
  history_count bigint;
begin
  if target_owner_id is null then raise exception 'TARGET_OWNER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hisaab-atomic:' || target_owner_id::text, 0));
  select * into workspace from public.workspaces where owner_id = target_owner_id for update;
  if not found then raise exception 'WORKSPACE_NOT_INITIALIZED'; end if;
  select * into mode from public.workspace_ledger_modes where owner_id = target_owner_id for update;
  if not found or mode.enabled_at is null then raise exception 'LEDGER_MODE_NEVER_ACTIVATED'; end if;
  if not mode.enabled then
    return jsonb_build_object('enabled', false, 'frozen', true,
      'revision', workspace.revision, 'already_suspended', true);
  end if;
  select count(*) into history_count from public.hisaab_ledger_transactions
    where owner_id = target_owner_id;
  update public.workspace_ledger_modes set enabled = false where owner_id = target_owner_id;
  return jsonb_build_object('enabled', false, 'frozen', true,
    'revision', workspace.revision, 'ledger_rows_preserved', history_count,
    'already_suspended', false);
end; $$;

revoke all on function public.suspend_workspace_hisaab_ledger(uuid) from public, anon, authenticated;
grant execute on function public.suspend_workspace_hisaab_ledger(uuid) to service_role;

commit;
