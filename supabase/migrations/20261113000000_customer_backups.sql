create table if not exists public.workspace_backup_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  frequency text not null default 'off' check (frequency in ('off','manual','daily','weekly','monthly')),
  time_of_day time,
  tz text not null default 'UTC',
  anchor_day integer check (anchor_day between 0 and 28),
  customers text[] not null default '{}',
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_key text not null,
  customer_name text not null,
  payload jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists customer_backups_owner_key_created
  on public.customer_backups(owner_id, customer_key, created_at desc);

alter table public.workspace_backup_settings enable row level security;
alter table public.customer_backups enable row level security;
create policy workspace_backup_settings_select_own on public.workspace_backup_settings
  for select to authenticated using (owner_id = auth.uid());
create policy customer_backups_select_own on public.customer_backups
  for select to authenticated using (owner_id = auth.uid());
revoke all on public.workspace_backup_settings, public.customer_backups from public, anon, authenticated;
grant select on public.workspace_backup_settings, public.customer_backups to authenticated;

create or replace function public.set_backup_settings(
  frequency text, time_of_day time, tz text, anchor_day integer, customers text[], run_at timestamptz default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.subscriptions s where s.owner_id=uid and s.status='active' and s.period_end>now()) then
    raise exception 'Subscription inactive';
  end if;
  if frequency not in ('off','manual','daily','weekly','monthly') or frequency is null then raise exception 'Invalid backup frequency'; end if;
  if tz is null or not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Invalid backup timezone'; end if;
  if frequency in ('daily','weekly','monthly') and time_of_day is null then raise exception 'Choose a backup time'; end if;
  if frequency in ('daily','weekly','monthly') and coalesce(array_length(customers,1),0)=0 then raise exception 'Choose customers to back up'; end if;
  if frequency='weekly' and (anchor_day is null or anchor_day not between 0 and 6) then raise exception 'Invalid weekday'; end if;
  if frequency='monthly' and (anchor_day is null or anchor_day not between 1 and 28) then raise exception 'Invalid month day'; end if;
  if coalesce(array_length(customers,1),0)>500 or exists(select 1 from unnest(coalesce(customers,'{}'::text[])) c where c='' or c<>btrim(c)) then
    raise exception 'Invalid customer keys';
  end if;
  insert into public.workspace_backup_settings(owner_id,frequency,time_of_day,tz,anchor_day,customers,last_run_at)
  values(uid,frequency,time_of_day,tz,anchor_day,coalesce(customers,'{}'::text[]),run_at)
  on conflict(owner_id) do update set frequency=case when run_at is null then excluded.frequency else public.workspace_backup_settings.frequency end,
    time_of_day=case when run_at is null then excluded.time_of_day else public.workspace_backup_settings.time_of_day end,
    tz=case when run_at is null then excluded.tz else public.workspace_backup_settings.tz end,
    anchor_day=case when run_at is null then excluded.anchor_day else public.workspace_backup_settings.anchor_day end,
    customers=case when run_at is null then excluded.customers else public.workspace_backup_settings.customers end,
    last_run_at=coalesce(run_at,public.workspace_backup_settings.last_run_at),updated_at=now();
end $$;
revoke all on function public.set_backup_settings(text,time,text,integer,text[],timestamptz) from public, anon;
grant execute on function public.set_backup_settings(text,time,text,integer,text[],timestamptz) to authenticated;

create or replace function public.save_customer_backups(items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); item jsonb; k text; h text; saved integer := 0; unchanged integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.subscriptions s where s.owner_id=uid and s.status='active' and s.period_end>now()) then
    raise exception 'Subscription inactive';
  end if;
  if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>500 then raise exception 'Invalid backup items'; end if;
  for item in select value from jsonb_array_elements(items) loop
    k := item->>'customer_key'; h := item->>'content_hash';
    if k is null or k='' or k<>btrim(k) or h is null or h !~ '^[0-9a-f]{64}$'
       or nullif(item->>'customer_name','') is null or jsonb_typeof(item->'payload')<>'object' then
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
  return jsonb_build_object('backed_up',saved,'unchanged',unchanged);
end $$;
revoke all on function public.save_customer_backups(jsonb) from public, anon;
grant execute on function public.save_customer_backups(jsonb) to authenticated;

create or replace function public.delete_customer_backups(keys text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); remaining text[];
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.subscriptions s where s.owner_id=uid and s.status='active' and s.period_end>now()) then
    raise exception 'Subscription inactive';
  end if;
  delete from public.customer_backups where owner_id=uid and customer_key=any(coalesce(keys,'{}'::text[]));
  select array(select c from unnest(customers) c where c<>all(coalesce(keys,'{}'::text[]))) into remaining
    from public.workspace_backup_settings where owner_id=uid;
  update public.workspace_backup_settings set customers=coalesce(remaining,'{}'::text[]),
    frequency=case when coalesce(array_length(remaining,1),0)=0 then 'off' else frequency end,
    time_of_day=case when coalesce(array_length(remaining,1),0)=0 then null else time_of_day end,
    anchor_day=case when coalesce(array_length(remaining,1),0)=0 then null else anchor_day end, updated_at=now()
    where owner_id=uid;
end $$;
revoke all on function public.delete_customer_backups(text[]) from public, anon;
grant execute on function public.delete_customer_backups(text[]) to authenticated;
