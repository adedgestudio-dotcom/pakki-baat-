-- Staging-only, rolled-back simulation of production's legacy schema capabilities.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ begin
 if not exists(select 1 from auth.users where id='740411d2-a2c9-4dd6-84ba-8679514d28fb' and email='ledger-staging-01@example.com') then raise exception 'STAGING_QA_REQUIRED'; end if;
end $$;
-- Existing ledger triggers are absent in the legacy production schema.
alter table public.workspaces disable trigger guard_atomic_hisaab_workspace_write;
alter table public.workspaces disable trigger validate_atomic_hisaab_entitlement;
alter table public.workspace_ledger_modes rename to rc_legacy_modes_hold;
select set_config('request.jwt.claims','{"sub":"740411d2-a2c9-4dd6-84ba-8679514d28fb","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','740411d2-a2c9-4dd6-84ba-8679514d28fb',true);
set local role authenticated;
do $$ declare p jsonb; changed jsonb; begin
 if to_regclass('public.workspace_ledger_modes') is not null then raise exception 'LEGACY_SIMULATION_FAILED'; end if;
 select payload into p from public.workspaces where owner_id=auth.uid();
 perform public.save_workspace(jsonb_set(p,'{owner}','"Legacy nonfinancial check"'));
 select payload into changed from public.workspaces where owner_id=auth.uid();
 if public.legacy_workspace_financial_state(p)<>public.legacy_workspace_financial_state(changed) then raise exception 'FINANCES_CHANGED'; end if;
 begin
  update public.workspaces set payload=jsonb_set(p,'{jobs,0,paid}',to_jsonb((p#>>'{jobs,0,paid}')::numeric+0.01)) where owner_id=auth.uid();
  raise exception 'DIRECT_BYPASS_ALLOWED';
 exception when others then if position('LEGACY_WORKSPACE_READ_ONLY' in sqlerrm)=0 then raise; end if; end;
 begin
  perform public.save_workspace(jsonb_set(p,'{jobs,0,total}',to_jsonb((p#>>'{jobs,0,total}')::numeric+1)));
  raise exception 'RPC_BYPASS_ALLOWED';
 exception when others then if position('LEGACY_WORKSPACE_READ_ONLY' in sqlerrm)=0 then raise; end if; end;
end $$;
reset role;
select 4 passed,0 failed,'No mode table; nonfinancial old RPC allowed; financial direct and old RPC writes blocked' evidence;
rollback;
