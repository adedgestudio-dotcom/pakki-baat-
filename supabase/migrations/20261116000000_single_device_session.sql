-- One active device per login. Logging in on a new device ends the user's other sessions.
-- Business team members each have their own login, so each member keeps one device.
-- Writes from a replaced session are rejected with SESSION_REPLACED.
-- Verified on staging before the owner runs it in production.
begin;

create or replace function public.claim_device_session()
returns integer language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare uid uuid := auth.uid(); sid uuid; n integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when others then sid := null; end;
  if sid is null then return 0; end if;
  delete from auth.sessions where user_id = uid and id <> sid;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.claim_device_session() from public, anon;
grant execute on function public.claim_device_session() to authenticated;

create or replace function public.assert_active_device_session()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare sid uuid;
begin
  if auth.uid() is null then return new; end if;
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when others then sid := null; end;
  if sid is null then return new; end if;
  if not exists(select 1 from auth.sessions where id = sid and user_id = auth.uid()) then
    raise exception 'SESSION_REPLACED';
  end if;
  return new;
end $$;
revoke all on function public.assert_active_device_session() from public, anon, authenticated;

drop trigger if exists a_assert_active_device_session on public.workspaces;
create trigger a_assert_active_device_session before insert or update on public.workspaces
for each row execute function public.assert_active_device_session();

commit;
