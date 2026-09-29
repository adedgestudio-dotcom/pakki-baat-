-- Paid plan lifecycle v2: subscription-period voice usage, immediate upgrades,
-- scheduled downgrades, preserved bonus voice, and server-authoritative renewal dates.

alter table public.subscriptions
  add column if not exists pending_plan text
    check (pending_plan is null or pending_plan in ('basic','smart','business'));

alter table public.ai_monthly_usage
  add column if not exists subscription_period_start timestamptz;

create index if not exists ai_monthly_usage_owner_subscription_period_idx
  on public.ai_monthly_usage(owner_id, subscription_period_start);

create or replace function public.activate_paid_plan(
  target_user_id uuid,
  target_plan text,
  activation_mode text default 'purchase'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sub public.subscriptions%rowtype;
  start_at timestamptz;
  end_at timestamptz;
  current_rank integer;
  target_rank integer;
  is_active boolean;
begin
  if target_plan not in ('basic','smart','business') then
    raise exception 'INVALID_PLAN';
  end if;

  select * into sub
  from public.subscriptions
  where owner_id=target_user_id
  for update;

  is_active := found and sub.status='active' and sub.period_end>now();
  current_rank := case when found then case sub.plan
    when 'basic' then 1 when 'smart' then 2 when 'business' then 3 else 0 end else 0 end;
  target_rank := case target_plan when 'basic' then 1 when 'smart' then 2 when 'business' then 3 end;

  -- Same-plan early renewal: keep remaining paid time and add 30 days.
  if activation_mode='renewal' and is_active and sub.plan=target_plan then
    update public.subscriptions
      set period_end=sub.period_end+interval '30 days',
          pending_plan=null,
          updated_at=now()
      where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','renewed','plan',target_plan,
      'period_start',sub.period_start,'period_end',sub.period_end+interval '30 days');
  end if;

  -- Downgrades are scheduled for the next cycle so current paid limits remain intact.
  if is_active and current_rank>target_rank then
    update public.subscriptions
      set pending_plan=target_plan, updated_at=now()
      where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','downgrade_scheduled',
      'plan',sub.plan,'pending_plan',target_plan,'period_start',sub.period_start,'period_end',sub.period_end);
  end if;

  -- Immediate upgrade: keep the current cycle dates, preserve bonus voice.
  if is_active and current_rank>0 and target_rank>current_rank then
    update public.subscriptions
      set plan=target_plan, pending_plan=null, status='active', updated_at=now()
      where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','upgraded','plan',target_plan,
      'period_start',sub.period_start,'period_end',sub.period_end);
  end if;

  -- New purchase or expired paid access starts a fresh 30-day cycle.
  start_at := now();
  end_at := start_at+interval '30 days';

  insert into public.subscriptions(
    owner_id,plan,status,period_start,period_end,bonus_voice_seconds,pending_plan,updated_at
  )
  values(target_user_id,target_plan,'active',start_at,end_at,
    case when found then sub.bonus_voice_seconds else 0 end,null,now())
  on conflict(owner_id) do update
    set plan=excluded.plan,status='active',period_start=excluded.period_start,
        period_end=excluded.period_end,pending_plan=null,updated_at=now();

  return jsonb_build_object('ok',true,'action','activated','plan',target_plan,
    'period_start',start_at,'period_end',end_at);
end;
$$;

revoke all on function public.activate_paid_plan(uuid,text,text) from public,anon,authenticated;
grant execute on function public.activate_paid_plan(uuid,text,text) to service_role;

create or replace function public.apply_pending_plan(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare sub public.subscriptions%rowtype; next_plan text;
begin
  select * into sub from public.subscriptions where owner_id=target_user_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  if sub.pending_plan is null then
    return jsonb_build_object('ok',true,'changed',false,'plan',sub.plan);
  end if;
  if sub.period_end>now() then
    return jsonb_build_object('ok',true,'changed',false,'plan',sub.plan,'pending_plan',sub.pending_plan);
  end if;
  next_plan:=sub.pending_plan;
  update public.subscriptions
    set plan=next_plan,pending_plan=null,status='active',
        period_start=now(),period_end=now()+interval '30 days',updated_at=now()
    where owner_id=target_user_id;
  return jsonb_build_object('ok',true,'changed',true,'plan',next_plan);
end;
$$;
revoke all on function public.apply_pending_plan(uuid) from public,anon,authenticated;
grant execute on function public.apply_pending_plan(uuid) to service_role;

create or replace function public.consume_ai_usage(
  user_id uuid,
  voice_seconds_to_add integer default 0,
  ai_calls_to_add integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sub public.subscriptions%rowtype;
  used_voice integer:=0;
  used_calls integer:=0;
  voice_limit integer;
begin
  insert into public.profiles(owner_id) values(user_id) on conflict(owner_id) do nothing;

  select * into sub from public.subscriptions where owner_id=user_id for update;
  if not found or sub.status<>'active' or sub.period_end<=now() then
    return jsonb_build_object('allowed',false,'reason','subscription_inactive');
  end if;

  voice_limit := case sub.plan
    when 'trial' then 6000 when 'basic' then 6000 when 'smart' then 30000
    when 'business' then 60000 else 0 end;
  voice_limit := voice_limit+sub.bonus_voice_seconds;

  -- Usage is keyed to the subscription cycle start, not the calendar month.
  select coalesce(sum(voice_seconds),0),coalesce(sum(ai_calls),0)
    into used_voice,used_calls
  from public.ai_monthly_usage
  where owner_id=user_id and subscription_period_start=sub.period_start;

  if voice_seconds_to_add>0 and used_voice+greatest(0,voice_seconds_to_add)>voice_limit then
    return jsonb_build_object('allowed',false,'reason','voice_limit',
      'voice_seconds',used_voice,'voice_limit',voice_limit);
  end if;

  insert into public.ai_monthly_usage(
    owner_id,period_month,subscription_period_start,voice_seconds,ai_calls
  ) values(
    user_id,date_trunc('month',current_date)::date,sub.period_start,
    greatest(0,voice_seconds_to_add),greatest(0,ai_calls_to_add)
  )
  on conflict(owner_id,period_month) do update
    set subscription_period_start=excluded.subscription_period_start,
        voice_seconds=case
          when ai_monthly_usage.subscription_period_start=excluded.subscription_period_start
          then ai_monthly_usage.voice_seconds+excluded.voice_seconds else excluded.voice_seconds end,
        ai_calls=case
          when ai_monthly_usage.subscription_period_start=excluded.subscription_period_start
          then ai_monthly_usage.ai_calls+excluded.ai_calls else excluded.ai_calls end
  returning voice_seconds,ai_calls into used_voice,used_calls;

  return jsonb_build_object('allowed',true,'plan',sub.plan,
    'voice_seconds',used_voice,'voice_limit',voice_limit,'ai_calls',used_calls,
    'period_start',sub.period_start,'period_end',sub.period_end);
end;
$$;
revoke all on function public.consume_ai_usage(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_ai_usage(uuid,integer,integer) to service_role;
