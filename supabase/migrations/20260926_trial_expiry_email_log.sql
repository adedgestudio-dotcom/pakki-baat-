-- One-time log so the 2-day trial reminder email is sent only once per trial period.
create table if not exists public.trial_expiry_email_log (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_end timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key(owner_id,period_end)
);
alter table public.trial_expiry_email_log enable row level security;
revoke all on public.trial_expiry_email_log from public,anon,authenticated;
