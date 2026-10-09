-- Phase 1A ledger security tests.
-- Run only against a disposable local Supabase/Postgres database, after the
-- Phase 1A migration. This script rolls back all fixtures and ledger rows.

begin;

do $$
declare
  owner_a uuid := '11111111-1111-1111-1111-111111111111';
  owner_b uuid := '22222222-2222-2222-2222-222222222222';
  payment_id uuid := '33333333-3333-3333-3333-333333333333';
  idempotency_a uuid := '44444444-4444-4444-4444-444444444444';
  idempotency_b uuid := '55555555-5555-5555-5555-555555555555';
begin
  -- Minimal local auth fixtures. They are rolled back at the end of the file.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    (owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'ledger-owner-a@example.test', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'ledger-owner-b@example.test', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

end;
$$;

-- Run assertions with the same database role used by PostgREST for users.
set local role authenticated;

do $$
declare
  owner_a uuid := '11111111-1111-1111-1111-111111111111';
  owner_b uuid := '22222222-2222-2222-2222-222222222222';
  payment_id uuid := '33333333-3333-3333-3333-333333333333';
  idempotency_a uuid := '44444444-4444-4444-4444-444444444444';
  idempotency_b uuid := '55555555-5555-5555-5555-555555555555';
  tx_id uuid;
  duplicate_id uuid;
  visible_count integer;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', owner_a::text, true);

  select id into tx_id
    from public.record_hisaab_ledger_transaction(
      'job-1', 'Customer A', 'payment', 12500,
      '2026-10-08T10:00:00Z'::timestamptz, payment_id, idempotency_a, null, '{}'::jsonb
    );
  if tx_id is null then
    raise exception 'TEST FAILED: authenticated RPC insert returned no row';
  end if;

  select id into duplicate_id
    from public.record_hisaab_ledger_transaction(
      'job-1', 'Customer A', 'payment', 12500,
      '2026-10-08T10:00:00Z'::timestamptz, payment_id, idempotency_a, null, '{}'::jsonb
    );
  if duplicate_id <> tx_id then
    raise exception 'TEST FAILED: matching idempotent request did not return existing row';
  end if;

  begin
    perform public.record_hisaab_ledger_transaction(
      'job-1', 'Customer A', 'payment', 12600,
      '2026-10-08T10:00:00Z'::timestamptz, payment_id, idempotency_a, null, '{}'::jsonb
    );
    raise exception 'TEST FAILED: mismatched idempotency payload was accepted';
  exception when others then
    if position('Idempotency key was already used' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    insert into public.hisaab_ledger_transactions(
      owner_id, customer_name, transaction_kind, amount_paise,
      occurred_at, idempotency_key
    ) values (
      owner_a, 'Direct write', 'payment', 1, now(),
      '66666666-6666-6666-6666-666666666666'
    );
    raise exception 'TEST FAILED: direct authenticated insert was accepted';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.record_hisaab_ledger_transaction(
      'job-1', 'Customer A', 'payment', 12500,
      '2026-10-08T10:00:00Z'::timestamptz, payment_id, idempotency_b, null, '{}'::jsonb
    );
    raise exception 'TEST FAILED: duplicate source payment was accepted';
  exception when others then
    if position('Source payment reference was already recorded' in sqlerrm) = 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', owner_b::text, true);
  select count(*) into visible_count from public.hisaab_ledger_transactions where id = tx_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: owner B can read owner A ledger rows';
  end if;

  begin
    update public.hisaab_ledger_transactions
       set amount_paise = 1
     where id = tx_id;
    raise exception 'TEST FAILED: direct authenticated update was accepted';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.hisaab_ledger_transactions where id = tx_id;
    raise exception 'TEST FAILED: direct authenticated delete was accepted';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.record_hisaab_ledger_transaction(
      'job-1', 'Customer A', 'reversal', 12500,
      '2026-10-08T10:01:00Z'::timestamptz, null, idempotency_b, tx_id, '{}'::jsonb
    );
    raise exception 'TEST FAILED: cross-owner reversal was accepted';
  exception when others then
    if position('A reversal must belong to the same owner' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

set local role anon;

do $$
begin
  begin
    perform 1 from public.hisaab_ledger_transactions;
    raise exception 'TEST FAILED: anonymous ledger read was accepted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

rollback;
