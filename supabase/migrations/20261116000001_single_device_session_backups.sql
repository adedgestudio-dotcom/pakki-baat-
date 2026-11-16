-- Replaced sessions also cannot create backups (manual, safety copies).
-- Cron backups have no auth.uid() and are not affected. Verified on staging.
drop trigger if exists a_assert_active_device_session on public.workspace_backups;
create trigger a_assert_active_device_session before insert on public.workspace_backups
for each row execute function public.assert_active_device_session();
