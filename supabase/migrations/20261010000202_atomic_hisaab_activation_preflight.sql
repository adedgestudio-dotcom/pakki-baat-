-- Phase 1C-A activation preflight. No account is enabled by this migration.
begin;

create function public.enable_workspace_hisaab_ledger(target_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare workspace public.workspaces%rowtype; run public.hisaab_ledger_backfill_runs%rowtype;
  item jsonb; identity text; row_count integer; ledger_amount bigint; source_amount bigint; source_paid bigint; active_paid bigint;
begin
  if target_owner_id is null then raise exception 'TARGET_OWNER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hisaab-atomic:'||target_owner_id::text,0));
  select * into workspace from public.workspaces where owner_id=target_owner_id for update;
  if not found then raise exception 'WORKSPACE_NOT_INITIALIZED'; end if;
  perform public.validate_hisaab_snapshot_financial(workspace.payload);
  if exists(select 1 from public.workspace_ledger_modes where owner_id=target_owner_id and enabled) then
    return jsonb_build_object('enabled',true,'revision',workspace.revision,'already_enabled',true);
  end if;
  select * into run from public.hisaab_ledger_backfill_runs where owner_id=target_owner_id and completed_at is not null
    order by started_at desc,id desc limit 1;
  if not found or run.workspace_updated_at<>workspace.updated_at then raise exception 'BACKFILL_NOT_CURRENT'; end if;
  if exists(select 1 from public.hisaab_ledger_backfill_issues where run_id=run.id) then raise exception 'BACKFILL_HAS_UNRESOLVED_ISSUES'; end if;
  if exists(select 1 from public.hisaab_ledger_transactions where owner_id=target_owner_id and metadata->>'legacy_backfill' is distinct from 'true') then
    raise exception 'UNRECONCILED_NON_BACKFILL_LEDGER_ROWS';
  end if;

  for item in select value from jsonb_array_elements(workspace.payload->'jobs') loop
    identity:=item->>'id'; source_amount:=public.hisaab_snapshot_paise(item->'total');
    select count(*),coalesce(sum(l.amount_paise),0) into row_count,ledger_amount
      from public.hisaab_ledger_transactions l where l.owner_id=target_owner_id and l.job_id=identity
      and l.transaction_kind='charge' and l.metadata->>'legacy_job_id'=identity
      and l.metadata->>'legacy_source_fingerprint'=md5(item::text)
      and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    if row_count<>(case when source_amount=0 then 0 else 1 end) or ledger_amount<>source_amount then
      raise exception 'BACKFILL_JOB_CONFLICT:%',identity;
    end if;
    select coalesce(sum(l.amount_paise),0) into active_paid from public.hisaab_ledger_transactions l
      where l.owner_id=target_owner_id and l.job_id=identity and l.transaction_kind='payment'
      and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    source_paid:=public.hisaab_snapshot_paise(item->'paid');
    if active_paid<>source_paid then raise exception 'BACKFILL_JOB_PAID_CONFLICT:%',identity; end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(workspace.payload->'payments','[]'::jsonb)) loop
    identity:=item->>'id'; source_amount:=public.hisaab_snapshot_paise(item->'amount');
    select count(*),coalesce(sum(l.amount_paise),0) into row_count,ledger_amount
      from public.hisaab_ledger_transactions l where l.owner_id=target_owner_id and l.transaction_kind='payment'
      and l.metadata->>'legacy_payment_id'=identity
      and l.metadata->>'legacy_source_fingerprint'=md5(item::text)
      and not exists(select 1 from public.hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    if row_count<>1 or ledger_amount<>source_amount then raise exception 'BACKFILL_PAYMENT_CONFLICT:%',identity; end if;
  end loop;

  insert into public.workspace_ledger_modes(owner_id,enabled,enabled_at)
    values(target_owner_id,true,now())
    on conflict(owner_id) do update set enabled=true,enabled_at=now();
  return jsonb_build_object('enabled',true,'revision',workspace.revision,'already_enabled',false);
end; $$;
revoke all on function public.enable_workspace_hisaab_ledger(uuid) from public, anon, authenticated;
grant execute on function public.enable_workspace_hisaab_ledger(uuid) to service_role;

commit;
