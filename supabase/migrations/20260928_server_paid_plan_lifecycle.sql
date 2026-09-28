-- Centralize paid-plan activation/renewal on trusted PostgreSQL time.
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
begin
  if target_plan not in ('basic','smart','business') then
    raise exception 'INVALID_PLAN';
  end if;

  select * into sub from public.subscriptions
  where owner_id=target_user_id
  for update;

  -- A same-plan renewal made before expiry preserves remaining paid time.
  if activation_mode='renewal'
     and found
     and sub.plan=target_plan
     and sub.period_end>now() then
    start_at := sub.period_start;
    end_at := sub.period_end + interval '30 days';
  else
    -- New purchase, upgrade, downgrade, or expired renewal starts now.
    start_at := now();
    end_at := start_at + interval '30 days';
  end if;

  insert into public.subscriptions(
    owner_id,plan,status,period_start,period_end,bonus_voice_seconds,updated_at
  )
  values(target_user_id,target_plan,'active',start_at,end_at,0,now())
  on conflict(owner_id) do update
  set plan=excluded.plan,
      status='active',
      period_start=excluded.period_start,
      period_end=excluded.period_end,
      bonus_voice_seconds=0,
      updated_at=now();

  return jsonb_build_object(
    'ok',true,'plan',target_plan,'period_start',start_at,'period_end',end_at
  );
end;
$$;
revoke all on function public.activate_paid_plan(uuid,text,text) from public,anon,authenticated;
grant execute on function public.activate_paid_plan(uuid,text,text) to service_role;
