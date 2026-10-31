-- Additive protection for subscription payment request replay/double-submit.
alter table public.payment_requests
  add column if not exists idempotency_key uuid,
  add column if not exists request_fingerprint text;

create unique index if not exists payment_requests_owner_idempotency_key_unique
  on public.payment_requests(owner_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.reserve_subscription_payment_request(
  p_owner_id uuid, p_email text, p_plan text, p_amount integer,
  p_transaction_ref text, p_proof_path text, p_idempotency_key uuid,
  p_request_fingerprint text
) returns table(id uuid, proof_path text, status text, created boolean)
language plpgsql security definer set search_path=public as $$
declare existing public.payment_requests%rowtype;
begin
  if p_owner_id is null or p_idempotency_key is null then raise exception 'PAYMENT_REQUEST_IDEMPOTENCY_REQUIRED'; end if;
  if p_plan not in ('basic','smart','business') or p_amount <= 0 then raise exception 'INVALID_PAYMENT_REQUEST'; end if;
  if p_request_fingerprint is null or length(p_request_fingerprint) <> 64 or p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PAYMENT_REQUEST_FINGERPRINT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_idempotency_key::text, 0));
  select * into existing from public.payment_requests where owner_id=p_owner_id and idempotency_key=p_idempotency_key for update;
  if found then
    if existing.request_fingerprint is distinct from p_request_fingerprint then raise exception 'PAYMENT_REQUEST_IDEMPOTENCY_CONFLICT'; end if;
    return query select existing.id, existing.proof_path, existing.status, false;
    return;
  end if;
  insert into public.payment_requests(owner_id,email,plan,amount,transaction_ref,proof_path,status,idempotency_key,request_fingerprint)
  values(p_owner_id,p_email,p_plan,p_amount,p_transaction_ref,p_proof_path,'pending',p_idempotency_key,p_request_fingerprint)
  returning payment_requests.id,payment_requests.proof_path,payment_requests.status into id,proof_path,status;
  created:=true; return next;
end;
$$;
revoke all on function public.reserve_subscription_payment_request(uuid,text,text,integer,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_subscription_payment_request(uuid,text,text,integer,text,text,uuid,text) to service_role;

-- Called by the authorized daily lifecycle job. The per-owner function locks
-- the subscription row, so overlapping jobs activate each due transition once.
create or replace function public.apply_due_pending_plans()
returns jsonb language plpgsql security definer set search_path=public as $$
declare candidate record; result jsonb; activated integer:=0;
begin
  for candidate in select owner_id from public.subscriptions
    where pending_plan is not null and pending_period_end is not null
      and period_end<=now() and pending_period_end>period_end
    order by period_end for update skip locked
  loop
    result:=public.apply_due_pending_plan(candidate.owner_id);
    if result->>'action'='pending_plan_activated' then activated:=activated+1; end if;
  end loop;
  return jsonb_build_object('ok',true,'activated',activated);
end;
$$;
revoke all on function public.apply_due_pending_plans() from public,anon,authenticated;
grant execute on function public.apply_due_pending_plans() to service_role;
