-- Phase 1C-A correction: preserve save_workspace entitlement and customer caps
-- for the trusted atomic path. Legacy save_workspace already enforces these.
begin;

create function public.hisaab_snapshot_customer_count(snapshot jsonb) returns integer
language sql stable set search_path = public, pg_temp as $$
  select count(distinct customer)::integer from (
    select lower(btrim(x->>'customer')) customer from jsonb_array_elements(case when jsonb_typeof(snapshot->'jobs')='array' then snapshot->'jobs' else '[]'::jsonb end) x
    union select lower(btrim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(snapshot->'payments')='array' then snapshot->'payments' else '[]'::jsonb end) x
    union select lower(btrim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(snapshot->'notes')='array' then snapshot->'notes' else '[]'::jsonb end) x
    union select lower(btrim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(snapshot->'reminders')='array' then snapshot->'reminders' else '[]'::jsonb end) x
    union select lower(btrim(key)) from jsonb_object_keys(case when jsonb_typeof(snapshot->'customerPhones')='object' then snapshot->'customerPhones' else '{}'::jsonb end) key
  ) names where customer is not null and customer<>''
$$;

create function public.validate_atomic_hisaab_entitlement() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype; customer_limit integer; new_count integer; old_count integer;
begin
  if not exists(select 1 from public.workspace_ledger_modes where owner_id=new.owner_id and enabled) then return new; end if;
  select * into sub from public.subscriptions where owner_id=new.owner_id;
  if not found or sub.status<>'active' or sub.period_end<=now() then raise exception 'SUBSCRIPTION_INACTIVE'; end if;
  customer_limit:=case sub.plan when 'trial' then 100 when 'basic' then 100 when 'smart' then 250 when 'business' then null else 0 end;
  if customer_limit is not null then
    new_count:=public.hisaab_snapshot_customer_count(new.payload);
    old_count:=case when tg_op='UPDATE' then public.hisaab_snapshot_customer_count(old.payload) else 0 end;
    if new_count>customer_limit and new_count>old_count then raise exception 'CUSTOMER_LIMIT_REACHED:%',customer_limit; end if;
  end if;
  return new;
end; $$;
create trigger validate_atomic_hisaab_entitlement
  before insert or update on public.workspaces for each row
  execute function public.validate_atomic_hisaab_entitlement();
revoke all on function public.hisaab_snapshot_customer_count(jsonb),
  public.validate_atomic_hisaab_entitlement() from public, anon, authenticated;

commit;
