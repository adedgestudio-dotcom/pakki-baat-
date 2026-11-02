-- PB-04: additive protection. No existing payload, ledger row, policy or mode is changed.
begin;
set local lock_timeout = '5s';

create function public.legacy_workspace_financial_state(p_payload jsonb)
returns jsonb language plpgsql immutable security invoker
set search_path = pg_catalog
as $$
declare jobs jsonb; payments jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'jobs','[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'payments','[]'::jsonb)) <> 'array' then
    raise exception 'LEGACY_INVALID_FINANCIAL_STATE';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'jobs','[]'::jsonb)) j where jsonb_typeof(j)<>'object')
     or exists(select 1 from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) p where jsonb_typeof(p)<>'object') then
    raise exception 'LEGACY_INVALID_FINANCIAL_STATE';
  end if;
  select coalesce(jsonb_agg(v order by v->>'id',v::text),'[]'::jsonb) into jobs from (
    select jsonb_build_object('id',j->'id','customer',j->'customer','total',j->'total','paid',j->'paid') v
    from jsonb_array_elements(coalesce(p_payload->'jobs','[]'::jsonb)) j
  ) projected;
  select coalesce(jsonb_agg(v order by v->>'id',v::text),'[]'::jsonb) into payments from (
    select jsonb_build_object('id',p->'id','jobId',p->'jobId','customer',p->'customer',
      'amount',p->'amount','date',p->'date','createdAt',p->'createdAt',
      'correctionReason',p->'correctionReason','correctionNote',p->'correctionNote') v
    from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) p
  ) projected;
  return jsonb_build_object('jobs',jobs,'payments',payments);
end;
$$;
revoke all on function public.legacy_workspace_financial_state(jsonb) from public, anon;
grant execute on function public.legacy_workspace_financial_state(jsonb) to authenticated, service_role;

create function public.guard_legacy_workspace_financial_write()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $$
declare target_owner uuid; mode_enabled boolean := false; prior jsonb; next_payload jsonb;
begin
  if tg_op='UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'WORKSPACE_OWNER_IMMUTABLE';
  end if;
  target_owner := case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  -- Never trust a client GUC or JWT metadata to bypass this guard.
  if to_regclass('public.workspace_ledger_modes') is not null then
    select enabled into mode_enabled from public.workspace_ledger_modes where owner_id=target_owner;
  end if;
  if coalesce(mode_enabled,false) then
    -- Existing atomic writer, revision, suspension and entitlement guards remain authoritative.
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='INSERT' then
    -- BEFORE INSERT also fires before ON CONFLICT UPDATE. Lock/read the existing
    -- owner row so a stale upsert cannot substitute old financial state.
    select payload into prior from public.workspaces where owner_id=target_owner for update;
    if not found then prior := '{"jobs":[],"payments":[]}'::jsonb; end if;
    next_payload := new.payload;
  elsif tg_op='UPDATE' then
    -- OLD is the locked current row, including after READ COMMITTED rechecks.
    prior := old.payload;
    next_payload := new.payload;
  else
    prior := old.payload;
    next_payload := '{"jobs":[],"payments":[]}'::jsonb;
  end if;
  if public.legacy_workspace_financial_state(prior)
       is distinct from public.legacy_workspace_financial_state(next_payload) then
    raise exception 'LEGACY_WORKSPACE_READ_ONLY: financial state requires revision-checked saving';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.guard_legacy_workspace_financial_write() from public, anon, authenticated, service_role;

create trigger legacy_financial_read_only_guard
before insert or update or delete on public.workspaces
for each row execute function public.guard_legacy_workspace_financial_write();

commit;
