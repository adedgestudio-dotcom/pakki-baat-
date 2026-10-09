-- Phase 1B: service-role-only, append-only import of the current workspace JSON.
-- It never updates public.workspaces or existing ledger rows.
begin;

create table if not exists public.hisaab_ledger_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_updated_at timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object')
);
create index if not exists hisaab_ledger_backfill_runs_owner_started_idx
  on public.hisaab_ledger_backfill_runs(owner_id, started_at desc);

create table if not exists public.hisaab_ledger_backfill_issues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hisaab_ledger_backfill_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('job','payment','workspace')),
  source_id text,
  issue_code text not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists hisaab_ledger_backfill_issues_owner_run_idx
  on public.hisaab_ledger_backfill_issues(owner_id, run_id, created_at);

alter table public.hisaab_ledger_backfill_runs enable row level security;
alter table public.hisaab_ledger_backfill_issues enable row level security;
revoke all on public.hisaab_ledger_backfill_runs, public.hisaab_ledger_backfill_issues from public, anon, authenticated;
grant select on public.hisaab_ledger_backfill_runs, public.hisaab_ledger_backfill_issues to authenticated;
drop policy if exists hisaab_ledger_backfill_runs_read_own on public.hisaab_ledger_backfill_runs;
create policy hisaab_ledger_backfill_runs_read_own on public.hisaab_ledger_backfill_runs for select to authenticated using (owner_id = auth.uid());
drop policy if exists hisaab_ledger_backfill_issues_read_own on public.hisaab_ledger_backfill_issues;
create policy hisaab_ledger_backfill_issues_read_own on public.hisaab_ledger_backfill_issues for select to authenticated using (owner_id = auth.uid());

-- Stable UUIDs permit Phase 1A's UUID idempotency/source constraints to represent
-- old string IDs. The original ID remains visible in immutable metadata.
create or replace function public.hisaab_ledger_backfill_uuid(value text) returns uuid
language sql immutable strict set search_path = public, pg_temp as $$
  select (substr(md5(value),1,8)||'-'||substr(md5(value),9,4)||'-'||substr(md5(value),13,4)||'-'||substr(md5(value),17,4)||'-'||substr(md5(value),21,12))::uuid
$$;

create or replace function public.hisaab_ledger_backfill_paise(value text) returns bigint
language plpgsql immutable set search_path = public, pg_temp as $$
declare n numeric;
begin
  if value is null or length(value) > 30 or value !~ '^[0-9]+(\.[0-9]{1,2})?$' then return null; end if;
  n := round(value::numeric * 100);
  if n <= 0 or n > 9223372036854775807 then return null; end if;
  return n::bigint;
end; $$;

create or replace function public.hisaab_ledger_backfill_date(value text) returns timestamptz
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if value is null or btrim(value) = '' then return null; end if;
  begin
    if value ~ '^\d{4}-\d{2}-\d{2}$' then return (value::date::timestamp at time zone 'UTC'); end if;
    return value::timestamptz;
  exception when others then return null;
  end;
end; $$;

-- This deliberately bypasses the user-facing Phase 1A RPC: historical import
-- needs a service-authorized target owner and legacy non-UUID identifiers.
create or replace function public.backfill_hisaab_ledger_workspace(target_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  workspace public.workspaces%rowtype; run_id uuid; item jsonb; job jsonb; payment jsonb;
  job_id text; customer text; payment_id text; idempotency uuid; source_id uuid;
  amount bigint; linked_paid bigint; occurred timestamptz; metadata jsonb; fingerprint text;
  inserted_charges integer:=0; inserted_payments integer:=0; existing_rows integer:=0; issues integer:=0;
  total_charges bigint:=0; total_payments bigint:=0;
begin
  if target_owner_id is null then raise exception 'TARGET_OWNER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hisaab-backfill:' || target_owner_id::text, 0));
  select * into workspace from public.workspaces where owner_id=target_owner_id for share;
  if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
  if jsonb_typeof(workspace.payload) <> 'object' then raise exception 'INVALID_WORKSPACE_PAYLOAD'; end if;
  insert into public.hisaab_ledger_backfill_runs(owner_id,workspace_updated_at) values(target_owner_id,workspace.updated_at) returning id into run_id;

  -- Charges are based on each surviving job's current historical total. Deleted
  -- jobs/customers are absent from JSON and are intentionally not reconstructed.
  for item in select value from jsonb_array_elements(case when jsonb_typeof(workspace.payload->'jobs')='array' then workspace.payload->'jobs' else '[]'::jsonb end) loop
    job_id:=nullif(btrim(item->>'id'),''); customer:=btrim(coalesce(item->>'customer',''));
    amount:=public.hisaab_ledger_backfill_paise(item->>'total');
    if job_id is null or length(job_id)>120 or customer='' or length(customer)>100 or amount is null then
      insert into public.hisaab_ledger_backfill_issues(run_id,owner_id,source_kind,source_id,issue_code,detail)
      values(run_id,target_owner_id,'job',job_id,'invalid_or_zero_value_job',jsonb_build_object('customer',customer,'total',item->>'total'));
      issues:=issues+1; continue;
    end if;
    occurred:=coalesce(public.hisaab_ledger_backfill_date(item->>'createdAt'), public.hisaab_ledger_backfill_date(item->>'date'), workspace.updated_at);
    fingerprint:=md5(item::text); idempotency:=public.hisaab_ledger_backfill_uuid(target_owner_id::text||':phase1b:job:'||job_id);
    metadata:=jsonb_build_object('legacy_backfill',true,'legacy_record_type','job','legacy_job_id',job_id,'legacy_source_fingerprint',fingerprint,'event_time_source',case when public.hisaab_ledger_backfill_date(item->>'createdAt') is not null then 'createdAt' when public.hisaab_ledger_backfill_date(item->>'date') is not null then 'job_date' else 'workspace_updated_at_unknown' end);
    if exists(select 1 from public.hisaab_ledger_transactions l where l.owner_id=target_owner_id and l.idempotency_key=idempotency) then
      select to_jsonb(l) into job from public.hisaab_ledger_transactions l where l.owner_id=target_owner_id and l.idempotency_key=idempotency;
      if (job->>'amount_paise')::bigint <> amount or job->'metadata'->>'legacy_source_fingerprint' <> fingerprint then
        insert into public.hisaab_ledger_backfill_issues(run_id,owner_id,source_kind,source_id,issue_code,detail) values(run_id,target_owner_id,'job',job_id,'historical_record_changed_after_backfill',jsonb_build_object('existing_ledger_row',job->>'id'));
        issues:=issues+1;
      else existing_rows:=existing_rows+1; end if;
    else
      insert into public.hisaab_ledger_transactions(owner_id,job_id,customer_name,transaction_kind,amount_paise,occurred_at,idempotency_key,metadata)
      values(target_owner_id,job_id,customer,'charge',amount,occurred,idempotency,metadata);
      inserted_charges:=inserted_charges+1; total_charges:=total_charges+amount;
    end if;
  end loop;

  -- Each recorded payment is preserved independently, including unmatched job IDs.
  for item in select value from jsonb_array_elements(case when jsonb_typeof(workspace.payload->'payments')='array' then workspace.payload->'payments' else '[]'::jsonb end) loop
    payment_id:=nullif(btrim(item->>'id'),''); customer:=btrim(coalesce(item->>'customer','')); job_id:=nullif(btrim(item->>'jobId'),''); amount:=public.hisaab_ledger_backfill_paise(item->>'amount');
    if payment_id is null or customer='' or length(customer)>100 or amount is null or public.hisaab_ledger_backfill_date(item->>'date') is null then
      insert into public.hisaab_ledger_backfill_issues(run_id,owner_id,source_kind,source_id,issue_code,detail) values(run_id,target_owner_id,'payment',payment_id,'invalid_payment_record',jsonb_build_object('amount',item->>'amount','date',item->>'date'));
      issues:=issues+1; continue;
    end if;
    occurred:=public.hisaab_ledger_backfill_date(item->>'date'); fingerprint:=md5(item::text);
    idempotency:=public.hisaab_ledger_backfill_uuid(target_owner_id::text||':phase1b:payment:'||payment_id);
    source_id:=case when payment_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then payment_id::uuid else public.hisaab_ledger_backfill_uuid(target_owner_id::text||':legacy-payment:'||payment_id) end;
    metadata:=jsonb_build_object('legacy_backfill',true,'legacy_record_type','payment','legacy_payment_id',payment_id,'legacy_source_fingerprint',fingerprint,'legacy_recorded_date',item->>'date','job_match_status',case when job_id is null then 'unassigned' when exists(select 1 from jsonb_array_elements(case when jsonb_typeof(workspace.payload->'jobs')='array' then workspace.payload->'jobs' else '[]'::jsonb end) j where j->>'id'=job_id) then 'matched' else 'unmatched' end);
    if exists(select 1 from public.hisaab_ledger_transactions l where l.owner_id=target_owner_id and l.idempotency_key=idempotency) then existing_rows:=existing_rows+1;
    else
      insert into public.hisaab_ledger_transactions(owner_id,job_id,customer_name,transaction_kind,amount_paise,occurred_at,source_payment_id,idempotency_key,metadata)
      values(target_owner_id,job_id,customer,'payment',amount,occurred,source_id,idempotency,metadata);
      inserted_payments:=inserted_payments+1; total_payments:=total_payments+amount;
    end if;
  end loop;

  -- When a job says paid but no linked payment history explains it, retain the
  -- amount as a labelled legacy payment. Its timestamp is explicitly the workspace
  -- snapshot time, never asserted to be the actual historical payment date.
  for item in select value from jsonb_array_elements(case when jsonb_typeof(workspace.payload->'jobs')='array' then workspace.payload->'jobs' else '[]'::jsonb end) loop
    job_id:=nullif(btrim(item->>'id'),''); customer:=btrim(coalesce(item->>'customer','')); amount:=public.hisaab_ledger_backfill_paise(item->>'paid');
    if job_id is null or customer='' or amount is null then continue; end if;
    select coalesce(sum(public.hisaab_ledger_backfill_paise(p->>'amount')),0) into linked_paid from jsonb_array_elements(case when jsonb_typeof(workspace.payload->'payments')='array' then workspace.payload->'payments' else '[]'::jsonb end) p where p->>'jobId'=job_id;
    if amount <= linked_paid then continue; end if;
    amount:=amount-linked_paid; idempotency:=public.hisaab_ledger_backfill_uuid(target_owner_id::text||':phase1b:missing-payment:'||job_id);
    metadata:=jsonb_build_object('legacy_backfill',true,'legacy_record_type','missing_payment_history','legacy_job_id',job_id,'legacy_payment_date_unknown',true,'event_time_source','workspace_updated_at_not_payment_date','snapshot_paid_paise',public.hisaab_ledger_backfill_paise(item->>'paid'),'linked_payment_paise',linked_paid);
    if exists(select 1 from public.hisaab_ledger_transactions l where l.owner_id=target_owner_id and l.idempotency_key=idempotency) then existing_rows:=existing_rows+1;
    else insert into public.hisaab_ledger_transactions(owner_id,job_id,customer_name,transaction_kind,amount_paise,occurred_at,idempotency_key,metadata) values(target_owner_id,job_id,customer,'payment',amount,workspace.updated_at,idempotency,metadata); inserted_payments:=inserted_payments+1; total_payments:=total_payments+amount; end if;
  end loop;

  update public.hisaab_ledger_backfill_runs set completed_at=now(),report=jsonb_build_object('inserted_charges',inserted_charges,'inserted_payments',inserted_payments,'existing_rows',existing_rows,'issues',issues,'inserted_charge_paise',total_charges,'inserted_payment_paise',total_payments,'ledger_balance_paise',total_charges-total_payments) where id=run_id;
  return (select report || jsonb_build_object('run_id',run_id) from public.hisaab_ledger_backfill_runs where id=run_id);
end; $$;

revoke all on function public.backfill_hisaab_ledger_workspace(uuid), public.hisaab_ledger_backfill_uuid(text), public.hisaab_ledger_backfill_paise(text), public.hisaab_ledger_backfill_date(text) from public, anon, authenticated;
grant execute on function public.backfill_hisaab_ledger_workspace(uuid) to service_role;
commit;
