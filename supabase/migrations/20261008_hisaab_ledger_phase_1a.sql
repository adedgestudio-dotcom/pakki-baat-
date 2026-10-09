-- Phase 1A: append-only Hisaab financial ledger.
-- This is deliberately additive. Existing public.workspaces JSON is unchanged,
-- and no historic jobs or payments are backfilled by this migration.

create table if not exists public.hisaab_ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  job_id text,
  customer_name text not null,
  transaction_kind text not null,
  amount_paise bigint not null,
  occurred_at timestamptz not null,
  source_payment_id uuid,
  idempotency_key uuid not null,
  reverses_transaction_id uuid references public.hisaab_ledger_transactions(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hisaab_ledger_job_id_length
    check (job_id is null or char_length(job_id) between 1 and 120),
  constraint hisaab_ledger_customer_name
    check (char_length(btrim(customer_name)) between 1 and 100),
  constraint hisaab_ledger_kind
    check (transaction_kind in ('charge', 'payment', 'adjustment', 'reversal', 'opening_balance')),
  constraint hisaab_ledger_amount
    check (amount_paise > 0),
  constraint hisaab_ledger_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint hisaab_ledger_payment_source
    check (source_payment_id is null or transaction_kind = 'payment'),
  constraint hisaab_ledger_reversal_reference
    check ((transaction_kind = 'reversal') = (reverses_transaction_id is not null)),
  constraint hisaab_ledger_idempotency_unique
    unique (owner_id, idempotency_key)
);

-- A client payment event can only be represented once for an owner, even if a
-- caller supplies a fresh idempotency key on retry.
create unique index if not exists hisaab_ledger_owner_source_payment_unique
  on public.hisaab_ledger_transactions(owner_id, source_payment_id)
  where source_payment_id is not null;

create index if not exists hisaab_ledger_owner_occurred_at_idx
  on public.hisaab_ledger_transactions(owner_id, occurred_at desc, created_at desc);

create index if not exists hisaab_ledger_owner_job_occurred_at_idx
  on public.hisaab_ledger_transactions(owner_id, job_id, occurred_at desc)
  where job_id is not null;

create index if not exists hisaab_ledger_reversal_idx
  on public.hisaab_ledger_transactions(reverses_transaction_id)
  where reverses_transaction_id is not null;

alter table public.hisaab_ledger_transactions enable row level security;
alter table public.hisaab_ledger_transactions force row level security;

revoke all on public.hisaab_ledger_transactions from public, anon, authenticated;
grant select on public.hisaab_ledger_transactions to authenticated;

drop policy if exists "hisaab_ledger_read_own" on public.hisaab_ledger_transactions;
create policy "hisaab_ledger_read_own"
  on public.hisaab_ledger_transactions
  for select to authenticated
  using (owner_id = auth.uid());

-- Ledger rows are immutable. The only authenticated write path is the RPC below.
create or replace function public.reject_hisaab_ledger_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Hisaab ledger rows are immutable';
end;
$$;

drop trigger if exists hisaab_ledger_reject_mutation on public.hisaab_ledger_transactions;
create trigger hisaab_ledger_reject_mutation
  before update or delete on public.hisaab_ledger_transactions
  for each row execute function public.reject_hisaab_ledger_mutation();

-- Validate that a reversal belongs to the same owner and cannot over-reverse
-- its source transaction. Locking the source serializes concurrent reversals.
create or replace function public.validate_hisaab_ledger_reversal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  original public.hisaab_ledger_transactions%rowtype;
  already_reversed bigint;
begin
  if new.transaction_kind <> 'reversal' then
    return new;
  end if;

  if new.id = new.reverses_transaction_id then
    raise exception 'A ledger transaction cannot reverse itself';
  end if;

  select * into original
    from public.hisaab_ledger_transactions
   where id = new.reverses_transaction_id
   for update;

  if not found then
    raise exception 'The reversed ledger transaction does not exist';
  end if;
  if original.owner_id <> new.owner_id then
    raise exception 'A reversal must belong to the same owner';
  end if;
  if original.transaction_kind = 'reversal' then
    raise exception 'A reversal cannot reverse another reversal';
  end if;

  select coalesce(sum(amount_paise), 0) into already_reversed
    from public.hisaab_ledger_transactions
   where owner_id = new.owner_id
     and reverses_transaction_id = new.reverses_transaction_id;

  if already_reversed + new.amount_paise > original.amount_paise then
    raise exception 'Reversal amount exceeds the original transaction';
  end if;
  return new;
end;
$$;

drop trigger if exists hisaab_ledger_validate_reversal on public.hisaab_ledger_transactions;
create trigger hisaab_ledger_validate_reversal
  before insert on public.hisaab_ledger_transactions
  for each row execute function public.validate_hisaab_ledger_reversal();

create or replace function public.record_hisaab_ledger_transaction(
  p_job_id text,
  p_customer_name text,
  p_transaction_kind text,
  p_amount_paise bigint,
  p_occurred_at timestamptz,
  p_source_payment_id uuid,
  p_idempotency_key uuid,
  p_reverses_transaction_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.hisaab_ledger_transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  normalized_customer_name text := btrim(p_customer_name);
  normalized_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  existing public.hisaab_ledger_transactions%rowtype;
  inserted public.hisaab_ledger_transactions%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required';
  end if;
  if p_occurred_at is null then
    raise exception 'An event timestamp is required';
  end if;
  if jsonb_typeof(normalized_metadata) <> 'object' then
    raise exception 'Ledger metadata must be a JSON object';
  end if;

  -- Serialize requests for one owner/key so a retry cannot race its original.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_idempotency_key::text, 0));

  select * into existing
    from public.hisaab_ledger_transactions
   where owner_id = uid and idempotency_key = p_idempotency_key;

  if found then
    if existing.job_id is not distinct from p_job_id
       and existing.customer_name = normalized_customer_name
       and existing.transaction_kind = p_transaction_kind
       and existing.amount_paise = p_amount_paise
       and existing.occurred_at = p_occurred_at
       and existing.source_payment_id is not distinct from p_source_payment_id
       and existing.reverses_transaction_id is not distinct from p_reverses_transaction_id
       and existing.metadata = normalized_metadata then
      return existing;
    end if;
    raise exception 'Idempotency key was already used with a different ledger payload';
  end if;

  if p_source_payment_id is not null and exists (
    select 1
      from public.hisaab_ledger_transactions
     where owner_id = uid and source_payment_id = p_source_payment_id
  ) then
    raise exception 'Source payment reference was already recorded';
  end if;

  insert into public.hisaab_ledger_transactions (
    owner_id, job_id, customer_name, transaction_kind, amount_paise,
    occurred_at, source_payment_id, idempotency_key,
    reverses_transaction_id, metadata
  ) values (
    uid, p_job_id, normalized_customer_name, p_transaction_kind, p_amount_paise,
    p_occurred_at, p_source_payment_id, p_idempotency_key,
    p_reverses_transaction_id, normalized_metadata
  ) returning * into inserted;

  return inserted;
end;
$$;

revoke all on function public.record_hisaab_ledger_transaction(text, text, text, bigint, timestamptz, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_hisaab_ledger_transaction(text, text, text, bigint, timestamptz, uuid, uuid, uuid, jsonb)
  to authenticated;
