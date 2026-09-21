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
grant execute on function public.save_workspace(jsonb) to authenticated;\n\n-- Subscription and monthly AI usage limits. Only the server/service role can consume usage.
create table if not exists public.subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial','basic','smart','business')),
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now() + interval '7 days'),
  bonus_voice_seconds integer not null default 0 check (bonus_voice_seconds >= 0),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon,authenticated;
grant select on public.subscriptions to service_role;

create table if not exists public.ai_monthly_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  voice_seconds integer not null default 0 check (voice_seconds >= 0),
  ai_calls integer not null default 0 check (ai_calls >= 0),
  updated_at timestamptz not null default now(),
  primary key(owner_id,period_start)
);
alter table public.ai_monthly_usage enable row level security;
revoke all on public.ai_monthly_usage from anon,authenticated;

create or replace function public.consume_ai_usage(
  user_id uuid,
  requested_voice_seconds integer default 0,
  requested_ai_calls integer default 1
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sub public.subscriptions%rowtype;
  used public.ai_monthly_usage%rowtype;
  voice_limit integer;
  period_key date;
  requested_voice integer := greatest(coalesce(requested_voice_seconds,0),0);
  requested_calls integer := greatest(coalesce(requested_ai_calls,0),0);
begin
  select * into sub from public.subscriptions where owner_id=user_id for update;

  if not found then
    insert into public.subscriptions(owner_id,plan,status,period_start,period_end)
    values(user_id,'trial','active',now(),now()+interval '7 days')
    returning * into sub;
  end if;

  if sub.status <> 'active' or now() >= sub.period_end then
    return jsonb_build_object(
      'allowed',false,'reason','subscription_inactive','plan',sub.plan,
      'voice_limit_seconds',0,'voice_used_seconds',0,'voice_remaining_seconds',0
    );
  end if;

  voice_limit := case sub.plan
    when 'basic' then 120 * 60
    when 'smart' then 600 * 60
    when 'business' then 1200 * 60
    when 'trial' then 600 * 60
    else 0
  end + sub.bonus_voice_seconds;

  period_key := sub.period_start::date;

  insert into public.ai_monthly_usage(owner_id,period_start,voice_seconds,ai_calls)
  values(user_id,period_key,0,0)
  on conflict(owner_id,period_start) do nothing;

  select * into used from public.ai_monthly_usage
  where owner_id=user_id and period_start=period_key
  for update;

  if requested_voice > 0 and used.voice_seconds + requested_voice > voice_limit then
    return jsonb_build_object(
      'allowed',false,'reason','voice_limit_reached','plan',sub.plan,
      'voice_limit_seconds',voice_limit,'voice_used_seconds',used.voice_seconds,
      'voice_remaining_seconds',greatest(voice_limit-used.voice_seconds,0),
      'ai_calls',used.ai_calls,'period_end',sub.period_end
    );
  end if;

  update public.ai_monthly_usage
  set voice_seconds=voice_seconds+requested_voice,
      ai_calls=ai_calls+requested_calls,
      updated_at=now()
  where owner_id=user_id and period_start=period_key
  returning * into used;

  return jsonb_build_object(
    'allowed',true,'plan',sub.plan,
    'voice_limit_seconds',voice_limit,'voice_used_seconds',used.voice_seconds,
    'voice_remaining_seconds',greatest(voice_limit-used.voice_seconds,0),
    'ai_calls',used.ai_calls,'period_end',sub.period_end
  );
end;$$;
revoke all on function public.consume_ai_usage(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_ai_usage(uuid,integer,integer) to service_role;

create or replace function public.get_ai_usage(user_id uuid) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sub public.subscriptions%rowtype;
  used_voice integer := 0;
  used_calls integer := 0;
  voice_limit integer := 0;
begin
  select * into sub from public.subscriptions where owner_id=user_id;
  if not found then
    return jsonb_build_object('plan','trial','status','not_started','voice_limit_seconds',600*60,'voice_used_seconds',0,'voice_remaining_seconds',600*60,'ai_calls',0);
  end if;

  voice_limit := case sub.plan
    when 'basic' then 120 * 60
    when 'smart' then 600 * 60
    when 'business' then 1200 * 60
    when 'trial' then 600 * 60
    else 0
  end + sub.bonus_voice_seconds;

  select coalesce(voice_seconds,0),coalesce(ai_calls,0)
  into used_voice,used_calls
  from public.ai_monthly_usage
  where owner_id=user_id and period_start=sub.period_start::date;

  return jsonb_build_object(
    'plan',sub.plan,'status',sub.status,'period_end',sub.period_end,
    'voice_limit_seconds',voice_limit,'voice_used_seconds',coalesce(used_voice,0),
    'voice_remaining_seconds',greatest(voice_limit-coalesce(used_voice,0),0),
    'ai_calls',coalesce(used_calls,0)
  );
end;$$;
revoke all on function public.get_ai_usage(uuid) from public,anon,authenticated;
grant execute on function public.get_ai_usage(uuid) to service_role;
\n