-- Preserve the suspension guard already verified in staging when provisioning the foundation elsewhere.
begin;
set local lock_timeout='5s';
do $$ begin
 if to_regprocedure('public.save_workspace_with_ledger(jsonb,bigint)') is null then
  raise exception 'ATOMIC_HISAAB_FOUNDATION_REQUIRED';
 end if;
end $$;
create or replace function public.guard_atomic_hisaab_workspace_write() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare mode_enabled boolean; activated_at timestamptz; allowed_writer text;
begin
 if tg_op='UPDATE' then
  if new.owner_id is distinct from old.owner_id then raise exception 'WORKSPACE_OWNER_IMMUTABLE'; end if;
  new.revision:=old.revision+1;
 end if;
 select enabled,enabled_at into mode_enabled,activated_at from public.workspace_ledger_modes where owner_id=new.owner_id;
 if found and activated_at is not null and not mode_enabled then raise exception 'LEDGER_MODE_SUSPENDED'; end if;
 if coalesce(mode_enabled,false) then
  select pg_get_userbyid(p.proowner) into allowed_writer from pg_proc p where p.oid='public.save_workspace_with_ledger(jsonb,bigint)'::regprocedure;
  if current_user<>allowed_writer or current_setting('app.hisaab_atomic_owner',true) is distinct from new.owner_id::text then
   raise exception 'LEDGER_MODE_REQUIRES_ATOMIC_SAVE';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_atomic_hisaab_workspace_write() from public,anon,authenticated;
commit;
