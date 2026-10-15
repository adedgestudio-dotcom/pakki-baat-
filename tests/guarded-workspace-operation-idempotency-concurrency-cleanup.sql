-- Remove only the UUID-addressed disposable fixture created by the companion
-- setup script. This is called from the runner's finally block.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';
delete from auth.users
 where id = :'owner'::uuid
   and email = :'email'
   and email = 'guarded-operation-concurrency-' || :'owner' || '@example.test';
commit;
