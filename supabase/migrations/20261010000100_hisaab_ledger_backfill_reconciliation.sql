-- Phase 1B reconciliation for the current legacy workspace snapshot.
create or replace function public.reconcile_hisaab_ledger_backfill(target_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare payload jsonb; source_charges bigint; source_recorded_payments bigint; source_job_paid bigint; ledger_charges bigint; ledger_payments bigint;
begin
  select w.payload into payload from public.workspaces w where w.owner_id=target_owner_id;
  if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
  select coalesce(sum(public.hisaab_ledger_backfill_paise(j->>'total')),0), coalesce(sum(public.hisaab_ledger_backfill_paise(j->>'paid')),0)
    into source_charges,source_job_paid from jsonb_array_elements(case when jsonb_typeof(payload->'jobs')='array' then payload->'jobs' else '[]'::jsonb end) j;
  select coalesce(sum(public.hisaab_ledger_backfill_paise(p->>'amount')),0)
    into source_recorded_payments from jsonb_array_elements(case when jsonb_typeof(payload->'payments')='array' then payload->'payments' else '[]'::jsonb end) p;
  select coalesce(sum(amount_paise) filter(where transaction_kind='charge'),0),coalesce(sum(amount_paise) filter(where transaction_kind='payment'),0)
    into ledger_charges,ledger_payments from public.hisaab_ledger_transactions
    where owner_id=target_owner_id and metadata->>'legacy_backfill'='true';
  return jsonb_build_object('source_job_charge_paise',source_charges,'source_job_paid_paise',source_job_paid,'source_recorded_payment_paise',source_recorded_payments,'ledger_backfilled_charge_paise',ledger_charges,'ledger_backfilled_payment_paise',ledger_payments,'charge_delta_paise',ledger_charges-source_charges,'payment_delta_vs_job_paid_paise',ledger_payments-source_job_paid,'payment_delta_vs_recorded_history_paise',ledger_payments-source_recorded_payments);
end; $$;
revoke all on function public.reconcile_hisaab_ledger_backfill(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_hisaab_ledger_backfill(uuid) to service_role;
