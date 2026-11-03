-- Activate revision-checked ledger saving for brand-new owners only.
-- Fires when a subscription row is inserted, or updated in plan, status or
-- period_end (trial claim, admin grant, paid activation, renewal, pending-plan
-- switch, default access row). An owner who already has a workspace row, any
-- workspace_ledger_modes row (enabled, disabled or suspended) or any ledger
-- history is never touched and never takes the per-owner lock.
-- Applying this migration changes no existing owner. Safe to re-run.
begin;
set local lock_timeout='5s';
do $$ begin
  if to_regprocedure('public.backfill_hisaab_ledger_workspace(uuid)') is null
     or to_regprocedure('public.enable_workspace_hisaab_ledger(uuid)') is null
     or to_regprocedure('public.save_workspace_with_ledger(jsonb,bigint)') is null
     or to_regprocedure('public.guard_legacy_workspace_financial_write()') is null then
    raise exception 'LEDGER_ACTIVATION_PREREQUISITES_REQUIRED';
  end if;
end $$;

create or replace function public.activate_new_owner_ledger_workspace() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
begin
  -- Fast path, no lock: any existing row means this is not a new owner. These rows
  -- are never removed for an owner, so a stale read can only skip activation.
  if exists(select 1 from public.workspaces where owner_id=new.owner_id)
     or exists(select 1 from public.workspace_ledger_modes where owner_id=new.owner_id)
     or exists(select 1 from public.hisaab_ledger_transactions where owner_id=new.owner_id) then
    return null;
  end if;
  -- Looks new: take the same per-owner lock as save_workspace_with_ledger and
  -- enable_workspace_hisaab_ledger, then re-check with a fresh snapshot.
  perform pg_advisory_xact_lock(hashtextextended('hisaab-atomic:'||new.owner_id::text,0));
  if exists(select 1 from public.workspaces where owner_id=new.owner_id)
     or exists(select 1 from public.workspace_ledger_modes where owner_id=new.owner_id)
     or exists(select 1 from public.hisaab_ledger_transactions where owner_id=new.owner_id) then
    return null;
  end if;
  -- Workspace first, while ledger mode is still off, so the legacy, atomic and
  -- entitlement guards on workspaces all accept an empty financial state.
  insert into public.workspaces(owner_id,payload)
    values(new.owner_id,'{"owner":"","business":"My small business","jobs":[],"reminders":[],"payments":[],"notes":[],"customerPhones":{}}'::jsonb);
  -- Reuse the reviewed activation path: an empty backfill run, then the full preflight.
  perform public.backfill_hisaab_ledger_workspace(new.owner_id);
  perform public.enable_workspace_hisaab_ledger(new.owner_id);
  return null;
end $$;
revoke all on function public.activate_new_owner_ledger_workspace() from public, anon, authenticated;

drop trigger if exists activate_new_owner_ledger_workspace on public.subscriptions;
create trigger activate_new_owner_ledger_workspace
  after insert or update of plan, status, period_end on public.subscriptions
  for each row execute function public.activate_new_owner_ledger_workspace();

commit;
