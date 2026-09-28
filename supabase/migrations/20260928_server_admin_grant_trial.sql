-- Owner override: grant a fresh 30-day trial using trusted PostgreSQL time.
create or replace function public.admin_grant_trial(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  start_at timestamptz := now();
  end_at timestamptz := now() + interval '30 days';
begin
  if not exists (select 1 from auth.users where id=target_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.subscriptions(
    owner_id,plan,status,period_start,period_end,bonus_voice_seconds,updated_at
  )
  values(target_user_id,'trial','active',start_at,end_at,0,now())
  on conflict(owner_id) do update
  set plan='trial',
      status='active',
      period_start=start_at,
      period_end=end_at,
      bonus_voice_seconds=0,
      updated_at=now();

  return jsonb_build_object('ok',true,'plan','trial','period_start',start_at,'period_end',end_at);
end;
$$;

revoke all on function public.admin_grant_trial(uuid) from public,anon,authenticated;
grant execute on function public.admin_grant_trial(uuid) to service_role;
