-- Phase 1C-A subscription and customer-limit regression; fictional rollback.
begin;
do $$
declare cap_owner uuid:='dddddddd-dddd-dddd-dddd-dddddddddddd'; expired_owner uuid:='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  base_job jsonb:='{"id":"fixture-job","customer":"Customer 1","work":"Fixture","total":100,"paid":0,"date":"2026-01-01","time":"","status":"Confirmed","source":"fixture"}'::jsonb;
  names jsonb;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(cap_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','atomic-cap@example.test','not-used',now(),'{}','{}',now(),now()),
        (expired_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','atomic-expired@example.test','not-used',now(),'{}','{}',now(),now());
  insert into public.subscriptions(owner_id) values(cap_owner),(expired_owner);
  select jsonb_agg(jsonb_build_object('id','note-'||n,'customer','Customer '||n,'text','Fixture','createdAt','2026-01-01T00:00:00Z'))
    into names from generate_series(2,100) n;
  insert into public.workspaces(owner_id,payload) values
    (cap_owner,jsonb_build_object('owner','Fixture','business','Test','jobs',jsonb_build_array(base_job),'payments','[]'::jsonb,'notes',names)),
    (expired_owner,jsonb_build_object('owner','Fixture','business','Test','jobs',jsonb_build_array(base_job),'payments','[]'::jsonb));
  perform public.backfill_hisaab_ledger_workspace(cap_owner);
  perform public.backfill_hisaab_ledger_workspace(expired_owner);
  perform public.enable_workspace_hisaab_ledger(cap_owner);
  perform public.enable_workspace_hisaab_ledger(expired_owner);
  update public.subscriptions set status='expired' where owner_id=expired_owner;
end $$;
set local role authenticated;
do $$
declare cap_owner uuid:='dddddddd-dddd-dddd-dddd-dddddddddddd'; expired_owner uuid:='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'; incoming jsonb;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',cap_owner::text,true);
  select jsonb_set(payload,'{notes}',payload->'notes'||jsonb_build_array(jsonb_build_object('id','note-101','customer','Customer 101','text','Fixture','createdAt','2026-01-01T00:00:00Z'))) into incoming from public.workspaces where owner_id=cap_owner;
  begin
    perform public.save_workspace_with_ledger(incoming,1);
    raise exception 'TEST FAILED: customer cap bypassed';
  exception when others then
    if position('CUSTOMER_LIMIT_REACHED' in sqlerrm)=0 then raise; end if;
  end;
  if (select revision from public.workspaces where owner_id=cap_owner)<>1 then raise exception 'TEST FAILED: rejected customer-cap save advanced revision'; end if;
  perform set_config('request.jwt.claim.sub',expired_owner::text,true);
  select jsonb_set(payload,'{business}','"Changed"'::jsonb) into incoming from public.workspaces where owner_id=expired_owner;
  begin
    perform public.save_workspace_with_ledger(incoming,1);
    raise exception 'TEST FAILED: inactive subscription saved';
  exception when others then
    if position('SUBSCRIPTION_INACTIVE' in sqlerrm)=0 then raise; end if;
  end;
end $$;
rollback;
