-- Disposable staging database only. Fictional fixtures and all changes roll back.
begin;

do $$
declare owner_a uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  owner_b uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  empty_snapshot jsonb := '{"owner":"Fixture","business":"Test","jobs":[],"payments":[],"reminders":[],"notes":[],"customerPhones":{}}'::jsonb;
begin
  if has_function_privilege('anon', 'public.suspend_workspace_hisaab_ledger(uuid)', 'EXECUTE') or
     has_function_privilege('authenticated', 'public.suspend_workspace_hisaab_ledger(uuid)', 'EXECUTE') or
     not has_function_privilege('service_role', 'public.suspend_workspace_hisaab_ledger(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: suspension RPC grants';
  end if;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (owner_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'atomic-suspend-a@example.test','not-used',now(),'{}','{}',now(),now()),
    (owner_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'atomic-suspend-b@example.test','not-used',now(),'{}','{}',now(),now());
  insert into public.subscriptions(owner_id) values(owner_a),(owner_b);
  insert into public.workspaces(owner_id,payload) values(owner_a,empty_snapshot),(owner_b,empty_snapshot);
  perform public.backfill_hisaab_ledger_workspace(owner_a);
  perform public.enable_workspace_hisaab_ledger(owner_a);
end $$;

set local role service_role;
do $$
declare owner_a uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd'; result jsonb;
  before_revision bigint; before_activated timestamptz;
begin
  select revision into before_revision from public.workspaces where owner_id=owner_a;
  select enabled_at into before_activated from public.workspace_ledger_modes where owner_id=owner_a;
  result := public.suspend_workspace_hisaab_ledger(owner_a);
  if result->>'enabled' <> 'false' or result->>'frozen' <> 'true' or
     (result->>'revision')::bigint <> before_revision then
    raise exception 'TEST FAILED: suspension result';
  end if;
  if (select revision from public.workspaces where owner_id=owner_a) <> before_revision or
     (select enabled_at from public.workspace_ledger_modes where owner_id=owner_a) is distinct from before_activated then
    raise exception 'TEST FAILED: suspension changed revision or activation audit';
  end if;
  if exists(select 1 from public.workspace_ledger_modes where owner_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') then
    raise exception 'TEST FAILED: other owner mode changed';
  end if;
end $$;

set local role authenticated;
do $$
declare owner_a uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  owner_b uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  empty_snapshot jsonb := '{"owner":"Fixture","business":"Test","jobs":[],"payments":[],"reminders":[],"notes":[],"customerPhones":{}}'::jsonb;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',owner_a::text,true);
  begin
    perform public.save_workspace(jsonb_set(empty_snapshot,'{business}','"Unsafe legacy"'::jsonb));
    raise exception 'TEST FAILED: suspended owner used legacy save';
  exception when others then
    if position('LEDGER_MODE_SUSPENDED' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.save_workspace_with_ledger(empty_snapshot,1);
    raise exception 'TEST FAILED: suspended owner used atomic save';
  exception when others then
    if position('LEDGER_MODE_DISABLED' in sqlerrm)=0 then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',owner_b::text,true);
  perform public.save_workspace(jsonb_set(empty_snapshot,'{business}','"Other owner"'::jsonb));
  if (select revision from public.workspaces where owner_id=owner_b) <> 2 or
     (select revision from public.workspaces where owner_id=owner_a) <> 1 then
    raise exception 'TEST FAILED: cross-account revision changed';
  end if;
end $$;

set local role service_role;
do $$
declare owner_a uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd'; result jsonb;
begin
  result := public.enable_workspace_hisaab_ledger(owner_a);
  if result->>'enabled' <> 'true' or (result->>'revision')::bigint <> 1 then
    raise exception 'TEST FAILED: clean reactivation';
  end if;
end $$;

set local role authenticated;
do $$
declare owner_a uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  initial jsonb; with_job jsonb; result jsonb;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',owner_a::text,true);
  select payload into initial from public.workspaces where owner_id=owner_a;
  with_job := jsonb_set(initial,'{jobs}',
    '[{"id":"suspend-job","customer":"Fictional Test","work":"Test","total":10,"paid":0,"date":"2026-01-01","time":"","status":"Confirmed","source":"fixture"}]'::jsonb);
  result := public.save_workspace_with_ledger(with_job,1);
  if (result->>'revision')::bigint <> 2 then raise exception 'TEST FAILED: financial save revision'; end if;
  result := public.save_workspace_with_ledger(initial,2);
  if (result->>'revision')::bigint <> 3 then raise exception 'TEST FAILED: deletion revision'; end if;
end $$;

set local role service_role;
do $$
declare owner_a uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  before_count integer; before_revision bigint; result jsonb;
begin
  select count(*) into before_count from public.hisaab_ledger_transactions where owner_id=owner_a;
  select revision into before_revision from public.workspaces where owner_id=owner_a;
  if before_count <> 1 then raise exception 'TEST FAILED: deleted job lost ledger history'; end if;
  result := public.suspend_workspace_hisaab_ledger(owner_a);
  if result->>'enabled' <> 'false' or result->>'frozen' <> 'true' or
     (result->>'ledger_rows_preserved')::integer <> before_count then
    raise exception 'TEST FAILED: financial-history suspension result';
  end if;
  if (select count(*) from public.hisaab_ledger_transactions where owner_id=owner_a) <> before_count or
     (select revision from public.workspaces where owner_id=owner_a) <> before_revision or
     (select enabled from public.workspace_ledger_modes where owner_id=owner_a) then
    raise exception 'TEST FAILED: suspension mutated financial state';
  end if;
  begin
    perform public.enable_workspace_hisaab_ledger(owner_a);
    raise exception 'TEST FAILED: live-history account reactivated without reconciliation';
  exception when others then
    if position('BACKFILL_NOT_CURRENT' in sqlerrm)=0 then raise; end if;
  end;
  if (select enabled from public.workspace_ledger_modes where owner_id=owner_a) then
    raise exception 'TEST FAILED: rejected reactivation enabled owner';
  end if;
end $$;

set local role authenticated;
do $$
declare owner_a uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  empty_snapshot jsonb := '{"owner":"Fixture","business":"Test","jobs":[],"payments":[],"reminders":[],"notes":[],"customerPhones":{}}'::jsonb;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',owner_a::text,true);
  begin
    perform public.save_workspace(jsonb_set(empty_snapshot,'{business}','"Unsafe after history"'::jsonb));
    raise exception 'TEST FAILED: legacy save accepted after history suspension';
  exception when others then
    if position('LEDGER_MODE_SUSPENDED' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.record_hisaab_ledger_transaction('suspend-job','Fictional Test','payment',100,
      now(),null,'33333333-3333-4333-8333-333333333333',null,'{}'::jsonb);
    raise exception 'TEST FAILED: ledger insert accepted after suspension';
  exception when others then
    if position('LEDGER_MODE_SUSPENDED' in sqlerrm)=0 then raise; end if;
  end;
end $$;

rollback;
