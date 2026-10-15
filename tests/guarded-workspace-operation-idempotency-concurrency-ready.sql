-- Read-only readiness probe. It succeeds only while Session A holds the exact
-- owner-level lock used by both the legacy and guarded RPCs. If this probe can
-- acquire the lock, it releases it by rollback and returns NOT_READY.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;
set local lock_timeout = '1s';
set local statement_timeout = '3s';
select case
  when pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('hisaab-atomic:' || :'owner', 0)
  ) then 'NOT_READY'
  else 'READY'
end;
rollback;
