-- Paid downgrade lifecycle v3: an approved downgrade payment prepays the next
-- 30-day cycle instead of being marked approved without guaranteed activation.

alter table public.subscriptions
  add column if not exists pending_period_end timestamptz;

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
  pending_end timestamptz;
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

  -- Same-plan early renewal keeps all remaining paid time and adds 30 days.
  if activation_mode='renewal' and is_active and sub.plan=target_plan then
    update public.subscriptions
      set period_end=sub.period_end+interval '30 days',
          pending_plan=null,
          pending_period_end=null,
          updated_at=now()
      where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','renewed','plan',target_plan,
      'period_start',sub.period_start,'period_end',sub.period_end+interval '30 days');
  end if;

  -- A paid downgrade prepays the next lower-tier cycle. Repeated approvals for the
  -- same pending tier extend that prepaid coverage by another 30 days.
  if is_active and current_rank>target_rank then
    pending_end := case
      when sub.pending_plan=target_plan and sub.pending_period_end is not null
        then sub.pending_period_end+interval '30 days'
      else sub.period_end+interval '30 days'
    end;
    update public.subscriptions
      set pending_plan=target_plan,
          pending_period_end=pending_end,
          updated_at=now()
      where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','downgrade_prepaid',
      'plan',sub.plan,'pending_plan',target_plan,'period_start',sub.period_start,
      'period_end',sub.period_end,'pending_period_end',pending_end);
  end if;

  -- Immediate upgrade: keep the current cycle dates and preserve bonus voice.
  if is_active and current_rank>0 and target_rank>current_rank then
    update public.subscriptions
      set plan=target_plan,pending_plan=null,pending_period_end=null,status='active',updated_at=now()
      where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','upgraded','plan',target_plan,
      'period_start',sub.period_start,'period_end',sub.period_end);
  end if;

  -- New purchase or expired paid access starts a fresh 30-day cycle.
  start_at := now();
  end_at := start_at+interval '30 days';

  insert into public.subscriptions(
    owner_id,plan,status,period_start,period_end,bonus_voice_seconds,pending_plan,pending_period_end,updated_at
  )
  values(target_user_id,target_plan,'active',start_at,end_at,
    case when found then sub.bonus_voice_seconds else 0 end,null,null,now())
  on conflict(owner_id) do update
    set plan=excluded.plan,status='active',period_start=excluded.period_start,
        period_end=excluded.period_end,pending_plan=null,pending_period_end=null,updated_at=now();

  return jsonb_build_object('ok',true,'action','activated','plan',target_plan,
    'period_start',start_at,'period_end',end_at);
end;
$$;

revoke all on function public.activate_paid_plan(uuid,text,text) from public,anon,authenticated;
grant execute on function public.activate_paid_plan(uuid,text,text) to service_role;

-- Apply a prepaid downgrade lazily whenever protected server-side access is used.
-- This avoids relying on a browser clock or a background job for correctness.
create or replace function public.apply_due_pending_plan(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sub public.subscriptions%rowtype;
begin
  select * into sub
  from public.subscriptions
  where owner_id=target_user_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'action','no_subscription');
  end if;

  if sub.pending_plan is not null
     and sub.pending_period_end is not null
     and sub.period_end<=now()
     and sub.pending_period_end>sub.period_end then
    update public.subscriptions
      set plan=sub.pending_plan,
          status='active',
          period_start=sub.period_end,
          period_end=sub.pending_period_end,
          pending_plan=null,
          pending_period_end=null,
          updated_at=now()
      where owner_id=target_user_id;

    return jsonb_build_object('ok',true,'action','pending_plan_activated',
      'plan',sub.pending_plan,'period_start',sub.period_end,'period_end',sub.pending_period_end);
  end if;

  return jsonb_build_object('ok',true,'action','unchanged','plan',sub.plan,
    'period_start',sub.period_start,'period_end',sub.period_end,'pending_plan',sub.pending_plan,
    'pending_period_end',sub.pending_period_end);
end;
$$;

revoke all on function public.apply_due_pending_plan(uuid) from public,anon,authenticated;
grant execute on function public.apply_due_pending_plan(uuid) to service_role;

-- consume_ai_usage is server-authoritative and activates a prepaid downgrade before
-- checking entitlement, so the first AI/voice use after expiry sees the paid plan.
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
  used public.ai_period_usage%rowtype;
  voice_limit integer;
  cycle_start timestamptz;
  elapsed_cycles integer;
begin
  insert into public.profiles(owner_id) values(user_id) on conflict(owner_id) do nothing;
  perform public.apply_due_pending_plan(user_id);

  select * into sub from public.subscriptions where owner_id=user_id for update;
  if not found or sub.status<>'active' or sub.period_end<=now() then
    return jsonb_build_object('allowed',false,'reason','subscription_inactive');
  end if;

  voice_limit := case sub.plan
    when 'trial' then 6000 when 'basic' then 6000 when 'smart' then 30000
    when 'business' then 60000 else 0 end;
  voice_limit := voice_limit+sub.bonus_voice_seconds;

  elapsed_cycles := greatest(0, floor(extract(epoch from (now()-sub.period_start))/2592000)::integer);
  cycle_start := sub.period_start + (elapsed_cycles * interval '30 days');

  insert into public.ai_period_usage(owner_id,period_start,voice_seconds,ai_calls)
    values(user_id,cycle_start,0,0)
    on conflict(owner_id,period_start) do nothing;

  select * into used from public.ai_period_usage
    where owner_id=user_id and period_start=cycle_start for update;

  if voice_seconds_to_add>0 and used.voice_seconds+greatest(0,voice_seconds_to_add)>voice_limit then
    return jsonb_build_object('allowed',false,'reason','voice_limit',
      'voice_seconds',used.voice_seconds,'voice_limit',voice_limit);
  end if;

  update public.ai_period_usage
    set voice_seconds=voice_seconds+greatest(0,voice_seconds_to_add),
        ai_calls=ai_calls+greatest(0,ai_calls_to_add)
    where owner_id=user_id and period_start=cycle_start
    returning * into used;

  return jsonb_build_object('allowed',true,'plan',sub.plan,
    'voice_seconds',used.voice_seconds,'voice_limit',voice_limit,'ai_calls',used.ai_calls,
    'usage_period_start',cycle_start,'period_start',sub.period_start,'period_end',sub.period_end);
end;
$$;
revoke all on function public.consume_ai_usage(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_ai_usage(uuid,integer,integer) to service_role;
