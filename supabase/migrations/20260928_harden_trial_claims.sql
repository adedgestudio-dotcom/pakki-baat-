-- Harden free-trial claims against account/device reuse.
-- Server/database time remains authoritative for entitlement expiry.

create table if not exists public.trial_owner_claims (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.trial_owner_claims enable row level security;
revoke all on public.trial_owner_claims from public, anon, authenticated;

-- Keep device claim history even if the original account is later deleted.
alter table public.trial_claims
  alter column first_owner_id drop not null;

alter table public.trial_claims
  drop constraint if exists trial_claims_first_owner_id_fkey;

alter table public.trial_claims
  add constraint trial_claims_first_owner_id_fkey
  foreign key (first_owner_id) references auth.users(id) on delete set null;

-- Backfill one-time account claims for existing trial subscriptions.
insert into public.trial_owner_claims(owner_id, claimed_at)
select owner_id, coalesce(period_start, now())
from public.subscriptions
where plan = 'trial'
on conflict (owner_id) do nothing;

create or replace function public.claim_trial(user_id uuid, supplied_device_hash text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  existing_owner uuid;
  sub public.subscriptions%rowtype;
  owner_already_claimed boolean;
begin
  if supplied_device_hash is null or length(trim(supplied_device_hash)) < 16 then
    return jsonb_build_object('allowed',false,'reason','invalid_device');
  end if;

  -- Serialize claims for this account.
  perform pg_advisory_xact_lock(hashtext(user_id::text));

  select exists(
    select 1 from public.trial_owner_claims where owner_id=user_id
  ) into owner_already_claimed;

  select first_owner_id
    into existing_owner
  from public.trial_claims
  where device_hash=supplied_device_hash;

  if existing_owner is not null and existing_owner<>user_id then
    return jsonb_build_object('allowed',false,'reason','trial_already_used_on_device');
  end if;

  if owner_already_claimed then
    return jsonb_build_object('allowed',false,'reason','trial_already_used_on_account');
  end if;

  -- A paid account must never be converted back to a trial.
  select * into sub
  from public.subscriptions
  where owner_id=user_id
  for update;

  if found and sub.plan <> 'trial' then
    return jsonb_build_object('allowed',false,'reason','paid_account');
  end if;

  insert into public.trial_owner_claims(owner_id)
  values(user_id)
  on conflict(owner_id) do nothing;

  insert into public.trial_claims(device_hash,first_owner_id)
  values(supplied_device_hash,user_id)
  on conflict(device_hash) do nothing;

  return jsonb_build_object('allowed',true,'reason','trial_claimed');
end;
$$;

revoke all on function public.claim_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_trial(uuid,text) to service_role;
