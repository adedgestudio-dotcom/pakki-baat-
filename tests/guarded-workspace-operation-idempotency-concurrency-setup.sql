-- STAGING-ONLY TWO-SESSION HARNESS. This file intentionally COMMITs a
-- disposable fixture so two independent test sessions can see it. The PowerShell
-- runner always invokes the matching cleanup file in finally; do not run this
-- file by itself and never run it against production.
\set ON_ERROR_STOP on
begin;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  :'owner'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'guarded-operation-concurrency-' || :'owner' || '@example.test', 'not-used', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

-- Enable ledger mode only after the workspace exists. The business plan keeps
-- fixture customer limits out of the concurrency assertions.
insert into public.workspaces(owner_id, payload, revision)
values (:'owner'::uuid, :'payload'::jsonb, 1);
insert into public.subscriptions(owner_id, plan, status, period_start, period_end, updated_at)
values (:'owner'::uuid, 'business', 'active', now() - interval '1 minute', now() + interval '1 day', now());
insert into public.workspace_ledger_modes(owner_id, enabled, enabled_at)
values (:'owner'::uuid, true, now());

commit;
