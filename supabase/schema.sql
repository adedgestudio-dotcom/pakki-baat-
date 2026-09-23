-- Run once in the Supabase SQL editor. Phone authentication requires an SMS provider.
create table if not exists public.workspaces (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon;
grant select, insert, update on public.workspaces to authenticated;
create policy "Read own workspace" on public.workspaces for select to authenticated using (auth.uid() = owner_id);
create policy "Insert own workspace" on public.workspaces for insert to authenticated with check (auth.uid() = owner_id);
create policy "Update own workspace" on public.workspaces for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create or replace function public.save_workspace(payload jsonb) returns void language sql security invoker set search_path = public as $$
 insert into public.workspaces(owner_id,payload) values(auth.uid(),payload)
 on conflict(owner_id) do update set payload=excluded.payload, updated_at=now();
$$;
revoke all on function public.save_workspace(jsonb) from public;
grant execute on function public.save_workspace(jsonb) to authenticated;

-- Atomic, durable quota. Only the server can consume credits.
create table if not exists public.ai_usage(owner_id uuid references auth.users(id) on delete cascade, usage_day date not null default current_date, calls integer not null default 0, primary key(owner_id,usage_day));
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon,authenticated;
create or replace function public.consume_ai_credit(user_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into public.ai_usage(owner_id,usage_day,calls) values(user_id,current_date,1)
 on conflict(owner_id,usage_day) do update set calls=ai_usage.calls+1 where ai_usage.calls<30
 returning calls into n;
 return n is not null;
end;$$;
revoke all on function public.consume_ai_credit(uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_credit(uuid) to service_role;


-- Pakki Baat account rights + subscription entitlements
create table if not exists public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin','owner')),
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;
drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles for select to authenticated using (auth.uid()=owner_id);
drop policy if exists "Insert own profile" on public.profiles;
create policy "Insert own profile" on public.profiles for insert to authenticated with check (auth.uid()=owner_id and role='user');
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated using (auth.uid()=owner_id) with check (auth.uid()=owner_id and role='user');

create table if not exists public.subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial','basic','smart','business')),
  status text not null default 'active' check (status in ('active','past_due','suspended','expired','cancelled')),
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now()+interval '7 days'),
  bonus_voice_seconds integer not null default 0 check (bonus_voice_seconds>=0),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon,authenticated;
grant select on public.subscriptions to authenticated;
drop policy if exists "Read own subscription" on public.subscriptions;
create policy "Read own subscription" on public.subscriptions for select to authenticated using (auth.uid()=owner_id);

create table if not exists public.ai_monthly_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null default date_trunc('month',current_date)::date,
  voice_seconds integer not null default 0,
  ai_calls integer not null default 0,
  primary key(owner_id,period_month)
);
alter table public.ai_monthly_usage enable row level security;
revoke all on public.ai_monthly_usage from anon,authenticated;
grant select on public.ai_monthly_usage to authenticated;
drop policy if exists "Read own monthly AI usage" on public.ai_monthly_usage;
create policy "Read own monthly AI usage" on public.ai_monthly_usage for select to authenticated using (auth.uid()=owner_id);

create or replace function public.ensure_user_access(user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(owner_id) values(user_id) on conflict(owner_id) do nothing;
  insert into public.subscriptions(owner_id) values(user_id) on conflict(owner_id) do nothing;
end;$$;
revoke all on function public.ensure_user_access(uuid) from public,anon,authenticated;
grant execute on function public.ensure_user_access(uuid) to service_role;

create or replace function public.consume_ai_usage(user_id uuid, voice_seconds_to_add integer default 0, ai_calls_to_add integer default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sub public.subscriptions%rowtype;
  used public.ai_monthly_usage%rowtype;
  voice_limit integer;
begin
  perform public.ensure_user_access(user_id);
  select * into sub from public.subscriptions where owner_id=user_id for update;
  if sub.status <> 'active' or sub.period_end <= now() then
    return jsonb_build_object('allowed',false,'reason','subscription_inactive');
  end if;
  voice_limit := case sub.plan when 'trial' then 36000 when 'basic' then 7200 when 'smart' then 36000 when 'business' then 72000 else 0 end;
  voice_limit := voice_limit + sub.bonus_voice_seconds;
  insert into public.ai_monthly_usage(owner_id,period_month,voice_seconds,ai_calls)
    values(user_id,date_trunc('month',current_date)::date,0,0)
    on conflict(owner_id,period_month) do nothing;
  select * into used from public.ai_monthly_usage where owner_id=user_id and period_month=date_trunc('month',current_date)::date for update;
  if voice_seconds_to_add > 0 and used.voice_seconds + voice_seconds_to_add > voice_limit then
    return jsonb_build_object('allowed',false,'reason','voice_limit','voice_seconds',used.voice_seconds,'voice_limit',voice_limit);
  end if;
  update public.ai_monthly_usage
    set voice_seconds=voice_seconds+greatest(0,voice_seconds_to_add),
        ai_calls=ai_calls+greatest(0,ai_calls_to_add)
    where owner_id=user_id and period_month=date_trunc('month',current_date)::date
    returning * into used;
  return jsonb_build_object('allowed',true,'plan',sub.plan,'voice_seconds',used.voice_seconds,'voice_limit',voice_limit,'ai_calls',used.ai_calls);
end;$$;
revoke all on function public.consume_ai_usage(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_ai_usage(uuid,integer,integer) to service_role;


-- Owner bootstrap for the Pakki Baat admin console.
-- The server still verifies the signed-in email before serving admin data.
update public.profiles p
set role='owner'
from auth.users u
where p.owner_id=u.id
  and lower(u.email)=lower('zorivoworks@gmail.com');

insert into public.profiles(owner_id,role)
select id,'owner' from auth.users
where lower(email)=lower('zorivoworks@gmail.com')
on conflict(owner_id) do update set role='owner';
