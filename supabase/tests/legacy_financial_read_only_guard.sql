-- Staging-only rollback tests. No account is created and all test mode/profile changes roll back.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
do $$ begin
  if not exists(select 1 from auth.users where id='740411d2-a2c9-4dd6-84ba-8679514d28fb'
    and email='ledger-staging-01@example.com') then raise exception 'STAGING_QA_IDENTITY_REQUIRED'; end if;
  if to_regprocedure('public.guard_legacy_workspace_financial_write()') is null then raise exception 'GUARD_REQUIRED'; end if;
end $$;
create temp table pb04_results(name text primary key, passed boolean not null);
create temp table pb04_baseline as
 select w.*,m.enabled,m.enabled_at from public.workspaces w
 join public.workspace_ledger_modes m using(owner_id)
 where w.owner_id='740411d2-a2c9-4dd6-84ba-8679514d28fb';
grant select on pb04_baseline to authenticated,service_role;
grant select,insert on pb04_results to authenticated,service_role;
create function pg_temp.pb04_reject(label text, command text, expected text) returns void
language plpgsql security invoker as $$
begin
  begin
    execute command;
  exception when others then
    if position(expected in sqlerrm)>0 then
      insert into pg_temp.pb04_results values(label,true); return;
    end if;
    raise exception 'UNEXPECTED_ERROR in %: %',label,sqlerrm;
  end;
  raise exception 'GUARD_TEST_UNEXPECTED_SUCCESS in %',label;
end $$;

-- This temporary mode is visible only inside this transaction; never committed.
update public.workspace_ledger_modes set enabled=false,enabled_at=null
 where owner_id='740411d2-a2c9-4dd6-84ba-8679514d28fb';
select set_config('request.jwt.claims','{"sub":"740411d2-a2c9-4dd6-84ba-8679514d28fb","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','740411d2-a2c9-4dd6-84ba-8679514d28fb',true);
set local role authenticated;
do $$
declare base jsonb; bad jsonb; projected jsonb; count_changed integer; item text; fields text[];
begin
  select payload into base from pg_temp.pb04_baseline;
  projected:=public.legacy_workspace_financial_state(base);
  bad:=jsonb_set(base,'{jobs,0,paid}',to_jsonb((base#>>'{jobs,0,paid}')::numeric+0.01));
  perform pg_temp.pb04_reject('legacy direct payment update',format(
    'update public.workspaces set payload=%L::jsonb where owner_id=auth.uid()',bad),'LEGACY_WORKSPACE_READ_ONLY');
  perform pg_temp.pb04_reject('old client save_workspace RPC',format(
    'select public.save_workspace(%L::jsonb)',bad),'LEGACY_WORKSPACE_READ_ONLY');
  perform pg_temp.pb04_reject('insert on conflict bypass',format(
    'insert into public.workspaces(owner_id,payload) values(auth.uid(),%L::jsonb) on conflict(owner_id) do update set payload=excluded.payload',bad),'LEGACY_WORKSPACE_READ_ONLY');
  perform pg_temp.pb04_reject('charge amount edit',format(
    'update public.workspaces set payload=jsonb_set(payload,''{jobs,0,total}'',''999999''::jsonb) where owner_id=auth.uid()'),'LEGACY_WORKSPACE_READ_ONLY');
  perform pg_temp.pb04_reject('job deletion bypass',format(
    'update public.workspaces set payload=%L::jsonb where owner_id=auth.uid()',jsonb_set(base,'{jobs}','[]'::jsonb)),'LEGACY_WORKSPACE_READ_ONLY');
  perform pg_temp.pb04_reject('payment deletion bypass',format(
    'update public.workspaces set payload=%L::jsonb where owner_id=auth.uid()',jsonb_set(base,'{payments}','[]'::jsonb)),'LEGACY_WORKSPACE_READ_ONLY');
  foreach item in array array['id','jobId','customer','amount','date','createdAt','correctionReason','correctionNote'] loop
    bad:=jsonb_set(base,array['payments','0',item],'"changed"'::jsonb,true);
    perform pg_temp.pb04_reject('payment field '||item,format(
      'update public.workspaces set payload=%L::jsonb where owner_id=auth.uid()',bad),'LEGACY_WORKSPACE_READ_ONLY');
  end loop;
  perform pg_temp.pb04_reject('owner reassignment',
    'update public.workspaces set owner_id=''0b10a8ff-425b-4dc2-9663-d0bfe39e3364'' where owner_id=auth.uid()','WORKSPACE_OWNER_IMMUTABLE');
  perform pg_temp.pb04_reject('invalid financial array',
    'update public.workspaces set payload=jsonb_set(payload,''{jobs}'',''null''::jsonb) where owner_id=auth.uid()','LEGACY_INVALID_FINANCIAL_STATE');
  perform set_config('app.hisaab_atomic_owner',auth.uid()::text,true);
  perform pg_temp.pb04_reject('spoofed atomic owner GUC',
    'update public.workspaces set payload=jsonb_set(payload,''{jobs,0,total}'',''1''::jsonb) where owner_id=auth.uid()','LEGACY_WORKSPACE_READ_ONLY');

  update public.workspaces set payload=base||'{"owner":"PB04 nonfinancial profile","business":"QA"}'::jsonb where owner_id=auth.uid();
  insert into pg_temp.pb04_results values('nonfinancial profile update',true);
  perform public.save_workspace(base||'{"notes":[],"reminders":[],"customerPhones":{}}'::jsonb);
  insert into pg_temp.pb04_results values('nonfinancial old RPC upsert',true);
  update public.workspaces set payload=jsonb_set(jsonb_set(base,'{jobs,0,work}','"Updated description"'::jsonb),'{jobs,0,status}','"Completed"'::jsonb) where owner_id=auth.uid();
  insert into pg_temp.pb04_results values('nonfinancial job description and status',true);
  update public.workspaces set payload=jsonb_set(base,'{payments,0,note}','"Nonfinancial note"'::jsonb,true) where owner_id=auth.uid();
  insert into pg_temp.pb04_results values('nonfinancial payment note',true);
  update public.workspaces set payload=jsonb_set(base,'{jobs}',(select jsonb_agg(j order by ord desc) from jsonb_array_elements(base->'jobs') with ordinality a(j,ord))) where owner_id=auth.uid();
  insert into pg_temp.pb04_results values('financial array order irrelevant',true);
  if (select public.legacy_workspace_financial_state(payload) from public.workspaces where owner_id=auth.uid()) is distinct from projected then
    raise exception 'FINANCIAL_STATE_CHANGED';
  end if;
  insert into pg_temp.pb04_results values('allowed updates preserve exact financial projection',true);
  delete from public.workspaces where owner_id=auth.uid();
  get diagnostics count_changed=row_count;
  if count_changed<>0 then raise exception 'DELETE_RLS_BYPASS'; end if;
  insert into pg_temp.pb04_results values('authenticated DELETE denied by existing RLS',true);
  update public.workspaces set payload='{}'::jsonb where owner_id='0b10a8ff-425b-4dc2-9663-d0bfe39e3364';
  get diagnostics count_changed=row_count;
  if count_changed<>0 then raise exception 'CROSS_ACCOUNT_RLS_BYPASS'; end if;
  insert into pg_temp.pb04_results values('cross account RLS preserved',true);
end $$;
reset role;

set local role service_role;
select pg_temp.pb04_reject('privileged DELETE still cannot erase legacy finances',
 'delete from public.workspaces where owner_id=''740411d2-a2c9-4dd6-84ba-8679514d28fb''','LEGACY_WORKSPACE_READ_ONLY');
reset role;
delete from public.workspace_ledger_modes where owner_id='740411d2-a2c9-4dd6-84ba-8679514d28fb';
set local role authenticated;
select pg_temp.pb04_reject('missing mode row fails closed',
 'update public.workspaces set payload=jsonb_set(payload,''{jobs,0,total}'',''1''::jsonb) where owner_id=auth.uid()','LEGACY_WORKSPACE_READ_ONLY');
reset role;

-- Restore the original mode within the same uncommitted test transaction.
insert into public.workspace_ledger_modes(owner_id,enabled,enabled_at)
 select owner_id,enabled,enabled_at from pg_temp.pb04_baseline;
set local role authenticated;
do $$
declare current_payload jsonb; current_revision bigint; reply jsonb;
begin
 select payload,revision into current_payload,current_revision from public.workspaces where owner_id=auth.uid();
 reply:=public.save_workspace_with_ledger(current_payload,current_revision);
 if (reply->>'unchanged')::boolean is distinct from true or (reply->>'ledger_events')::integer<>0 then
   raise exception 'LEDGER_RPC_CHANGED';
 end if;
 insert into pg_temp.pb04_results values('authenticated revisioned ledger RPC remains usable',true);
 perform pg_temp.pb04_reject('ledger direct write remains blocked',
  'update public.workspaces set payload=jsonb_set(payload,''{owner}'',''"bypass"''::jsonb) where owner_id=auth.uid()','LEDGER_MODE_REQUIRES_ATOMIC_SAVE');
end $$;
reset role;
select count(*) as passed,0 as failed,jsonb_agg(name order by name) as cases from pg_temp.pb04_results;
rollback;
