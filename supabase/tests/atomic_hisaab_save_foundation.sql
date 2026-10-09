-- Phase 1C-A fictional fixtures. Every write is rolled back.
begin;
do $$
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','atomic-a@example.test','not-used',now(),'{}','{}',now(),now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','atomic-b@example.test','not-used',now(),'{}','{}',now(),now());
  insert into public.subscriptions(owner_id) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  insert into public.workspaces(owner_id,payload) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '{"owner":"Fixture","business":"Test","jobs":[{"id":"job-1","customer":"Asha Test","work":"Fixture","total":100,"paid":0,"date":"2026-01-01","time":"","status":"Confirmed","source":"fixture"}],"payments":[]}'::jsonb);
  perform public.backfill_hisaab_ledger_workspace('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  perform public.enable_workspace_hisaab_ledger('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
end $$;

set local role authenticated;
do $$
declare v_owner uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; original jsonb; paid_once jsonb; paid_twice jsonb; changed_total jsonb; result jsonb; n integer;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  select payload into original from public.workspaces where owner_id=v_owner;
  paid_once:=jsonb_set(jsonb_set(original,'{jobs,0,paid}','20'::jsonb),'{payments}',
    '[{"id":"11111111-1111-4111-8111-111111111111","customer":"Asha Test","jobId":"job-1","amount":20,"date":"2026-01-02","createdAt":"2026-01-02T10:00:00Z"}]'::jsonb);

  begin
    perform public.save_workspace(paid_once);
    raise exception 'TEST FAILED: legacy save bypassed enabled ledger mode';
  exception when others then
    if position('LEDGER_MODE_REQUIRES_ATOMIC_SAVE' in sqlerrm)=0 then raise; end if;
  end;
  result:=public.save_workspace_with_ledger(paid_once,1);
  if (result->>'revision')::bigint<>2 or (result->>'ledger_events')::int<>1 then raise exception 'TEST FAILED: first atomic payment save: %',result; end if;
  result:=public.save_workspace_with_ledger(paid_once,1);
  if (result->>'revision')::bigint<>2 or result->>'unchanged'<>'true' then raise exception 'TEST FAILED: identical retry changed revision: %',result; end if;
  select count(*) into n from public.hisaab_ledger_transactions where owner_id=v_owner;
  if n<>2 then raise exception 'TEST FAILED: retry duplicated ledger event'; end if;
  begin
    perform public.record_hisaab_ledger_transaction('job-1','Asha Test','payment',100,
      now(),null,'99999999-9999-4999-8999-999999999999',null,'{}'::jsonb);
    raise exception 'TEST FAILED: standalone ledger RPC bypassed enabled mode';
  exception when others then
    if position('LEDGER_MODE_REQUIRES_ATOMIC_SAVE' in sqlerrm)=0 then raise; end if;
  end;

  paid_twice:=jsonb_set(paid_once,'{jobs,0,paid}','50'::jsonb);
  paid_twice:=jsonb_set(paid_twice,'{payments}',(paid_twice->'payments') ||
    '[{"id":"22222222-2222-4222-8222-222222222222","customer":"Asha Test","jobId":"job-1","amount":30,"date":"2026-01-03","createdAt":"2026-01-03T10:00:00Z"}]'::jsonb);
  begin
    perform public.save_workspace_with_ledger(paid_twice,1);
    raise exception 'TEST FAILED: stale revision accepted';
  exception when others then
    if position('WORKSPACE_REVISION_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.save_workspace_with_ledger(jsonb_set(paid_once,'{jobs,0,paid}','30'::jsonb),2);
    raise exception 'TEST FAILED: inconsistent payment total accepted';
  exception when others then
    if position('JOB_PAYMENT_RECONCILIATION_FAILED' in sqlerrm)=0 then raise; end if;
  end;
  select count(*) into n from public.hisaab_ledger_transactions where owner_id=v_owner;
  if n<>2 then raise exception 'TEST FAILED: failed save left ledger rows'; end if;
  if (select revision from public.workspaces where owner_id=v_owner)<>2 then raise exception 'TEST FAILED: failed save advanced revision'; end if;
  begin
    perform public.save_workspace_with_ledger(jsonb_set(paid_once,'{jobs}',
      (paid_once->'jobs')||'[{"id":"job-rollback","customer":"Rollback Test","work":"Fixture","total":60,"paid":10,"date":"2026-01-02","time":"","status":"Confirmed","source":"fixture"}]'::jsonb),2);
    raise exception 'TEST FAILED: inconsistent new job accepted';
  exception when others then
    if position('JOB_PAYMENT_RECONCILIATION_FAILED' in sqlerrm)=0 then raise; end if;
  end;
  if exists(select 1 from public.hisaab_ledger_transactions where owner_id=v_owner and job_id='job-rollback') then
    raise exception 'TEST FAILED: ledger insert survived failed workspace save';
  end if;

  result:=public.save_workspace_with_ledger(paid_twice,2);
  if (result->>'ledger_events')::int<>1 then raise exception 'TEST FAILED: partial payment missing'; end if;
  begin
    perform public.save_workspace_with_ledger(jsonb_set(paid_twice,'{payments}',
      (paid_twice->'payments')||(paid_twice->'payments'->1)),3);
    raise exception 'TEST FAILED: duplicate payment ID accepted';
  exception when others then
    if position('INVALID_OR_DUPLICATE_PAYMENT_ID' in sqlerrm)=0 then raise; end if;
  end;
  changed_total:=jsonb_set(paid_twice,'{jobs,0,total}','120'::jsonb);
  result:=public.save_workspace_with_ledger(changed_total,3);
  if (result->>'ledger_events')::int<>2 then raise exception 'TEST FAILED: total edit not reversed/replaced'; end if;
  if (select count(*) from public.hisaab_ledger_transactions where owner_id=v_owner and transaction_kind='reversal')<>1 then raise exception 'TEST FAILED: charge reversal missing'; end if;
  if (select count(*) from public.hisaab_ledger_transactions l where owner_id=v_owner and transaction_kind='charge' and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id))<>1 then raise exception 'TEST FAILED: active charge count wrong'; end if;

  paid_twice:=jsonb_set(changed_total,'{jobs,0,paid}','45'::jsonb);
  paid_twice:=jsonb_set(paid_twice,'{payments,1,amount}','25'::jsonb);
  result:=public.save_workspace_with_ledger(paid_twice,4);
  if (result->>'ledger_events')::int<>2 then raise exception 'TEST FAILED: payment edit not reversed/replaced'; end if;
  if (select coalesce(sum(l.amount_paise),0) from public.hisaab_ledger_transactions l where l.owner_id=v_owner and l.transaction_kind='payment'
      and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id))<>4500 then raise exception 'TEST FAILED: edited payment ledger balance wrong'; end if;
  result:=public.save_workspace_with_ledger(jsonb_set(paid_twice,'{notes}','[{"id":"note-1","customer":"Asha Test","text":"Nonfinancial","createdAt":"2026-01-04T00:00:00Z"}]'::jsonb),5);
  if (result->>'ledger_events')::int<>0 then raise exception 'TEST FAILED: nonfinancial save created ledger event'; end if;

  result:=public.save_workspace_with_ledger(jsonb_set(jsonb_set(jsonb_set(paid_twice,'{notes}','[{"id":"note-1","customer":"Asha Test","text":"Nonfinancial","createdAt":"2026-01-04T00:00:00Z"}]'::jsonb),'{jobs}','[]'::jsonb),'{payments}','[]'::jsonb),6);
  if (result->>'ledger_events')::int<>0 or (select count(*) from public.hisaab_ledger_transactions where owner_id=v_owner)<>7 then raise exception 'TEST FAILED: deletion erased history'; end if;
  select payload into original from public.workspaces where owner_id=v_owner;
  result:=public.save_workspace_with_ledger(jsonb_set(original,'{jobs}',
    '[{"id":"job-zero-paid","customer":"Zero Paid Test","work":"Fixture","total":35,"paid":0,"date":"2026-01-05","time":"","status":"Confirmed","source":"fixture"}]'::jsonb),7);
  if (result->>'ledger_events')::int<>1 then raise exception 'TEST FAILED: zero-paid job did not produce exactly one charge'; end if;
  if exists(select 1 from public.hisaab_ledger_transactions where owner_id=v_owner and job_id='job-zero-paid' and transaction_kind='payment') then
    raise exception 'TEST FAILED: zero-paid job produced a payment';
  end if;
  perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
  begin
    perform public.save_workspace_with_ledger(paid_once,1);
    raise exception 'TEST FAILED: other account changed owner A workspace';
  exception when others then
    if position('WORKSPACE_NOT_INITIALIZED' in sqlerrm)=0 then raise; end if;
  end;
end $$;
rollback;
