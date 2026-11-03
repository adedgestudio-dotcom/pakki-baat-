-- New-account ledger activation. Fictional fixtures; every write is rolled back.
-- Like atomic_hisaab_save_foundation.sql, this inserts synthetic auth.users rows
-- inside the transaction only. Needs explicit approval before running on staging.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
do $$ begin
  if to_regprocedure('public.activate_new_owner_ledger_workspace()') is null then raise exception 'ACTIVATION_FUNCTION_REQUIRED'; end if;
  if not exists(select 1 from pg_trigger where tgname='activate_new_owner_ledger_workspace'
     and tgrelid='public.subscriptions'::regclass and not tgisinternal) then raise exception 'ACTIVATION_TRIGGER_REQUIRED'; end if;
end $$;
create temp table nal_results(name text primary key, passed boolean not null);
grant select, insert on nal_results to authenticated;
-- True when this backend holds the per-owner 'hisaab-atomic:' advisory lock.
-- Transaction-level advisory locks stay in pg_locks until commit or rollback, so a
-- false result proves the trigger never took the lock for that owner in this test.
-- A bigint key shows its high half in classid, its low half in objid, objsubid 1.
create function pg_temp.nal_holds_owner_lock(o uuid) returns boolean language sql as $$
  select exists(select 1 from pg_locks l,
      lateral (select hashtextextended('hisaab-atomic:'||o::text,0) k) h
    where l.locktype='advisory' and l.pid=pg_backend_pid() and l.objsubid=1
      and l.classid=((h.k>>32)&4294967295)::oid and l.objid=(h.k&4294967295)::oid)
$$;

do $$
declare
  new_trial uuid:='5a000000-0000-4000-8000-000000000001';
  new_admin uuid:='5a000000-0000-4000-8000-000000000002';
  pre_sub   uuid:='5a000000-0000-4000-8000-000000000003';
  legacy    uuid:='5a000000-0000-4000-8000-000000000004';
  has_ws    uuid:='5a000000-0000-4000-8000-000000000005';
  suspended uuid:='5a000000-0000-4000-8000-000000000006';
  new_paid  uuid:='5a000000-0000-4000-8000-000000000007';
  due_legacy uuid:='5a000000-0000-4000-8000-000000000008';
  due_new   uuid:='5a000000-0000-4000-8000-000000000009';
  empty_payload constant jsonb:='{"owner":"","business":"My small business","jobs":[],"reminders":[],"payments":[],"notes":[],"customerPhones":{}}';
  reply jsonb; ws public.workspaces%rowtype; before_ws public.workspaces%rowtype; o uuid;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','nal-'||right(id::text,1)||'@example.test','not-used',now(),'{}','{}',now(),now()
  from unnest(array[new_trial,new_admin,pre_sub,legacy,has_ws,suspended,new_paid,due_legacy,due_new]) id;

  -- 1. Brand-new owner claims a trial (subscription INSERT path).
  reply:=public.claim_trial(new_trial,'nal-fixture-device-0001',
    encode(sha256(convert_to('nal-fixture-email-0001','UTF8')),'hex'),
    encode(sha256(convert_to('nal-fixture-signature-0001','UTF8')),'hex'));
  if (reply->>'allowed')::boolean is distinct from true then raise exception 'TEST FAILED: new owner trial claim: %',reply; end if;
  -- 2. Brand-new owner gets an admin-granted trial (subscription INSERT path).
  reply:=public.admin_grant_trial(new_admin);
  if (reply->>'ok')::boolean is distinct from true then raise exception 'TEST FAILED: new owner admin grant: %',reply; end if;
  -- 3. Owner whose subscription row predates the trigger and who never saved (UPDATE path).
  --    A placeholder mode row keeps the INSERT from activating, then it is removed.
  insert into public.workspace_ledger_modes(owner_id,enabled,enabled_at) values(pre_sub,false,null);
  insert into public.subscriptions(owner_id) values(pre_sub);
  if exists(select 1 from public.workspaces where owner_id=pre_sub) then raise exception 'TEST FAILED: mode row did not block activation'; end if;
  delete from public.workspace_ledger_modes where owner_id=pre_sub;
  reply:=public.admin_grant_trial(pre_sub);
  if (reply->>'ok')::boolean is distinct from true then raise exception 'TEST FAILED: pre-existing subscription admin grant: %',reply; end if;
  -- 3a. Brand-new owner activated by a paid plan purchase (subscription INSERT path).
  reply:=public.activate_paid_plan(new_paid,'basic','purchase');
  if (reply->>'ok')::boolean is distinct from true or reply->>'action'<>'activated' then raise exception 'TEST FAILED: new owner paid activation: %',reply; end if;

  foreach o in array array[new_trial,new_admin,pre_sub,new_paid] loop
    select * into ws from public.workspaces where owner_id=o;
    if not found or ws.payload<>empty_payload or ws.revision<>1 then raise exception 'TEST FAILED: % empty workspace not created: %',o,ws; end if;
    if not exists(select 1 from public.workspace_ledger_modes where owner_id=o and enabled and enabled_at is not null) then
      raise exception 'TEST FAILED: % ledger mode not enabled',o;
    end if;
    if (select count(*) from public.hisaab_ledger_backfill_runs where owner_id=o and completed_at is not null)<>1
       or exists(select 1 from public.hisaab_ledger_backfill_issues where owner_id=o)
       or exists(select 1 from public.hisaab_ledger_transactions where owner_id=o) then
      raise exception 'TEST FAILED: % backfill audit trail wrong',o;
    end if;
  end loop;
  insert into pg_temp.nal_results values('trial claim activates a brand-new owner',true),
    ('admin grant activates a brand-new owner',true),('pre-existing subscription activates on update',true),
    ('paid plan purchase activates a brand-new owner',true);

  -- 4. Re-claim and re-grant for an already-activated owner change nothing.
  reply:=public.claim_trial(new_trial,'nal-fixture-device-0001',
    encode(sha256(convert_to('nal-fixture-email-0001','UTF8')),'hex'),
    encode(sha256(convert_to('nal-fixture-signature-0001','UTF8')),'hex'));
  if reply->>'reason' is distinct from 'trial_already_used_on_account' then raise exception 'TEST FAILED: repeat trial claim: %',reply; end if;
  reply:=public.admin_grant_trial(new_trial);
  if (reply->>'ok')::boolean is distinct from true then raise exception 'TEST FAILED: re-grant: %',reply; end if;
  if (select count(*) from public.hisaab_ledger_backfill_runs where owner_id=new_trial)<>1
     or (select revision from public.workspaces where owner_id=new_trial)<>1 then
    raise exception 'TEST FAILED: activated owner re-activated on subscription update';
  end if;
  insert into pg_temp.nal_results values('repeat claim and re-grant leave an activated owner unchanged',true);

  -- 5. Existing legacy owner (workspace row, no mode row) is untouched by grant and re-grant.
  --    The legacy guard forbids inserting financial data without ledger mode, so this
  --    fixture holds non-financial content only; the trigger checks row existence, not payload.
  insert into public.workspaces(owner_id,payload) values(legacy,
    '{"owner":"Legacy Fixture","business":"Legacy Test","jobs":[],"payments":[],"notes":[{"id":"note-1","customer":"Legacy Customer","text":"Nonfinancial","createdAt":"2026-01-01T00:00:00Z"}]}');
  select * into before_ws from public.workspaces where owner_id=legacy;
  insert into public.subscriptions(owner_id) values(legacy);
  reply:=public.admin_grant_trial(legacy);
  if (reply->>'ok')::boolean is distinct from true then raise exception 'TEST FAILED: legacy admin grant: %',reply; end if;
  select * into ws from public.workspaces where owner_id=legacy;
  if ws.payload<>before_ws.payload or ws.updated_at<>before_ws.updated_at or ws.revision<>before_ws.revision
     or exists(select 1 from public.workspace_ledger_modes where owner_id=legacy)
     or exists(select 1 from public.hisaab_ledger_backfill_runs where owner_id=legacy)
     or exists(select 1 from public.hisaab_ledger_transactions where owner_id=legacy) then
    raise exception 'TEST FAILED: legacy owner was changed';
  end if;
  insert into pg_temp.nal_results values('existing legacy owner untouched',true);

  -- 6. Owner who already has a workspace row can still claim a trial; the row is unchanged.
  insert into public.workspaces(owner_id,payload) values(has_ws,empty_payload);
  select * into before_ws from public.workspaces where owner_id=has_ws;
  reply:=public.claim_trial(has_ws,'nal-fixture-device-0005',
    encode(sha256(convert_to('nal-fixture-email-0005','UTF8')),'hex'),
    encode(sha256(convert_to('nal-fixture-signature-0005','UTF8')),'hex'));
  if (reply->>'allowed')::boolean is distinct from true then raise exception 'TEST FAILED: existing-workspace trial claim: %',reply; end if;
  select * into ws from public.workspaces where owner_id=has_ws;
  if ws.payload<>before_ws.payload or ws.updated_at<>before_ws.updated_at or ws.revision<>before_ws.revision
     or exists(select 1 from public.workspace_ledger_modes where owner_id=has_ws)
     or exists(select 1 from public.hisaab_ledger_backfill_runs where owner_id=has_ws) then
    raise exception 'TEST FAILED: owner with workspace row was changed';
  end if;
  insert into pg_temp.nal_results values('owner with existing workspace row unchanged',true);

  -- 7. Suspended mode row without a workspace: no workspace is created, mode stays suspended.
  insert into public.workspace_ledger_modes(owner_id,enabled,enabled_at) values(suspended,false,now());
  reply:=public.admin_grant_trial(suspended);
  if (reply->>'ok')::boolean is distinct from true then raise exception 'TEST FAILED: suspended admin grant: %',reply; end if;
  if exists(select 1 from public.workspaces where owner_id=suspended)
     or (select enabled from public.workspace_ledger_modes where owner_id=suspended) then
    raise exception 'TEST FAILED: suspended owner was activated';
  end if;
  insert into pg_temp.nal_results values('suspended mode row is never re-enabled',true);

  -- 7a. Daily pending-plan job over a legacy owner and a new-looking owner.
  --     Both rows are due: smart period ended, prepaid basic period pending.
  --     The placeholder mode row keeps the fixture INSERT from activating due_new.
  insert into public.workspaces(owner_id,payload) values(due_legacy,
    '{"owner":"Due Legacy","business":"Legacy Test","jobs":[],"payments":[],"notes":[]}');
  select * into before_ws from public.workspaces where owner_id=due_legacy;
  insert into public.workspace_ledger_modes(owner_id,enabled,enabled_at) values(due_new,false,null);
  insert into public.subscriptions(owner_id,plan,status,period_start,period_end,pending_plan,pending_period_end,updated_at)
    select f.fixture_owner,'smart','active',now()-interval '31 days',now()-interval '1 minute','basic',now()+interval '29 days',now()
    from unnest(array[due_legacy,due_new]) f(fixture_owner);
  delete from public.workspace_ledger_modes where owner_id=due_new;
  if exists(select 1 from public.workspaces where owner_id=due_new) then raise exception 'TEST FAILED: due fixture activated early'; end if;
  -- Runs over every due staging row; its writes roll back with this transaction.
  reply:=public.apply_due_pending_plans();
  if (reply->>'ok')::boolean is distinct from true then raise exception 'TEST FAILED: pending-plan job: %',reply; end if;
  if (select count(*) from public.subscriptions where owner_id in (due_legacy,due_new)
      and plan='basic' and pending_plan is null and period_end>now())<>2 then
    raise exception 'TEST FAILED: pending plans not applied to both fixtures';
  end if;
  select * into ws from public.workspaces where owner_id=due_new;
  if not found or ws.payload<>empty_payload or ws.revision<>1
     or not exists(select 1 from public.workspace_ledger_modes where owner_id=due_new and enabled and enabled_at is not null) then
    raise exception 'TEST FAILED: pending-plan job did not activate the new-looking owner';
  end if;
  select * into ws from public.workspaces where owner_id=due_legacy;
  if ws.payload<>before_ws.payload or ws.updated_at<>before_ws.updated_at or ws.revision<>before_ws.revision
     or exists(select 1 from public.workspace_ledger_modes where owner_id=due_legacy)
     or exists(select 1 from public.hisaab_ledger_backfill_runs where owner_id=due_legacy) then
    raise exception 'TEST FAILED: pending-plan job changed the legacy owner';
  end if;
  insert into pg_temp.nal_results values('pending-plan job activates only the new-looking owner',true);

  -- 7b. Subscription writes for existing owners never take the per-owner lock.
  --     Every helper above that takes 'hisaab-atomic:' for these owners would leave it
  --     held until rollback; the new owners prove the check can see the lock.
  if not pg_temp.nal_holds_owner_lock(new_trial) or not pg_temp.nal_holds_owner_lock(due_new) then
    raise exception 'TEST FAILED: lock probe cannot see the activation lock';
  end if;
  if pg_temp.nal_holds_owner_lock(legacy) or pg_temp.nal_holds_owner_lock(has_ws)
     or pg_temp.nal_holds_owner_lock(suspended) or pg_temp.nal_holds_owner_lock(due_legacy) then
    raise exception 'TEST FAILED: existing owner subscription write took the per-owner lock';
  end if;
  -- Columns outside plan, status and period_end do not fire the trigger at all.
  update public.subscriptions set bonus_voice_seconds=bonus_voice_seconds where owner_id=due_legacy;
  if pg_temp.nal_holds_owner_lock(due_legacy) then raise exception 'TEST FAILED: unrelated column update took the lock'; end if;
  insert into pg_temp.nal_results values('existing owner subscription writes take no per-owner lock',true);

  -- 8. Clients cannot call the trigger function.
  if has_function_privilege('public','public.activate_new_owner_ledger_workspace()','execute')
     or has_function_privilege('anon','public.activate_new_owner_ledger_workspace()','execute')
     or has_function_privilege('authenticated','public.activate_new_owner_ledger_workspace()','execute') then
    raise exception 'TEST FAILED: trigger function is executable by clients';
  end if;
  insert into pg_temp.nal_results values('trigger function not executable by public, anon or authenticated',true);
end $$;

-- 9. The activated new owner saves through the revision-checked RPC; legacy save stays blocked.
select set_config('request.jwt.claims','{"sub":"5a000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','5a000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare next_payload jsonb; reply jsonb;
begin
  select payload into next_payload from public.workspaces where owner_id=auth.uid();
  next_payload:=jsonb_set(next_payload,'{jobs}',
    '[{"id":"job-1","customer":"Asha Test","work":"Fixture","total":100,"paid":0,"date":"2026-01-01","time":"","status":"Confirmed","source":"fixture"}]'::jsonb);
  reply:=public.save_workspace_with_ledger(next_payload,1);
  if (reply->>'revision')::bigint<>2 or (reply->>'ledger_events')::int<>1 then raise exception 'TEST FAILED: first atomic save for new owner: %',reply; end if;
  if (select count(*) from public.hisaab_ledger_transactions where owner_id=auth.uid() and transaction_kind='charge')<>1 then
    raise exception 'TEST FAILED: new owner charge missing';
  end if;
  begin
    perform public.save_workspace(next_payload);
    raise exception 'TEST FAILED: legacy save bypassed new owner ledger mode';
  exception when others then
    if position('LEDGER_MODE_REQUIRES_ATOMIC_SAVE' in sqlerrm)=0 then raise; end if;
  end;
  insert into pg_temp.nal_results values('new owner atomic save succeeds and legacy save is blocked',true);
end $$;
reset role;
select count(*) as passed,0 as failed,jsonb_agg(name order by name) as cases from pg_temp.nal_results;
rollback;
