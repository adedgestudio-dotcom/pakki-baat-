-- Workspace backups are a signed-in self-service operation. The function is
-- SECURITY DEFINER so it can retain a user's snapshots while bypassing direct
-- table writes; anonymous callers must never receive EXECUTE permission.
revoke execute on function public.save_workspace_backup(jsonb, text) from public, anon;
grant execute on function public.save_workspace_backup(jsonb, text) to authenticated;
