-- Use trusted PostgreSQL time for owner/admin subscription extensions.
create or replace function public.extend_subscription(
  target_user_id uuid,
  extension_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sub public.subscriptions%rowtype;
  base_at timestamptz;
  end_at timestamptz;
  safe_days integer;
begin
  safe_days := greatest(1, least(coalesce(extension_days,30), 3650));

  select * into sub
  from public.subscriptions
  where owner_id=target_user_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND';
  end if;

  if sub.plan not in ('trial','basic','smart','business') then
    raise exception 'INVALID_PLAN';
  end if;

  base_at := greatest(now(), coalesce(sub.period_end, now()));
  end_at := base_at + make_interval(days => safe_days);

  update public.subscriptions
  set period_end=end_at,
      status='active',
      updated_at=now()
  where owner_id=target_user_id;

  return jsonb_build_object('ok',true,'period_end',end_at);
end;
$$;

revoke all on function public.extend_subscription(uuid,integer) from public,anon,authenticated;
grant execute on function public.extend_subscription(uuid,integer) to service_role;
