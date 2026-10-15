-- Session B: a distinct operation based on the same revision must wait, then
-- fail with a revision conflict. It must not write a receipt or payment.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', :'owner', true);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('guarded.test.operation_id', :'operation_id', true);
select pg_catalog.set_config('guarded.test.expected_revision', :'expected_revision', true);
select pg_catalog.set_config('guarded.test.payload', :'payload', true);
select pg_catalog.set_config('guarded.test.barrier_id', :'barrier_id', true);
do $$
declare
  v_started timestamptz := clock_timestamp();
  v_owner text := current_setting('request.jwt.claim.sub');
  v_barrier text := current_setting('guarded.test.barrier_id');
  v_owner_lock bigint := pg_catalog.hashtextextended('hisaab-atomic:' || v_owner, 0);
  v_ready_lock bigint := pg_catalog.hashtextextended('guarded-test-b-ready:' || v_owner || ':' || v_barrier, 0);
begin
  perform pg_catalog.pg_advisory_lock(v_ready_lock);
  if pg_catalog.pg_try_advisory_xact_lock(v_owner_lock) then
    raise exception 'SESSION_A_OWNER_LOCK_NOT_HELD_WHEN_B_BECAME_READY';
  end if;
  begin
    perform * from public.save_workspace_guarded_operation(
      current_setting('guarded.test.operation_id')::uuid,
      current_setting('guarded.test.expected_revision')::bigint,
      current_setting('guarded.test.payload')::jsonb
    );
    raise exception 'COMPETING_OPERATION_UNEXPECTEDLY_SUCCEEDED';
  exception when others then
    if position('WORKSPACE_REVISION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
  if clock_timestamp() - v_started < interval '500 milliseconds' then
    raise exception 'COMPETING_OPERATION_DID_NOT_OBSERVABLY_WAIT_FOR_LOCK';
  end if;
end;
$$;
commit;
