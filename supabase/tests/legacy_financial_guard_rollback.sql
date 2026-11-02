-- Run only on staging with the PB-04 guard installed. Always roll back.
begin;
set local lock_timeout='3s';
create temp table pb04_rollback_results(name text,passed boolean);
grant select,insert on pb04_rollback_results to authenticated;
do $$ begin
 if not exists(select 1 from auth.users where id='740411d2-a2c9-4dd6-84ba-8679514d28fb' and email='ledger-staging-01@example.com')
 then raise exception 'STAGING_QA_IDENTITY_REQUIRED'; end if;
end $$;
revoke insert,update,delete on public.workspaces from authenticated,anon;
drop trigger legacy_financial_read_only_guard on public.workspaces;
drop function public.guard_legacy_workspace_financial_write();
drop function public.legacy_workspace_financial_state(jsonb);
select set_config('request.jwt.claims','{"sub":"740411d2-a2c9-4dd6-84ba-8679514d28fb","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','740411d2-a2c9-4dd6-84ba-8679514d28fb',true);
set local role authenticated;
do $$
declare payload jsonb; revision bigint; reply jsonb;
begin
 select w.payload,w.revision into payload,revision from public.workspaces w where owner_id=auth.uid();
 if payload is null then raise exception 'ROLLBACK_REMOVED_READ_ACCESS'; end if;
 insert into pg_temp.pb04_rollback_results values('rollback preserves authenticated reads',true);
 begin
  perform public.save_workspace(payload);
  raise exception 'ROLLBACK_REOPENED_UNSAFE_RPC';
 exception when insufficient_privilege then
  insert into pg_temp.pb04_rollback_results values('rollback keeps old RPC blocked',true);
 end;
 begin
  update public.workspaces w set payload=w.payload where owner_id=auth.uid();
  raise exception 'ROLLBACK_REOPENED_TABLE_WRITES';
 exception when insufficient_privilege then
  insert into pg_temp.pb04_rollback_results values('rollback keeps direct writes blocked',true);
 end;
 reply:=public.save_workspace_with_ledger(payload,revision);
 if (reply->>'unchanged')::boolean is distinct from true then raise exception 'ROLLBACK_BROKE_LEDGER_RPC'; end if;
 insert into pg_temp.pb04_rollback_results values('rollback preserves revisioned ledger RPC',true);
end $$;
reset role;
select count(*) as passed,0 as failed,jsonb_agg(name) as cases from pg_temp.pb04_rollback_results;
rollback;
