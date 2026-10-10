-- Disposable staging/local verification. Every fixture is rolled back.
begin;
do $$
declare fixture_owner_id uuid:='cccccccc-cccc-cccc-cccc-cccccccccccc'; request_id uuid; replay_id uuid; initial_created boolean; replay_created boolean; result jsonb;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(fixture_owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','payment-idempotency@example.test','not-used',now(),'{}','{}',now(),now());
  set local role service_role;
  select r.id,r.created into request_id,initial_created from public.reserve_subscription_payment_request(fixture_owner_id,'payment-idempotency@example.test','basic',99,'QA-REF','cccccccc-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',repeat('a',64)) r;
  select r.id,r.created into replay_id,replay_created from public.reserve_subscription_payment_request(fixture_owner_id,'payment-idempotency@example.test','basic',99,'QA-REF','cccccccc-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',repeat('a',64)) r;
  if request_id is null or request_id<>replay_id or initial_created is not true or replay_created is not false or (select count(*) from public.payment_requests pr where pr.owner_id=fixture_owner_id)<>1 then raise exception 'TEST FAILED: identical replay did not reuse exactly one payment request'; end if;
  begin
    perform public.reserve_subscription_payment_request(fixture_owner_id,'payment-idempotency@example.test','smart',179,'QA-REF',null,'11111111-1111-4111-8111-111111111111',repeat('b',64));
    raise exception 'TEST FAILED: conflicting idempotency key accepted';
  exception when others then if position('PAYMENT_REQUEST_IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if; end;
  perform public.reserve_subscription_payment_request(fixture_owner_id,'payment-idempotency@example.test','smart',179,'QA-REF-2',null,'22222222-2222-4222-8222-222222222222',repeat('b',64));
  if (select count(*) from public.payment_requests pr where pr.owner_id=fixture_owner_id)<>2 then raise exception 'TEST FAILED: legitimate new request rejected'; end if;

  insert into public.subscriptions(owner_id,plan,status,period_start,period_end,pending_plan,pending_period_end)
  values(fixture_owner_id,'smart','active',now()-interval '30 days',now()-interval '1 minute','basic',now()+interval '29 days');
  result:=public.apply_due_pending_plans();
  if (result->>'activated')::integer<>1 or (select s.plan from public.subscriptions s where s.owner_id=fixture_owner_id)<>'basic' or (select s.pending_plan from public.subscriptions s where s.owner_id=fixture_owner_id) is not null then raise exception 'TEST FAILED: due plan was not activated exactly once'; end if;
  result:=public.apply_due_pending_plans();
  if (result->>'activated')::integer<>0 then raise exception 'TEST FAILED: lifecycle replay activated twice'; end if;
end $$;
rollback;
