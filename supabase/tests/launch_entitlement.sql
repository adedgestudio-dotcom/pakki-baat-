-- Isolated staging entitlement verification. All mutations roll back.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';
create temp table entitlement_results(name text);
grant select,insert on entitlement_results to authenticated;
select set_config('request.jwt.claims','{"sub":"740411d2-a2c9-4dd6-84ba-8679514d28fb","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','740411d2-a2c9-4dd6-84ba-8679514d28fb',true);
do $test$
declare baseline public.subscriptions%rowtype; p jsonb; r bigint; mode text; reply jsonb;
begin
 if not exists(select 1 from auth.users where id='740411d2-a2c9-4dd6-84ba-8679514d28fb' and email='ledger-staging-01@example.com') then raise exception 'STAGING_QA_REQUIRED'; end if;
 select * into strict baseline from public.subscriptions where owner_id=auth.uid();
 foreach mode in array array['expired','inactive','absent'] loop
  if mode='expired' then update public.subscriptions set period_end=now()-interval '1 day' where owner_id=auth.uid();
  elsif mode='inactive' then update public.subscriptions set period_end=now()+interval '1 day',status='expired' where owner_id=auth.uid();
  else delete from public.subscriptions where owner_id=auth.uid(); end if;
  execute 'set local role authenticated';
  select w.payload,w.revision into p,r from public.workspaces w where owner_id=auth.uid();
  if p is null then raise exception 'READ_ACCESS_LOST'; end if;
  insert into pg_temp.entitlement_results values(mode||': existing data readable');
  begin
   perform public.save_workspace(jsonb_set(p,'{owner}','"Entitlement test"'));
   raise exception 'LEGACY_WRITE_ALLOWED';
  exception when others then if sqlerrm<>'SUBSCRIPTION_INACTIVE' then raise; end if; end;
  insert into pg_temp.entitlement_results values(mode||': legacy write rejected');
  begin
   perform public.save_workspace_with_ledger(jsonb_set(p,'{owner}','"Entitlement test"'),r);
   raise exception 'LEDGER_WRITE_ALLOWED';
  exception when others then if sqlerrm<>'SUBSCRIPTION_INACTIVE' then raise; end if; end;
  insert into pg_temp.entitlement_results values(mode||': ledger write rejected');
  execute 'reset role';
 end loop;
 insert into public.subscriptions select baseline.*;
 execute 'set local role authenticated';
 select w.payload,w.revision into p,r from public.workspaces w where owner_id=auth.uid();
 reply:=public.save_workspace_with_ledger(jsonb_set(p,'{owner}','"Entitlement test"'),r);
 if (reply->>'unchanged')::boolean is distinct from false or (reply->>'ledger_events')::integer<>0 then raise exception 'REACTIVATION_FAILED'; end if;
 insert into pg_temp.entitlement_results values('reactivation allows revisioned nonfinancial save');
 execute 'reset role';
end $test$;
select count(*) passed,0 failed,jsonb_agg(name) evidence from pg_temp.entitlement_results;
rollback;
