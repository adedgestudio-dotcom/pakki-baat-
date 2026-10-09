-- Phase 1C-A preflight conflict tests. All fixtures roll back.
begin;
do $$
declare v_owner uuid:='cccccccc-cccc-cccc-cccc-cccccccccccc'; snapshot jsonb;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','atomic-conflict@example.test','not-used',now(),'{}','{}',now(),now());
  insert into public.subscriptions(owner_id) values(v_owner);
  snapshot:='{"owner":"Fixture","business":"Test","jobs":[{"id":"conflict-job","customer":"Conflict Test","work":"Fixture","total":100,"paid":20,"date":"2026-01-01","time":"","status":"Confirmed","source":"fixture"}],"payments":[{"id":"duplicate-string-id","customer":"Conflict Test","jobId":"conflict-job","amount":10,"date":"2026-01-02","createdAt":"2026-01-02T10:00:00Z"},{"id":"duplicate-string-id","customer":"Conflict Test","jobId":"conflict-job","amount":10,"date":"2026-01-02","createdAt":"2026-01-02T10:00:00Z"}]}'::jsonb;
  insert into public.workspaces(owner_id,payload) values(v_owner,snapshot);
  perform public.backfill_hisaab_ledger_workspace(v_owner);
  begin
    perform public.enable_workspace_hisaab_ledger(v_owner);
    raise exception 'TEST FAILED: duplicate legacy payment IDs enabled';
  exception when others then
    if position('INVALID_OR_DUPLICATE_PAYMENT_ID' in sqlerrm)=0 then raise; end if;
  end;
  if exists(select 1 from public.workspace_ledger_modes where owner_id=v_owner and enabled) then raise exception 'TEST FAILED: conflict enabled ledger mode'; end if;
  update public.workspaces set payload=jsonb_set(snapshot,'{payments}',(snapshot->'payments')-1),updated_at=now()+interval '1 second' where owner_id=v_owner;
  begin
    perform public.enable_workspace_hisaab_ledger(v_owner);
    raise exception 'TEST FAILED: stale backfill enabled';
  exception when others then
    if position('BACKFILL_NOT_CURRENT' in sqlerrm)=0 then raise; end if;
  end;
end $$;
rollback;
