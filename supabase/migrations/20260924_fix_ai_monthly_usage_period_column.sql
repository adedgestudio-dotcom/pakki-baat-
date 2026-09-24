begin;

-- Production originally stored the monthly bucket as period_start. The current
-- consume_ai_usage RPC expects period_month. Renaming preserves every usage row
-- and automatically updates indexes/constraints that reference the column.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_monthly_usage'
      and column_name = 'period_start'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_monthly_usage'
      and column_name = 'period_month'
  ) then
    alter table public.ai_monthly_usage
      rename column period_start to period_month;
  elsif not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_monthly_usage'
      and column_name = 'period_month'
  ) then
    alter table public.ai_monthly_usage
      add column period_month date not null
      default date_trunc('month', current_date)::date;
  end if;
end $$;

alter table public.ai_monthly_usage
  alter column period_month set default date_trunc('month', current_date)::date;

create or replace function public.consume_ai_usage(
  user_id uuid,
  voice_seconds_to_add integer default 0,
  ai_calls_to_add integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.subscriptions%rowtype;
  used public.ai_monthly_usage%rowtype;
  voice_limit integer;
begin
  perform public.ensure_user_access(user_id);

  select * into sub
  from public.subscriptions
  where owner_id = user_id
  for update;

  if sub.status <> 'active' or sub.period_end <= now() then
    return jsonb_build_object('allowed', false, 'reason', 'subscription_inactive');
  end if;

  voice_limit := case sub.plan
    when 'trial' then 36000
    when 'basic' then 7200
    when 'smart' then 36000
    when 'business' then 72000
    else 0
  end;
  voice_limit := voice_limit + sub.bonus_voice_seconds;

  insert into public.ai_monthly_usage (
    owner_id,
    period_month,
    voice_seconds,
    ai_calls
  ) values (
    user_id,
    date_trunc('month', current_date)::date,
    0,
    0
  )
  on conflict (owner_id, period_month) do nothing;

  select * into used
  from public.ai_monthly_usage
  where owner_id = user_id
    and period_month = date_trunc('month', current_date)::date
  for update;

  if voice_seconds_to_add > 0
    and used.voice_seconds + voice_seconds_to_add > voice_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'voice_limit',
      'voice_seconds', used.voice_seconds,
      'voice_limit', voice_limit
    );
  end if;

  update public.ai_monthly_usage
  set voice_seconds = voice_seconds + greatest(0, voice_seconds_to_add),
      ai_calls = ai_calls + greatest(0, ai_calls_to_add)
  where owner_id = user_id
    and period_month = date_trunc('month', current_date)::date
  returning * into used;

  return jsonb_build_object(
    'allowed', true,
    'plan', sub.plan,
    'voice_seconds', used.voice_seconds,
    'voice_limit', voice_limit,
    'ai_calls', used.ai_calls
  );
end;
$$;

revoke all on function public.consume_ai_usage(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_usage(uuid, integer, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;