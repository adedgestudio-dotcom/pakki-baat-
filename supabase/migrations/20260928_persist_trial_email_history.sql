-- Preserve one-trial-per-email history even after an Auth user is deleted.
create table if not exists public.trial_email_claims (
  email_hash text primary key,
  claimed_at timestamptz not null default now()
);
alter table public.trial_email_claims enable row level security;
revoke all on public.trial_email_claims from public,anon,authenticated;

create or replace function public.claim_trial(
  user_id uuid,
  supplied_device_hash text,
  supplied_email_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  existing_owner uuid;
  sub public.subscriptions%rowtype;
  owner_already_claimed boolean;
  email_already_claimed boolean;
  trial_start timestamptz;
  trial_end timestamptz;
begin
  if supplied_device_hash is null or length(trim(supplied_device_hash)) < 16 then
    return jsonb_build_object('allowed',false,'reason','invalid_device');
  end if;
  if supplied_email_hash is null or length(trim(supplied_email_hash)) <> 64 then
    return jsonb_build_object('allowed',false,'reason','invalid_email');
  end if;

  perform pg_advisory_xact_lock(hashtext(user_id::text));
  perform pg_advisory_xact_lock(hashtext(supplied_email_hash));

  select exists(select 1 from public.trial_owner_claims where owner_id=user_id)
    into owner_already_claimed;
  select exists(select 1 from public.trial_email_claims where email_hash=supplied_email_hash)
    into email_already_claimed;

  select first_owner_id into existing_owner
  from public.trial_claims where device_hash=supplied_device_hash;

  if existing_owner is not null and existing_owner<>user_id then
    return jsonb_build_object('allowed',false,'reason','trial_already_used_on_device');
  end if;
  if owner_already_claimed then
    return jsonb_build_object('allowed',false,'reason','trial_already_used_on_account');
  end if;
  if email_already_claimed then
    return jsonb_build_object('allowed',false,'reason','trial_already_used_on_email');
  end if;

  select * into sub from public.subscriptions where owner_id=user_id for update;
  if found and sub.plan <> 'trial' then
    return jsonb_build_object('allowed',false,'reason','paid_account');
  end if;

  trial_start:=now();
  trial_end:=trial_start+interval '30 days';

  insert into public.trial_owner_claims(owner_id,claimed_at)
    values(user_id,trial_start) on conflict(owner_id) do nothing;
  insert into public.trial_email_claims(email_hash,claimed_at)
    values(supplied_email_hash,trial_start) on conflict(email_hash) do nothing;
  insert into public.trial_claims(device_hash,first_owner_id,claimed_at)
    values(supplied_device_hash,user_id,trial_start) on conflict(device_hash) do nothing;

  insert into public.subscriptions(owner_id,plan,status,period_start,period_end,bonus_voice_seconds,updated_at)
  values(user_id,'trial','active',trial_start,trial_end,0,trial_start)
  on conflict(owner_id) do update
  set plan='trial',status='active',period_start=excluded.period_start,
      period_end=excluded.period_end,bonus_voice_seconds=0,updated_at=excluded.updated_at;

  return jsonb_build_object('allowed',true,'reason','trial_claimed','period_start',trial_start,'period_end',trial_end);
end;
$$;
revoke all on function public.claim_trial(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_trial(uuid,text,text) to service_role;
