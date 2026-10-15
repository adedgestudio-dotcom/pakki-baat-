-- STAGING ONLY. Run only after applying 20261012000100 in an explicit
-- rollback-only transaction. Never run against production.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_other_owner uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_payload jsonb := jsonb_build_object(
    'jobs', '[]'::jsonb,
    'payments', '[]'::jsonb,
    'reminders', '[]'::jsonb,
    'notes', '[]'::jsonb,
    'customerPhones', '{}'::jsonb,
    'owner', '{}'::jsonb,
    'business', '{}'::jsonb
  );
begin
  -- These fixtures are intentionally inserted before SET ROLE authenticated
  -- and are removed by the transaction ROLLBACK below. If this test connection
  -- cannot create the fixture, it must fail rather than reuse staging data.
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'guarded-operation-owner@example.test', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_other_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'guarded-operation-other@example.test', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  -- Insert the workspaces before enabling ledger mode so the trusted guard and
  -- entitlement trigger apply only to the RPC assertions below.
  insert into public.workspaces(owner_id, payload, revision)
  values (v_owner, v_payload, 1), (v_other_owner, v_payload, 1);
  insert into public.subscriptions(owner_id, plan, status, period_start, period_end, updated_at)
  values
    (v_owner, 'business', 'active', now() - interval '1 minute', now() + interval '1 day', now()),
    (v_other_owner, 'business', 'active', now() - interval '1 minute', now() + interval '1 day', now());
  insert into public.workspace_ledger_modes(owner_id, enabled, enabled_at)
  values (v_owner, true, now()), (v_other_owner, true, now());

  perform pg_catalog.set_config('app.guarded_operation_owner', v_owner::text, true);
  perform pg_catalog.set_config('app.guarded_operation_other_owner', v_other_owner::text, true);
end;
$$;

set local role authenticated;

do $$
declare
  v_owner uuid := current_setting('app.guarded_operation_owner', true)::uuid;
  v_base bigint;
  v_payload jsonb;
  v_first record;
  v_retry record;
  v_next record;
  v_duplicate_payment jsonb := jsonb_build_object(
    'id', 'guarded-duplicate-payment',
    'customer', 'Fixture customer',
    'amount', 1,
    'date', '2026-10-12'
  );
  v_op_one uuid := '11111111-1111-4111-8111-111111111111';
  v_op_two uuid := '22222222-2222-4222-8222-222222222222';
  v_op_three uuid := '33333333-3333-4333-8333-333333333333';
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  select revision, payload into v_base, v_payload
    from public.workspaces where owner_id = v_owner;

  -- Exact retry returns the original receipt and advances revision only once.
  select * into v_first from public.save_workspace_guarded_operation(v_op_one, v_base, v_payload);
  select * into v_retry from public.save_workspace_guarded_operation(v_op_one, v_base, v_payload);
  if v_first.operation_id <> v_retry.operation_id
     or v_first.resulting_revision <> v_retry.resulting_revision
     or v_first.payload_sha256 <> v_retry.payload_sha256
     or v_first.resulting_snapshot_sha256 <> v_retry.resulting_snapshot_sha256
     or v_first.payload_sha256 <> pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'
     ) then
    raise exception 'Exact retry did not return the original receipt';
  end if;
  if (select revision from public.workspaces where owner_id = v_owner) <> v_base + 1 then
    raise exception 'No-op guarded operation did not advance revision exactly once';
  end if;

  begin
    perform * from public.save_workspace_guarded_operation(v_op_one, v_base, v_payload || '{"owner":"changed"}'::jsonb);
    raise exception 'Expected operation-ID payload mismatch rejection';
  exception when others then
    if position('OPERATION_ID_REUSED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform * from public.save_workspace_guarded_operation(v_op_two, v_base, v_payload);
    raise exception 'Expected stale revision rejection';
  exception when others then
    if position('WORKSPACE_REVISION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;

  -- A duplicate payment ID is rejected before any workspace/ledger write.
  begin
    perform * from public.save_workspace_guarded_operation(
      v_op_two,
      v_base + 1,
      v_payload || jsonb_build_object('payments', jsonb_build_array(v_duplicate_payment, v_duplicate_payment))
    );
    raise exception 'Expected duplicate payment rejection';
  exception when others then
    if position('INVALID_OR_DUPLICATE_PAYMENT_ID' in sqlerrm) = 0 then raise; end if;
  end;

  -- A rejected attempt may not reserve its operation ID or advance revision.
  -- This succeeds only if the duplicate-payment failure rolled back everything.
  select * into v_next from public.save_workspace_guarded_operation(v_op_two, v_base + 1, v_payload);
  if v_next.resulting_revision <> v_base + 2 then
    raise exception 'Rejected operation left a receipt or workspace mutation';
  end if;

  -- SEQUENTIAL conflict check only: a genuine two-session harness separately
  -- exercises lock waiting, same-operation exact retries, and competing writes.
  begin
    perform * from public.save_workspace_guarded_operation(v_op_three, v_base + 1, v_payload);
    raise exception 'Expected concurrent-peer stale revision rejection';
  exception when others then
    if position('WORKSPACE_REVISION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- RPC-only table protection and owner binding. A distinct owner cannot read a
-- receipt table at all, and an RPC call with another JWT cannot recover the
-- original owner receipt.
do $$
declare
  v_owner uuid := current_setting('app.guarded_operation_owner', true)::uuid;
  v_other uuid := current_setting('app.guarded_operation_other_owner', true)::uuid;
  v_other_payload jsonb;
  v_other_receipt record;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  begin
    perform 1 from public.workspace_operation_receipts where owner_id = v_owner;
    raise exception 'Cross-owner receipt table read was allowed';
  exception when insufficient_privilege then
    null;
  end;
  -- Same operation ID is independent per owner. The other controlled owner
  -- gets only its own receipt, never the first fixture owner's receipt.
  select payload into v_other_payload from public.workspaces where owner_id = v_other;
  select * into v_other_receipt from public.save_workspace_guarded_operation(
    '11111111-1111-4111-8111-111111111111', 1, v_other_payload
  );
  if v_other_receipt.owner_id <> v_other
     or v_other_receipt.operation_id <> '11111111-1111-4111-8111-111111111111'::uuid
     or v_other_receipt.resulting_revision <> 2 then
    raise exception 'Cross-owner RPC did not bind receipt to authenticated fixture owner';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
end;
$$;

-- Any exception after a nested ledger/workspace write rolls back the whole RPC.
-- The migration's receipt INSERT is in that same transaction; staging review
-- must additionally run a two-session concurrency harness before activation.
rollback;
