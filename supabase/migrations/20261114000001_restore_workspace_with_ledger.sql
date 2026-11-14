-- Restore a whole-workspace backup in ledger mode.
-- Unlike save_workspace_with_ledger, this accepts job and payment ids that were
-- removed earlier, and brings the ledger in line with the restored snapshot by
-- adding reversal/charge/payment rows. The normal save path is not changed.
-- Verified on staging before the owner runs it in production.
begin;
create or replace function public.restore_workspace_with_ledger(payload jsonb, expected_revision bigint)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  previous public.workspaces%rowtype;
  prior jsonb;
  item jsonb;
  tx public.hisaab_ledger_transactions%rowtype;
  key text; cust text; job text; pid text;
  amount bigint; active_count integer; active_sum bigint;
  event_time timestamptz; matched boolean;
  next_revision bigint; inserted_count integer := 0;
  prior_atomic_owner text; meta jsonb;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if expected_revision is null or expected_revision < 1 then raise exception 'INVALID_EXPECTED_REVISION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hisaab-atomic:' || uid::text, 0));
  select * into previous from public.workspaces where owner_id = uid for update;
  if not found then raise exception 'WORKSPACE_NOT_INITIALIZED'; end if;
  if not exists(select 1 from public.workspace_ledger_modes where owner_id = uid and enabled) then
    raise exception 'LEDGER_MODE_DISABLED';
  end if;
  perform public.validate_hisaab_snapshot_financial(payload);
  if previous.payload = payload then
    return jsonb_build_object('revision', previous.revision, 'ledger_events', 0, 'unchanged', true);
  end if;
  if previous.revision <> expected_revision then raise exception 'WORKSPACE_REVISION_CONFLICT'; end if;
  prior := previous.payload;
  prior_atomic_owner := current_setting('app.hisaab_atomic_owner', true);
  perform set_config('app.hisaab_atomic_owner', uid::text, true);
  meta := jsonb_build_object('origin', 'live_atomic', 'reason', 'backup_restore', 'workspace_revision', expected_revision + 1);

  -- 1) Active payments that the restored snapshot does not contain.
  --    Reverse them when their job is restored, or when they were live just
  --    before the restore and their job/customer still exists (same rule as a
  --    normal removal). History of fully removed customers is left alone.
  for tx in
    select l.* from public.hisaab_ledger_transactions l
     where l.owner_id = uid and l.transaction_kind = 'payment'
       and coalesce(l.metadata->>'payment_id', l.metadata->>'legacy_payment_id') is not null
       and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id = l.id)
       and not exists(select 1 from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb)) p
                       where p->>'id' = l.metadata->>'payment_id' or p->>'id' = l.metadata->>'legacy_payment_id')
       and (
         exists(select 1 from jsonb_array_elements(payload->'jobs') j where j->>'id' = l.job_id)
         or exists(select 1 from jsonb_array_elements(coalesce(prior->'payments', '[]'::jsonb)) op
                    where (op->>'id' = l.metadata->>'payment_id' or op->>'id' = l.metadata->>'legacy_payment_id')
                      and exists(select 1 from jsonb_array_elements(payload->'jobs') j
                                  where j->>'id' = op->>'jobId' or j->>'customer' = op->>'customer'))
       )
     order by l.created_at, l.id
  loop
    pid := coalesce(tx.metadata->>'payment_id', tx.metadata->>'legacy_payment_id');
    perform public.record_hisaab_ledger_transaction(tx.job_id, tx.customer_name, 'reversal', tx.amount_paise, now(), null,
      public.hisaab_ledger_backfill_uuid(uid::text || ':restore:' || expected_revision || ':reverse:' || tx.id::text), tx.id,
      meta || jsonb_build_object('payment_id', pid));
    inserted_count := inserted_count + 1;
  end loop;

  -- 2) Every restored payment must have exactly one matching active ledger row.
  for item in select value from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb)) loop
    key := item->>'id';
    amount := public.hisaab_snapshot_paise(item->'amount');
    job := nullif(item->>'jobId', '');
    cust := btrim(item->>'customer');
    event_time := public.hisaab_ledger_backfill_date(item->>'date');
    matched := false;
    for tx in
      select l.* from public.hisaab_ledger_transactions l
       where l.owner_id = uid and l.transaction_kind = 'payment'
         and (l.metadata->>'payment_id' = key or l.metadata->>'legacy_payment_id' = key)
         and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id = l.id)
       order by l.created_at, l.id
    loop
      if not matched and tx.amount_paise = amount and tx.job_id is not distinct from job
         and tx.customer_name = cust and tx.occurred_at = event_time then
        matched := true;
        continue;
      end if;
      perform public.record_hisaab_ledger_transaction(tx.job_id, tx.customer_name, 'reversal', tx.amount_paise, now(), null,
        public.hisaab_ledger_backfill_uuid(uid::text || ':restore:' || expected_revision || ':reverse:' || tx.id::text), tx.id,
        meta || jsonb_build_object('payment_id', key));
      inserted_count := inserted_count + 1;
    end loop;
    if not matched then
      perform public.record_hisaab_ledger_transaction(job, cust, 'payment', amount, event_time, null,
        public.hisaab_ledger_backfill_uuid(uid::text || ':restore:' || expected_revision || ':payment:' || key), null,
        meta || jsonb_build_object('payment_id', key, 'recorded_date', item->>'date'));
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  -- 3) Every restored job must have exactly one matching active charge (none when total is 0).
  for item in select value from jsonb_array_elements(payload->'jobs') loop
    key := item->>'id';
    amount := public.hisaab_snapshot_paise(item->'total');
    cust := btrim(item->>'customer');
    matched := false;
    for tx in
      select l.* from public.hisaab_ledger_transactions l
       where l.owner_id = uid and l.job_id = key and l.transaction_kind = 'charge'
         and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id = l.id)
       order by l.created_at, l.id
    loop
      if not matched and amount > 0 and tx.amount_paise = amount and tx.customer_name = cust then
        matched := true;
        continue;
      end if;
      perform public.record_hisaab_ledger_transaction(tx.job_id, tx.customer_name, 'reversal', tx.amount_paise, now(), null,
        public.hisaab_ledger_backfill_uuid(uid::text || ':restore:' || expected_revision || ':reverse:' || tx.id::text), tx.id, meta);
      inserted_count := inserted_count + 1;
    end loop;
    if not matched and amount > 0 then
      perform public.record_hisaab_ledger_transaction(key, cust, 'charge', amount, now(), null,
        public.hisaab_ledger_backfill_uuid(uid::text || ':restore:' || expected_revision || ':charge:' || key), null, meta);
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  -- 4) Same final check as a normal save: ledger balances must equal the snapshot.
  for item in select value from jsonb_array_elements(payload->'jobs') loop
    key := item->>'id';
    amount := public.hisaab_snapshot_paise(item->'total');
    select count(*), coalesce(sum(l.amount_paise), 0) into active_count, active_sum
      from public.hisaab_ledger_transactions l
     where l.owner_id = uid and l.job_id = key and l.transaction_kind = 'charge'
       and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id = l.id);
    if active_count <> (case when amount = 0 then 0 else 1 end) or active_sum <> amount then
      raise exception 'JOB_CHARGE_RECONCILIATION_FAILED:%', key;
    end if;
    select coalesce(sum(l.amount_paise), 0) into active_sum
      from public.hisaab_ledger_transactions l
     where l.owner_id = uid and l.job_id = key and l.transaction_kind = 'payment'
       and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id = l.id);
    if active_sum <> public.hisaab_snapshot_paise(item->'paid') then
      raise exception 'JOB_PAYMENT_RECONCILIATION_FAILED:%', key;
    end if;
  end loop;

  update public.workspaces set payload = restore_workspace_with_ledger.payload, updated_at = now()
   where owner_id = uid returning revision into next_revision;
  perform set_config('app.hisaab_atomic_owner', coalesce(prior_atomic_owner, ''), true);
  return jsonb_build_object('revision', next_revision, 'ledger_events', inserted_count, 'unchanged', false);
end;
$$;
revoke all on function public.restore_workspace_with_ledger(jsonb, bigint) from public, anon;
grant execute on function public.restore_workspace_with_ledger(jsonb, bigint) to authenticated, service_role;
commit;
