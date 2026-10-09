-- Phase 1B fictional-data test. Roll back all Auth, workspace, audit, and ledger fixtures.
begin;
do $$
declare v_owner_id uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; report jsonb; reconciliation jsonb; n integer;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase1b-fixture@example.test','not-used',now(),'{}','{}',now(),now());
  insert into public.workspaces(owner_id,payload) values(v_owner_id,jsonb_build_object('owner','Fixture','business','Fixture Co','jobs',jsonb_build_array(
    jsonb_build_object('id','job-a','customer','Asha Test','work','Fixture work','total',100,'paid',40,'date','2026-01-02','createdAt','2026-01-01T10:00:00Z','time','','status','Confirmed','source','fixture'),
    jsonb_build_object('id','job-b','customer','Bina Test','work','Legacy paid','total',50,'paid',20,'date','2026-01-03','time','','status','Confirmed','source','fixture'),
    jsonb_build_object('id','job-zero','customer','Zero Test','work','Zero','total',0,'paid',0,'date','2026-01-03','time','','status','Confirmed','source','fixture')
  ),'payments',jsonb_build_array(
    jsonb_build_object('id','11111111-2222-4333-8444-555555555555','customer','Asha Test','jobId','job-a','amount',40,'date','2026-01-02','createdAt','2026-01-02T00:00:00Z'),
    jsonb_build_object('id','old-string-payment','customer','Orphan Test','jobId','deleted-job','amount',10,'date','2026-01-04','createdAt','2026-01-04T00:00:00Z')
  )));
  perform set_config('request.jwt.claim.role','service_role',true); perform set_config('role','service_role',true);
  report:=public.backfill_hisaab_ledger_workspace(v_owner_id);
  if (report->>'inserted_charges')::int<>2 or (report->>'inserted_payments')::int<>3 then raise exception 'TEST FAILED: unexpected first-run counts: %',report; end if;
  select count(*) into n from public.hisaab_ledger_transactions l where l.owner_id=v_owner_id;
  if n<>5 then raise exception 'TEST FAILED: expected 5 ledger rows, got %',n; end if;
  perform public.backfill_hisaab_ledger_workspace(v_owner_id);
  select count(*) into n from public.hisaab_ledger_transactions l where l.owner_id=v_owner_id;
  if n<>5 then raise exception 'TEST FAILED: rerun duplicated ledger rows'; end if;
  if not exists(select 1 from public.hisaab_ledger_transactions l where l.owner_id=v_owner_id and l.metadata->>'legacy_payment_id'='old-string-payment' and l.source_payment_id is not null) then raise exception 'TEST FAILED: non-UUID payment ID was not preserved safely'; end if;
  if not exists(select 1 from public.hisaab_ledger_transactions l where l.owner_id=v_owner_id and l.metadata->>'legacy_payment_date_unknown'='true') then raise exception 'TEST FAILED: missing payment history was not labelled'; end if;
  reconciliation:=public.reconcile_hisaab_ledger_backfill(v_owner_id);
  if (reconciliation->>'source_job_charge_paise')::bigint<>15000 or (reconciliation->>'ledger_backfilled_charge_paise')::bigint<>15000 or (reconciliation->>'ledger_backfilled_payment_paise')::bigint<>7000 then raise exception 'TEST FAILED: reconciliation totals are incorrect: %',reconciliation; end if;
end $$;
rollback;
