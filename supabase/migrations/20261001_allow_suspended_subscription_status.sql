-- Repair legacy production deployments whose subscriptions status check
-- predates the suspended lifecycle state used by set_subscription_status().
alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('active','past_due','suspended','expired','cancelled'));
