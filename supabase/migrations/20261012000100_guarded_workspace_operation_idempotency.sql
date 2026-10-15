-- ADDITIVE, STAGING-REVIEWED ONLY.
--
-- This wrapper is for the future guarded journal path. It does not change the
-- legacy save_workspace(jsonb) or save_workspace_with_ledger(jsonb,bigint)
-- contracts, and no account is enabled by this migration.
--
-- Receipt pruning is intentionally deferred. Before any bounded retention is
-- introduced, every guarded write must keep revisions strictly monotonic and
-- reject an old expected_revision before it can mutate a workspace.
begin;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_extension extension
      join pg_catalog.pg_namespace namespace on namespace.oid = extension.extnamespace
     where extension.extname = 'pgcrypto' and namespace.nspname = 'extensions'
  ) then
    raise exception 'GUARDED_OPERATION_REQUIRES_PGCRYPTO_IN_EXTENSIONS_SCHEMA';
  end if;
end;
$$;

create table public.workspace_operation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  base_revision bigint not null check (base_revision > 0),
  resulting_revision bigint not null check (resulting_revision > base_revision),
  resulting_snapshot_sha256 text not null check (resulting_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

create index workspace_operation_receipts_owner_revision_idx
  on public.workspace_operation_receipts(owner_id, resulting_revision desc);

alter table public.workspace_operation_receipts enable row level security;
revoke all on public.workspace_operation_receipts from public, anon, authenticated;

-- No SELECT policy or table grant is intentional: authenticated callers obtain
-- their own receipt only through the exact guarded-operation RPC below.

create function public.save_workspace_guarded_operation(
  p_operation_id uuid,
  p_expected_revision bigint,
  p_payload jsonb
)
returns table(
  owner_id uuid,
  operation_id uuid,
  payload_sha256 text,
  base_revision bigint,
  resulting_revision bigint,
  resulting_snapshot_sha256 text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_workspace public.workspaces%rowtype;
  v_receipt public.workspace_operation_receipts%rowtype;
  v_payload_sha256 text;
  v_resulting_snapshot_sha256 text;
  v_result jsonb;
  v_resulting_revision bigint;
begin
  if v_owner is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_operation_id is null then raise exception 'OPERATION_ID_REQUIRED'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'INVALID_EXPECTED_REVISION';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_WORKSPACE_SNAPSHOT';
  end if;

  -- Always take the legacy atomic RPC's owner lock first.  The nested call to
  -- save_workspace_with_ledger takes this identical transaction-scoped lock;
  -- PostgreSQL treats that reentrant acquisition by this transaction as safe.
  -- Keeping this order (owner lock, operation lock, workspace row lock) also
  -- prevents an inversion with a concurrent direct legacy atomic save.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hisaab-atomic:' || v_owner::text, 0)
  );

  -- Serialize same-owner/same-operation retries before looking up the receipt.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('guarded-workspace-operation:' || v_owner::text || ':' || p_operation_id::text, 0)
  );

  v_payload_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select * into v_receipt
    from public.workspace_operation_receipts
   where workspace_operation_receipts.owner_id = v_owner
      and workspace_operation_receipts.operation_id = p_operation_id;

  if found then
    if v_receipt.base_revision <> p_expected_revision
       or v_receipt.payload_sha256 <> v_payload_sha256 then
      raise exception 'OPERATION_ID_REUSED';
    end if;
    return query select v_receipt.owner_id, v_receipt.operation_id,
      v_receipt.payload_sha256, v_receipt.base_revision,
      v_receipt.resulting_revision, v_receipt.resulting_snapshot_sha256,
      v_receipt.created_at;
    return;
  end if;

  -- Lock the workspace after both advisory locks and before revision
  -- validation. save_workspace_with_ledger follows the owner-lock then row-lock
  -- portion of this ordering, so concurrent distinct operations serialize
  -- safely without lock inversion.
  select * into v_workspace from public.workspaces
   where workspaces.owner_id = v_owner for update;
  if not found then raise exception 'WORKSPACE_NOT_INITIALIZED'; end if;
  if v_workspace.revision <> p_expected_revision then
    raise exception 'WORKSPACE_REVISION_CONFLICT';
  end if;

  -- Guarded journals are revisioned ledger workspaces only. This reuses the
  -- established financial validation, entitlement trigger, immutable ledger
  -- writes, and payment-source duplicate prevention without a weaker path.
  if not exists (
    select 1 from public.workspace_ledger_modes
     where workspace_ledger_modes.owner_id = v_owner and enabled
  ) then
    raise exception 'LEDGER_MODE_DISABLED';
  end if;

  -- The existing workspace trigger permits this same security-definer owner
  -- while the owner GUC is set. The nested legacy atomic RPC preserves this
  -- local setting, including when it returns an unchanged response.
  perform pg_catalog.set_config('app.hisaab_atomic_owner', v_owner::text, true);
  v_result := public.save_workspace_with_ledger(p_payload, p_expected_revision);
  v_resulting_revision := (v_result ->> 'revision')::bigint;
  if v_resulting_revision <> p_expected_revision + 1 then
    -- save_workspace_with_ledger deliberately leaves exact no-op payloads at
    -- the old revision. Guarded operations must advance even for no-ops so a
    -- pruned old receipt can never become replayable at the same revision.
    if coalesce((v_result ->> 'unchanged')::boolean, false)
       and v_resulting_revision = p_expected_revision then
      update public.workspaces
         set payload = p_payload, updated_at = now()
       where workspaces.owner_id = v_owner
       returning revision into v_resulting_revision;
    else
      raise exception 'INVALID_GUARDED_WORKSPACE_SAVE_RESPONSE';
    end if;
  end if;

  if v_resulting_revision <> p_expected_revision + 1 then
    raise exception 'GUARDED_WORKSPACE_REVISION_NOT_ADVANCED';
  end if;

  -- Read the persisted row rather than echoing the request digest. This binds
  -- the receipt to the exact JSONB snapshot that committed with the revision.
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(workspaces.payload::text, 'UTF8'), 'sha256'),
    'hex'
  ) into v_resulting_snapshot_sha256
    from public.workspaces
   where workspaces.owner_id = v_owner
     and workspaces.revision = v_resulting_revision;
  if v_resulting_snapshot_sha256 is null then
    raise exception 'GUARDED_WORKSPACE_RESULT_MISSING';
  end if;

  insert into public.workspace_operation_receipts(
    owner_id, operation_id, payload_sha256, base_revision,
    resulting_revision, resulting_snapshot_sha256
  ) values (
    v_owner, p_operation_id, v_payload_sha256, p_expected_revision,
    v_resulting_revision, v_resulting_snapshot_sha256
  ) returning * into v_receipt;

  return query select v_receipt.owner_id, v_receipt.operation_id,
    v_receipt.payload_sha256, v_receipt.base_revision,
    v_receipt.resulting_revision, v_receipt.resulting_snapshot_sha256,
    v_receipt.created_at;
end;
$$;

-- The existing workspace-write guard trusts the owner of
-- save_workspace_with_ledger. This wrapper must have the same definer owner;
-- abort rather than quietly creating a no-op path that cannot advance revision.
do $$
declare v_atomic_owner oid; v_guarded_owner oid;
begin
  select proowner into v_atomic_owner
    from pg_catalog.pg_proc
   where oid = 'public.save_workspace_with_ledger(jsonb,bigint)'::regprocedure;
  select proowner into v_guarded_owner
    from pg_catalog.pg_proc
   where oid = 'public.save_workspace_guarded_operation(uuid,bigint,jsonb)'::regprocedure;
  if v_atomic_owner is null or v_guarded_owner is null
     or v_atomic_owner <> v_guarded_owner then
    raise exception 'GUARDED_OPERATION_WRITER_OWNER_MISMATCH';
  end if;
end;
$$;

revoke all on function public.save_workspace_guarded_operation(uuid,bigint,jsonb)
  from public, anon;
grant execute on function public.save_workspace_guarded_operation(uuid,bigint,jsonb)
  to authenticated;

commit;
