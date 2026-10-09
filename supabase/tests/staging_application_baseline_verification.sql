-- Read-only verification for 20261009000000_staging_application_baseline.sql.
-- Run only after the migration, against the linked staging project. No fixtures or
-- application rows are inserted; the transaction is rolled back unconditionally.
begin;

do $$
declare
  required_tables text[] := array[
    'workspaces','profiles','subscriptions','ai_usage','ai_monthly_usage',
    'ai_period_usage','business_workspaces','workspace_members','payment_requests',
    'trial_claims','trial_owner_claims','trial_email_claims',
    'trial_device_signature_claims','trial_expiry_email_log','workspace_backups',
    'hisaab_ledger_transactions'
  ];
  table_name text;
  fn regprocedure;
begin
  foreach table_name in array required_tables loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'Missing required table: %', table_name;
    end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=table_name and c.relrowsecurity) then
      raise exception 'RLS is not enabled on: %', table_name;
    end if;
  end loop;

  foreach fn in array array[
    'public.save_workspace(jsonb)'::regprocedure,
    'public.save_workspace_backup(jsonb,text)'::regprocedure,
    'public.consume_ai_usage(uuid,integer,integer)'::regprocedure,
    'public.claim_trial(uuid,text,text,text)'::regprocedure,
    'public.record_hisaab_ledger_transaction(text,text,text,bigint,timestamp with time zone,uuid,uuid,uuid,jsonb)'::regprocedure
  ] loop
    if fn is null then raise exception 'Missing required RPC'; end if;
  end loop;

  if not has_table_privilege('anon','public.workspaces','select,insert,update,delete') then
    null;
  else
    raise exception 'anon unexpectedly has workspace table privileges';
  end if;
  if not has_function_privilege('authenticated','public.save_workspace(jsonb)','execute') then
    raise exception 'authenticated cannot save its workspace';
  end if;
  if has_function_privilege('anon','public.save_workspace(jsonb)','execute') then
    raise exception 'anon can call save_workspace';
  end if;
  if not has_function_privilege('authenticated','public.save_workspace_backup(jsonb,text)','execute') then
    raise exception 'authenticated cannot save workspace backups';
  end if;
  if has_function_privilege('anon','public.record_hisaab_ledger_transaction(text,text,text,bigint,timestamp with time zone,uuid,uuid,uuid,jsonb)','execute') then
    raise exception 'anon can write ledger entries';
  end if;
  if not has_function_privilege('authenticated','public.record_hisaab_ledger_transaction(text,text,text,bigint,timestamp with time zone,uuid,uuid,uuid,jsonb)','execute') then
    raise exception 'authenticated ledger RPC permission missing';
  end if;
  if not exists (select 1 from storage.buckets where id='payment-proofs' and public=false and file_size_limit=5242880) then
    raise exception 'payment-proofs bucket is missing or unsafe';
  end if;
end $$;

rollback;
