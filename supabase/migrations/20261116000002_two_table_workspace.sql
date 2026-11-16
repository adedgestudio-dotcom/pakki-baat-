-- Two-table model: live data lives in public.workspaces, history lives in public.workspace_backups.
-- Saving and restoring no longer write or reconcile the ledger table.
-- Same function names, arguments and return shape, so the app keeps working.
-- Revision conflict, snapshot validation, plan cap, subscription and device-session guards stay in force.
begin;

create or replace function public.save_workspace_with_ledger(payload jsonb, expected_revision bigint)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); previous public.workspaces%rowtype;
  next_revision bigint; prior_atomic_owner text;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if expected_revision is null or expected_revision < 1 then raise exception 'INVALID_EXPECTED_REVISION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hisaab-atomic:' || uid::text, 0));
  select * into previous from public.workspaces where owner_id = uid for update;
  if not found then raise exception 'WORKSPACE_NOT_INITIALIZED'; end if;
  if not exists(select 1 from public.workspace_ledger_modes where owner_id = uid and enabled) then raise exception 'LEDGER_MODE_DISABLED'; end if;
  perform public.validate_hisaab_snapshot_financial(payload);
  if previous.payload = payload then
    return jsonb_build_object('revision', previous.revision, 'ledger_events', 0, 'unchanged', true);
  end if;
  if previous.revision <> expected_revision then raise exception 'WORKSPACE_REVISION_CONFLICT'; end if;
  prior_atomic_owner := current_setting('app.hisaab_atomic_owner', true);
  perform set_config('app.hisaab_atomic_owner', uid::text, true);
  update public.workspaces set payload = save_workspace_with_ledger.payload, updated_at = now()
   where owner_id = uid returning revision into next_revision;
  perform set_config('app.hisaab_atomic_owner', coalesce(prior_atomic_owner, ''), true);
  return jsonb_build_object('revision', next_revision, 'ledger_events', 0, 'unchanged', false);
end $$;

create or replace function public.restore_workspace_with_ledger(payload jsonb, expected_revision bigint)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); previous public.workspaces%rowtype;
  next_revision bigint; prior_atomic_owner text;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if expected_revision is null or expected_revision < 1 then raise exception 'INVALID_EXPECTED_REVISION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hisaab-atomic:' || uid::text, 0));
  select * into previous from public.workspaces where owner_id = uid for update;
  if not found then raise exception 'WORKSPACE_NOT_INITIALIZED'; end if;
  if not exists(select 1 from public.workspace_ledger_modes where owner_id = uid and enabled) then raise exception 'LEDGER_MODE_DISABLED'; end if;
  perform public.validate_hisaab_snapshot_financial(payload);
  if previous.payload = payload then
    return jsonb_build_object('revision', previous.revision, 'ledger_events', 0, 'unchanged', true);
  end if;
  if previous.revision <> expected_revision then raise exception 'WORKSPACE_REVISION_CONFLICT'; end if;
  prior_atomic_owner := current_setting('app.hisaab_atomic_owner', true);
  perform set_config('app.hisaab_atomic_owner', uid::text, true);
  perform set_config('app.hisaab_restore_owner', uid::text, true);
  update public.workspaces set payload = restore_workspace_with_ledger.payload, updated_at = now()
   where owner_id = uid returning revision into next_revision;
  perform set_config('app.hisaab_restore_owner', '', true);
  perform set_config('app.hisaab_atomic_owner', coalesce(prior_atomic_owner, ''), true);
  return jsonb_build_object('revision', next_revision, 'ledger_events', 0, 'unchanged', false);
end $$;

revoke all on function public.save_workspace_with_ledger(jsonb, bigint) from public, anon;
grant execute on function public.save_workspace_with_ledger(jsonb, bigint) to authenticated;
revoke all on function public.restore_workspace_with_ledger(jsonb, bigint) from public, anon;
grant execute on function public.restore_workspace_with_ledger(jsonb, bigint) to authenticated;

commit;
