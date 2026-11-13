-- Admin-only push preferences, subscriptions, and atomic 60-second event dedupe.
create table if not exists public.admin_push_settings (
  id boolean primary key default true check (id),
  payments boolean not null default true,
  trials boolean not null default true,
  signups boolean not null default true
);
insert into public.admin_push_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.admin_push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_push_events (
  event_key text primary key,
  seen_at timestamptz not null default now()
);
create index if not exists admin_push_events_seen_at_idx on public.admin_push_events (seen_at);

alter table public.admin_push_settings enable row level security;
alter table public.admin_push_subscriptions enable row level security;
alter table public.admin_push_events enable row level security;
revoke all on public.admin_push_settings, public.admin_push_subscriptions, public.admin_push_events from public, anon, authenticated;

create or replace function public.claim_admin_push_event(p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or length(p_key) <> 64 then return false; end if;
  delete from public.admin_push_events where seen_at < now() - interval '1 day';
  insert into public.admin_push_events (event_key, seen_at) values (p_key, now())
  on conflict (event_key) do update set seen_at = excluded.seen_at
    where public.admin_push_events.seen_at < now() - interval '60 seconds';
  return found;
end;
$$;
revoke all on function public.claim_admin_push_event(text) from public, anon, authenticated;
grant execute on function public.claim_admin_push_event(text) to service_role;
