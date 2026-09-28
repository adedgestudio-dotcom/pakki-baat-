-- Centralize suspend/reactivate checks on trusted PostgreSQL time.
create or replace function public.set_subscription_status(
  target_user_id uuid,
  target_status text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sub public.subscriptions%rowtype;
begin
  if target_status not in ('active','suspended') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into sub
  from public.subscriptions
  where owner_id=target_user_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND';
  end if;

  if target_status='active' and (sub.period_end is null or sub.period_end<=now()) then
    raise exception 'SUBSCRIPTION_EXPIRED';
  end if;

  update public.subscriptions
  set status=target_status,
      updated_at=now()
  where owner_id=target_user_id;

  return jsonb_build_object('ok',true,'status',target_status,'period_end',sub.period_end);
end;
$$;

revoke all on function public.set_subscription_status(uuid,text) from public,anon,authenticated;
grant execute on function public.set_subscription_status(uuid,text) to service_role;
