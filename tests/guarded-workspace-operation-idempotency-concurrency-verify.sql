-- Verify the two-session outcomes while still authenticated as the fixture
-- owner. This is intentionally separate from the worker sessions so the
-- harness asserts durable outcomes, not merely psql exit codes.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', :'owner', true);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('guarded.test.owner', :'owner', true);
select pg_catalog.set_config('guarded.test.same_operation', :'same_operation', true);
select pg_catalog.set_config('guarded.test.winner_operation', :'winner_operation', true);
select pg_catalog.set_config('guarded.test.loser_operation', :'loser_operation', true);
do $$
declare
  v_owner uuid := current_setting('guarded.test.owner')::uuid;
  v_same uuid := current_setting('guarded.test.same_operation')::uuid;
  v_winner uuid := current_setting('guarded.test.winner_operation')::uuid;
  v_loser uuid := current_setting('guarded.test.loser_operation')::uuid;
  v_payload jsonb := jsonb_build_object(
    'jobs', '[]'::jsonb, 'payments', '[]'::jsonb, 'reminders', '[]'::jsonb,
    'notes', '[]'::jsonb, 'customerPhones', '{}'::jsonb, 'owner', '{}'::jsonb, 'business', '{}'::jsonb
  );
  v_expected_persisted_payload jsonb :=
    '{"business":{},"customerPhones":{},"jobs":[],"notes":[],"owner":{},"payments":[],"reminders":[]}'::jsonb;
  v_expected_request_sha256 text := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'
  );
  v_expected_snapshot_sha256 text := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_expected_persisted_payload::text, 'UTF8'), 'sha256'), 'hex'
  );
  v_same_receipt public.workspace_operation_receipts%rowtype;
begin
  if (select count(*) from public.workspace_operation_receipts where owner_id = v_owner and operation_id = v_same) <> 1 then
    raise exception 'SAME_OPERATION_DID_NOT_CREATE_EXACTLY_ONE_RECEIPT';
  end if;
  select * into v_same_receipt from public.workspace_operation_receipts
   where owner_id = v_owner and operation_id = v_same;
  if v_same_receipt.base_revision <> 1
     or v_same_receipt.resulting_revision <> 2
     or v_same_receipt.payload_sha256 <> v_expected_request_sha256
     or v_same_receipt.resulting_snapshot_sha256 <> v_expected_snapshot_sha256 then
    raise exception 'SAME_OPERATION_RECEIPT_IDENTITY_OR_DIGEST_INVALID';
  end if;
  if (select count(*) from public.workspace_operation_receipts where owner_id = v_owner and operation_id = v_winner) <> 1
     or exists(select 1 from public.workspace_operation_receipts where owner_id = v_owner and operation_id = v_loser) then
    raise exception 'COMPETING_OPERATION_RECEIPT_OUTCOME_INVALID';
  end if;
  if (select revision from public.workspaces where owner_id = v_owner) <> 3 then
    raise exception 'TWO_SESSION_REVISION_OUTCOME_INVALID';
  end if;
end;
$$;
rollback;
