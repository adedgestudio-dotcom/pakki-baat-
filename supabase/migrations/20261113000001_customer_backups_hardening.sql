-- Keep the already-applied customer backup schema; tighten writes and policy checks.
drop policy if exists workspace_backup_settings_select_own on public.workspace_backup_settings;
create policy workspace_backup_settings_select_own on public.workspace_backup_settings
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists customer_backups_select_own on public.customer_backups;
create policy customer_backups_select_own on public.customer_backups
  for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.set_backup_customers(customers text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); wanted text[] := coalesce(customers, '{}'::text[]);
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.subscriptions s where s.owner_id=uid and s.status='active' and s.period_end>now()) then
    raise exception 'Subscription inactive';
  end if;
  if coalesce(array_length(wanted,1),0)>500 or exists(
    select 1 from unnest(wanted) as item(key)
    where key is null or key='' or key<>btrim(key) or char_length(key)>200
  ) then raise exception 'Invalid customer keys'; end if;
  insert into public.workspace_backup_settings(owner_id,customers,updated_at)
  values(uid,wanted,now())
  on conflict(owner_id) do update set customers=excluded.customers,updated_at=now();
end $$;
revoke all on function public.set_backup_customers(text[]) from public, anon;
grant execute on function public.set_backup_customers(text[]) to authenticated;

create or replace function public.save_customer_backups(items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); item jsonb; k text; h text;
  saved integer := 0; unchanged integer := 0; rejected integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.subscriptions s where s.owner_id=uid and s.status='active' and s.period_end>now()) then
    raise exception 'Subscription inactive';
  end if;
  if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>500 then raise exception 'Invalid backup items'; end if;
  for item in select value from jsonb_array_elements(items) loop
    k := item->>'customer_key'; h := item->>'content_hash';
    if k is null or k='' or k<>btrim(k) or char_length(k)>200 then raise exception 'Invalid customer key'; end if;
    if not exists(select 1 from public.workspace_backup_settings s where s.owner_id=uid and k=any(s.customers) for share) then
      rejected := rejected+1;
      continue;
    end if;
    if h is null or h !~ '^[0-9a-f]{64}$'
       or nullif(btrim(item->>'customer_name'),'') is null or char_length(item->>'customer_name')>200
       or jsonb_typeof(item->'payload') is distinct from 'object'
       or octet_length((item->'payload')::text)>2000000 then
      raise exception 'Invalid customer backup';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(uid::text||':customer-backup:'||k,0));
    if (select b.content_hash from public.customer_backups b where b.owner_id=uid and b.customer_key=k order by b.created_at desc,b.id desc limit 1)=h then
      unchanged := unchanged+1;
    else
      insert into public.customer_backups(owner_id,customer_key,customer_name,payload,content_hash)
      values(uid,k,item->>'customer_name',item->'payload',h);
      saved := saved+1;
    end if;
    delete from public.customer_backups b where b.owner_id=uid and b.customer_key=k and b.id not in
      (select id from public.customer_backups where owner_id=uid and customer_key=k order by created_at desc,id desc limit 3);
  end loop;
  return jsonb_build_object('backed_up',saved,'unchanged',unchanged,'rejected',rejected);
end $$;
revoke all on function public.save_customer_backups(jsonb) from public, anon;
grant execute on function public.save_customer_backups(jsonb) to authenticated;

-- Lock selection before deleting so a concurrent backup cannot reinsert a copy.
create or replace function public.delete_customer_backups(keys text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); remaining text[];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.subscriptions s where s.owner_id=uid and s.status='active' and s.period_end>now()) then
    raise exception 'Subscription inactive';
  end if;
  select array(select c from unnest(customers) c where c<>all(coalesce(keys,'{}'::text[]))) into remaining
    from public.workspace_backup_settings where owner_id=uid for update;
  delete from public.customer_backups where owner_id=uid and customer_key=any(coalesce(keys,'{}'::text[]));
  update public.workspace_backup_settings set customers=coalesce(remaining,'{}'::text[]),
    frequency=case when coalesce(array_length(remaining,1),0)=0 then 'off' else frequency end,
    time_of_day=case when coalesce(array_length(remaining,1),0)=0 then null else time_of_day end,
    anchor_day=case when coalesce(array_length(remaining,1),0)=0 then null else anchor_day end, updated_at=now()
    where owner_id=uid;
end $$;
revoke all on function public.delete_customer_backups(text[]) from public, anon;
grant execute on function public.delete_customer_backups(text[]) to authenticated;
