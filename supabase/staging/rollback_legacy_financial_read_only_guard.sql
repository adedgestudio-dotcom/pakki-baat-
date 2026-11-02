-- PB-04 emergency structural rollback. Never reopen unrevisioned writes.
-- SELECT remains available; the existing SECURITY DEFINER ledger RPC remains usable.
-- Authenticated direct writes stay revoked until a reviewed revision-safe replacement exists.
-- Recovery: recreate the guard first, then restore only the previously recorded
-- INSERT/UPDATE grants to authenticated in the same transaction. Never restore
-- DELETE or anonymous writes, and never restore grants while the guard is absent.
begin;
set local lock_timeout = '5s';
revoke insert, update, delete on public.workspaces from authenticated, anon;
drop trigger legacy_financial_read_only_guard on public.workspaces;
drop function public.guard_legacy_workspace_financial_write();
drop function public.legacy_workspace_financial_state(jsonb);
commit;
