-- Phase 1C-A flag-OFF compatibility; fictional rollback.
begin;
do $$
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('ffffffff-ffff-ffff-ffff-ffffffffffff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','atomic-off@example.test','not-used',now(),'{}','{}',now(),now());
  insert into public.subscriptions(owner_id) values('ffffffff-ffff-ffff-ffff-ffffffffffff');
end $$;
set local role authenticated;
do $$
declare v_owner uuid:='ffffffff-ffff-ffff-ffff-ffffffffffff'; snapshot jsonb:='{"owner":"Fixture","business":"Test","jobs":[],"payments":[]}'::jsonb;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.save_workspace(snapshot);
  if (select revision from public.workspaces where owner_id=v_owner)<>1 then raise exception 'TEST FAILED: legacy initial save revision'; end if;
  perform public.save_workspace(jsonb_set(snapshot,'{business}','"Edited"'::jsonb));
  if (select revision from public.workspaces where owner_id=v_owner)<>2 then raise exception 'TEST FAILED: legacy update revision'; end if;
  begin
    perform public.save_workspace_with_ledger(snapshot,2);
    raise exception 'TEST FAILED: atomic path accepted flag-OFF owner';
  exception when others then
    if position('LEDGER_MODE_DISABLED' in sqlerrm)=0 then raise; end if;
  end;
  if exists(select 1 from public.hisaab_ledger_transactions where owner_id=v_owner) then raise exception 'TEST FAILED: legacy save created ledger row'; end if;
end $$;
rollback;
