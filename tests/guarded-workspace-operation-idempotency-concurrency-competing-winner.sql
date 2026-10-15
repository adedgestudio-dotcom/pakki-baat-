-- Session A for competing operation IDs. It holds the common owner lock after
-- a successful write, which validates the guarded RPC's owner-lock-first order.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', :'owner', true);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('guarded.test.barrier_id', :'barrier_id', true);
select * from public.save_workspace_guarded_operation(:'operation_id'::uuid, :'expected_revision'::bigint, :'payload'::jsonb);
do $$
declare
  v_barrier text := current_setting('guarded.test.barrier_id');
  v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
  v_key bigint := pg_catalog.hashtextextended('guarded-test-b-ready:' || current_setting('request.jwt.claim.sub') || ':' || v_barrier, 0);
begin
  loop
    if not pg_catalog.pg_try_advisory_lock(v_key) then return; end if;
    perform pg_catalog.pg_advisory_unlock(v_key);
    if clock_timestamp() >= v_deadline then
      raise exception 'SESSION_B_READINESS_SIGNAL_TIMEOUT';
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
end;
$$;
commit;
