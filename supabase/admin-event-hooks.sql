-- Run manually after admin-signup-hook.sql, replacing both placeholders here too.
-- These are database INSERT events; user API email alerts remain independent.
create or replace function public.notify_admin_payment_request() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    perform net.http_post(
      url := 'https://<ADMIN_DOMAIN>/api/hook',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Hook-Secret', '<HOOK_SECRET>'),
      body := jsonb_build_object('type', 'payment', 'id', new.id, 'plan', new.plan, 'amount', new.amount)
    );
  exception when others then null;
  end;
  return new;
end;
$$;
drop trigger if exists admin_payment_request_push on public.payment_requests;
create trigger admin_payment_request_push after insert on public.payment_requests
for each row execute function public.notify_admin_payment_request();

create or replace function public.notify_admin_trial_claim() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    perform net.http_post(
      url := 'https://<ADMIN_DOMAIN>/api/hook',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Hook-Secret', '<HOOK_SECRET>'),
      body := jsonb_build_object('type', 'trial', 'id', new.first_owner_id, 'claimed_at', new.claimed_at)
    );
  exception when others then null;
  end;
  return new;
end;
$$;
drop trigger if exists admin_trial_claim_push on public.trial_claims;
create trigger admin_trial_claim_push after insert on public.trial_claims
for each row execute function public.notify_admin_trial_claim();

-- Rollback (run separately):
-- drop trigger if exists admin_payment_request_push on public.payment_requests;
-- drop function if exists public.notify_admin_payment_request();
-- drop trigger if exists admin_trial_claim_push on public.trial_claims;
-- drop function if exists public.notify_admin_trial_claim();
