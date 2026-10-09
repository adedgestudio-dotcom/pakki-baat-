-- Phase 1C-A. This migration does not enable ledger mode for any owner.
-- All work is done in one PostgreSQL transaction (the RPC invocation).
begin;

alter table public.workspaces add column if not exists revision bigint not null default 1;
alter table public.workspaces add constraint workspaces_revision_positive check (revision > 0);

create table public.workspace_ledger_modes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  constraint workspace_ledger_modes_enabled_at check (not enabled or enabled_at is not null)
);
alter table public.workspace_ledger_modes enable row level security;
revoke all on public.workspace_ledger_modes from public, anon, authenticated;
grant select on public.workspace_ledger_modes to authenticated;
create policy workspace_ledger_modes_read_own on public.workspace_ledger_modes
  for select to authenticated using (owner_id = auth.uid());

-- Invoker triggers see the real SQL role. A caller cannot obtain the atomic
-- function's definer role merely by setting a user-controlled GUC.
create function public.guard_atomic_hisaab_workspace_write() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare allowed_writer text;
begin
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then raise exception 'WORKSPACE_OWNER_IMMUTABLE'; end if;
    new.revision := old.revision + 1;
  end if;
  if exists(select 1 from public.workspace_ledger_modes m where m.owner_id=new.owner_id and m.enabled) then
    select pg_get_userbyid(p.proowner) into allowed_writer from pg_proc p
      where p.oid='public.save_workspace_with_ledger(jsonb,bigint)'::regprocedure;
    if current_user <> allowed_writer or current_setting('app.hisaab_atomic_owner',true) is distinct from new.owner_id::text then
      raise exception 'LEDGER_MODE_REQUIRES_ATOMIC_SAVE';
    end if;
  end if;
  return new;
end; $$;
create trigger guard_atomic_hisaab_workspace_write
  before insert or update on public.workspaces for each row
  execute function public.guard_atomic_hisaab_workspace_write();

create function public.guard_atomic_hisaab_ledger_insert() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare allowed_writer text;
begin
  if exists(select 1 from public.workspace_ledger_modes m where m.owner_id=new.owner_id and m.enabled) then
    select pg_get_userbyid(p.proowner) into allowed_writer from pg_proc p
      where p.oid='public.save_workspace_with_ledger(jsonb,bigint)'::regprocedure;
    if current_user <> allowed_writer or current_setting('app.hisaab_atomic_owner',true) is distinct from new.owner_id::text then
      raise exception 'LEDGER_MODE_REQUIRES_ATOMIC_SAVE';
    end if;
  end if;
  return new;
end; $$;
create trigger guard_atomic_hisaab_ledger_insert
  before insert on public.hisaab_ledger_transactions for each row
  execute function public.guard_atomic_hisaab_ledger_insert();

-- Full cents validation; zero is legal for a job's total/paid but does not
-- create a zero-value ledger event. Reject floats with more than two decimals.
create function public.hisaab_snapshot_paise(value jsonb) returns bigint
language plpgsql immutable set search_path = public, pg_temp as $$
declare n numeric; raw text;
begin
  if value is null or jsonb_typeof(value) <> 'number' then raise exception 'INVALID_MONEY_VALUE'; end if;
  raw:=value #>> '{}';
  if length(raw)>30 or raw !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'INVALID_MONEY_VALUE'; end if;
  n:=raw::numeric*100;
  if n>9223372036854775807 then raise exception 'MONEY_OVERFLOW'; end if;
  return n::bigint;
end; $$;

create function public.validate_hisaab_snapshot_financial(snapshot jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
declare item jsonb; seen_jobs text[]:=array[]::text[]; seen_payments text[]:=array[]::text[]; identity text; total bigint; paid bigint;
begin
  if snapshot is null or jsonb_typeof(snapshot)<>'object' or jsonb_typeof(snapshot->'jobs')<>'array'
     or (snapshot ? 'payments' and jsonb_typeof(snapshot->'payments')<>'array')
     or jsonb_array_length(snapshot->'jobs')>5000
     or jsonb_array_length(coalesce(snapshot->'payments','[]'::jsonb))>10000 then
    raise exception 'INVALID_WORKSPACE_SNAPSHOT';
  end if;
  for item in select value from jsonb_array_elements(snapshot->'jobs') loop
    identity:=item->>'id';
    if identity is null or length(identity)<1 or length(identity)>120 or identity=any(seen_jobs)
       or length(btrim(coalesce(item->>'customer','')))<1 or length(btrim(item->>'customer'))>100 then
      raise exception 'INVALID_OR_DUPLICATE_JOB_ID';
    end if;
    seen_jobs:=array_append(seen_jobs,identity);
    total:=public.hisaab_snapshot_paise(item->'total');
    paid:=public.hisaab_snapshot_paise(item->'paid');
    if paid>total then raise exception 'JOB_PAID_EXCEEDS_TOTAL'; end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(snapshot->'payments','[]'::jsonb)) loop
    identity:=item->>'id';
    if identity is null or length(identity)<1 or length(identity)>200 or identity=any(seen_payments)
       or length(btrim(coalesce(item->>'customer','')))<1 or length(btrim(item->>'customer'))>100 then
      raise exception 'INVALID_OR_DUPLICATE_PAYMENT_ID';
    end if;
    seen_payments:=array_append(seen_payments,identity);
    if public.hisaab_snapshot_paise(item->'amount')=0 then raise exception 'ZERO_VALUE_PAYMENT_RECORD'; end if;
    if coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
       or public.hisaab_ledger_backfill_date(item->>'date') is null then raise exception 'INVALID_PAYMENT_DATE'; end if;
  end loop;
end; $$;

-- This RPC is deliberately separate from save_workspace. The old path keeps
-- working while the per-owner flag is OFF; the guard rejects it when ON.
create function public.save_workspace_with_ledger(payload jsonb, expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid:=auth.uid(); previous public.workspaces%rowtype; prior jsonb; old_item jsonb; new_item jsonb;
  key text; old_total bigint; new_total bigint; old_amount bigint; new_amount bigint;
  old_tx public.hisaab_ledger_transactions%rowtype; old_count integer; active_paid bigint; active_charges bigint;
  payment_ref uuid; event_key uuid; event_time timestamptz; next_revision bigint;
  inserted_count integer:=0; prior_atomic_owner text;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if expected_revision is null or expected_revision<1 then raise exception 'INVALID_EXPECTED_REVISION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hisaab-atomic:'||uid::text,0));
  select * into previous from public.workspaces where owner_id=uid for update;
  if not found then raise exception 'WORKSPACE_NOT_INITIALIZED'; end if;
  if not exists(select 1 from public.workspace_ledger_modes where owner_id=uid and enabled) then raise exception 'LEDGER_MODE_DISABLED'; end if;
  perform public.validate_hisaab_snapshot_financial(payload);
  if previous.payload=payload then return jsonb_build_object('revision',previous.revision,'ledger_events',0,'unchanged',true); end if;
  if previous.revision<>expected_revision then raise exception 'WORKSPACE_REVISION_CONFLICT'; end if;
  prior:=previous.payload;
  perform public.validate_hisaab_snapshot_financial(prior);
  prior_atomic_owner:=current_setting('app.hisaab_atomic_owner',true);
  perform set_config('app.hisaab_atomic_owner',uid::text,true);

  -- Existing jobs: only total/customer financial identity changes need events.
  for old_item in select value from jsonb_array_elements(prior->'jobs') loop
    key:=old_item->>'id';
    select value into new_item from jsonb_array_elements(payload->'jobs') where value->>'id'=key;
    if new_item is null then continue; end if; -- deletion retains financial history
    old_total:=public.hisaab_snapshot_paise(old_item->'total');
    new_total:=public.hisaab_snapshot_paise(new_item->'total');
    if old_total=new_total and btrim(old_item->>'customer')=btrim(new_item->>'customer') then continue; end if;
    select count(*), (array_agg(l.id))[1] into old_count, event_key
      from public.hisaab_ledger_transactions l where l.owner_id=uid and l.job_id=key and l.transaction_kind='charge'
      and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    if old_count<>(case when old_total=0 then 0 else 1 end) then raise exception 'CHARGE_BACKFILL_CONFLICT:%',key; end if;
    if old_count=1 then
      select * into old_tx from public.hisaab_ledger_transactions where id=event_key;
      if old_tx.amount_paise<>old_total then raise exception 'CHARGE_BACKFILL_CONFLICT:%',key; end if;
      perform public.record_hisaab_ledger_transaction(key,old_tx.customer_name,'reversal',old_total,now(),null,
        public.hisaab_ledger_backfill_uuid(uid::text||':atomic:'||expected_revision||':reverse-charge:'||key),old_tx.id,
        jsonb_build_object('origin','live_atomic','reason','job_edit','workspace_revision',expected_revision+1));
      inserted_count:=inserted_count+1;
    end if;
    if new_total>0 then
      perform public.record_hisaab_ledger_transaction(key,btrim(new_item->>'customer'),'charge',new_total,now(),null,
        public.hisaab_ledger_backfill_uuid(uid::text||':atomic:'||expected_revision||':replace-charge:'||key),null,
        jsonb_build_object('origin','live_atomic','reason','job_edit','workspace_revision',expected_revision+1));
      inserted_count:=inserted_count+1;
    end if;
  end loop;

  -- New jobs. Reusing a deleted ID is ambiguous, so require a fresh ID.
  for new_item in select value from jsonb_array_elements(payload->'jobs') loop
    key:=new_item->>'id';
    if exists(select 1 from jsonb_array_elements(prior->'jobs') j where j->>'id'=key) then continue; end if;
    if exists(select 1 from public.hisaab_ledger_transactions where owner_id=uid and job_id=key) then raise exception 'REUSED_HISTORICAL_JOB_ID:%',key; end if;
    new_total:=public.hisaab_snapshot_paise(new_item->'total');
    if new_total=0 then continue; end if;
    perform public.record_hisaab_ledger_transaction(key,btrim(new_item->>'customer'),'charge',new_total,now(),null,
      public.hisaab_ledger_backfill_uuid(uid::text||':atomic:new-charge:'||key),null,
      jsonb_build_object('origin','live_atomic','reason','new_job','workspace_revision',expected_revision+1));
    inserted_count:=inserted_count+1;
  end loop;

  -- Old payments may have UUID or legacy string IDs. Backfilled rows carry
  -- legacy_payment_id; live rows carry payment_id. Require a single active match.
  for old_item in select value from jsonb_array_elements(coalesce(prior->'payments','[]'::jsonb)) loop
    key:=old_item->>'id';
    select value into new_item from jsonb_array_elements(coalesce(payload->'payments','[]'::jsonb)) where value->>'id'=key;
    if new_item=old_item then continue; end if;
    -- A customer/job deletion removes the active payment list but not history.
    if new_item is null and not exists(select 1 from jsonb_array_elements(payload->'jobs') j
       where j->>'id'=old_item->>'jobId' or j->>'customer'=old_item->>'customer') then continue; end if;
    select count(*),(array_agg(l.id))[1] into old_count,event_key
      from public.hisaab_ledger_transactions l where l.owner_id=uid and l.transaction_kind='payment'
       and (l.metadata->>'payment_id'=key or l.metadata->>'legacy_payment_id'=key)
       and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    if old_count<>1 then raise exception 'PAYMENT_BACKFILL_CONFLICT:%',key; end if;
    select * into old_tx from public.hisaab_ledger_transactions where id=event_key;
    old_amount:=public.hisaab_snapshot_paise(old_item->'amount');
    if old_tx.amount_paise<>old_amount then raise exception 'PAYMENT_BACKFILL_CONFLICT:%',key; end if;
    perform public.record_hisaab_ledger_transaction(old_tx.job_id,old_tx.customer_name,'reversal',old_amount,now(),null,
      public.hisaab_ledger_backfill_uuid(uid::text||':atomic:'||expected_revision||':reverse-payment:'||key),old_tx.id,
      jsonb_build_object('origin','live_atomic','reason','payment_edit_or_removal','payment_id',key,'workspace_revision',expected_revision+1));
    inserted_count:=inserted_count+1;
    if new_item is not null then
      new_amount:=public.hisaab_snapshot_paise(new_item->'amount');
      event_time:=public.hisaab_ledger_backfill_date(new_item->>'date');
      perform public.record_hisaab_ledger_transaction(nullif(new_item->>'jobId',''),btrim(new_item->>'customer'),'payment',new_amount,event_time,null,
        public.hisaab_ledger_backfill_uuid(uid::text||':atomic:'||expected_revision||':replace-payment:'||key),null,
        jsonb_build_object('origin','live_atomic','reason','payment_edit','payment_id',key,'recorded_date',new_item->>'date','workspace_revision',expected_revision+1));
      inserted_count:=inserted_count+1;
    end if;
  end loop;

  for new_item in select value from jsonb_array_elements(coalesce(payload->'payments','[]'::jsonb)) loop
    key:=new_item->>'id';
    if exists(select 1 from jsonb_array_elements(coalesce(prior->'payments','[]'::jsonb)) p where p->>'id'=key) then continue; end if;
    if exists(select 1 from public.hisaab_ledger_transactions l where l.owner_id=uid
       and (l.metadata->>'payment_id'=key or l.metadata->>'legacy_payment_id'=key)) then raise exception 'REUSED_HISTORICAL_PAYMENT_ID:%',key; end if;
    payment_ref:=case when key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then key::uuid
      else public.hisaab_ledger_backfill_uuid(uid::text||':legacy-payment:'||key) end;
    new_amount:=public.hisaab_snapshot_paise(new_item->'amount');
    event_time:=public.hisaab_ledger_backfill_date(new_item->>'date');
    perform public.record_hisaab_ledger_transaction(nullif(new_item->>'jobId',''),btrim(new_item->>'customer'),'payment',new_amount,event_time,payment_ref,
      public.hisaab_ledger_backfill_uuid(uid::text||':atomic:new-payment:'||key),null,
      jsonb_build_object('origin','live_atomic','reason','new_payment','payment_id',key,'recorded_date',new_item->>'date','workspace_revision',expected_revision+1));
    inserted_count:=inserted_count+1;
  end loop;

  -- Financial balances for every currently active job must equal the JSON UI.
  -- Reversals remove the original's effect; deleted jobs retain their history.
  for new_item in select value from jsonb_array_elements(payload->'jobs') loop
    key:=new_item->>'id'; new_total:=public.hisaab_snapshot_paise(new_item->'total');
    select count(*),coalesce(sum(l.amount_paise),0) into old_count,active_charges
      from public.hisaab_ledger_transactions l where l.owner_id=uid and l.job_id=key and l.transaction_kind='charge'
      and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    if old_count<>(case when new_total=0 then 0 else 1 end) or active_charges<>new_total then raise exception 'JOB_CHARGE_RECONCILIATION_FAILED:%',key; end if;
    select coalesce(sum(l.amount_paise),0) into active_paid from public.hisaab_ledger_transactions l
      where l.owner_id=uid and l.job_id=key and l.transaction_kind='payment'
      and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    if active_paid<>public.hisaab_snapshot_paise(new_item->'paid') then raise exception 'JOB_PAYMENT_RECONCILIATION_FAILED:%',key; end if;
  end loop;

  update public.workspaces set payload=save_workspace_with_ledger.payload,updated_at=now() where owner_id=uid returning revision into next_revision;
  perform set_config('app.hisaab_atomic_owner',coalesce(prior_atomic_owner,''),true);
  return jsonb_build_object('revision',next_revision,'ledger_events',inserted_count,'unchanged',false);
end; $$;

-- The feature flag is OFF until a separately reviewed owner-level activation.
-- This RPC cannot be called by anon; its target owner comes only from auth.uid().
revoke all on function public.save_workspace_with_ledger(jsonb,bigint) from public, anon;
grant execute on function public.save_workspace_with_ledger(jsonb,bigint) to authenticated;
revoke all on function public.guard_atomic_hisaab_workspace_write(), public.guard_atomic_hisaab_ledger_insert(),
  public.hisaab_snapshot_paise(jsonb), public.validate_hisaab_snapshot_financial(jsonb) from public, anon, authenticated;

commit;
