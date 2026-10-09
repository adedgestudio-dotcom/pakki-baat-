-- STAGING ONLY baseline. Apply explicitly to pakki-baat-staging after review.
-- It intentionally does not touch the already-applied Phase 1A ledger, auth users,
-- production-owner bootstrap logic, or application/customer data.
-- Do not use supabase db push with the pre-baseline date-only migration files.

begin;

-- Core workspace and entitlement tables.
create table if not exists public.workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin','owner')),
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial','basic','smart','business')),
  status text not null default 'active' check (status in ('active','past_due','suspended','expired','cancelled')),
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now() + interval '30 days'),
  bonus_voice_seconds integer not null default 0 check (bonus_voice_seconds >= 0),
  pending_plan text check (pending_plan is null or pending_plan in ('basic','smart','business')),
  pending_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  owner_id uuid references auth.users(id) on delete cascade,
  usage_day date not null default current_date,
  calls integer not null default 0 check (calls >= 0),
  primary key(owner_id, usage_day)
);

create table if not exists public.ai_monthly_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null default date_trunc('month', current_date)::date,
  voice_seconds integer not null default 0 check (voice_seconds >= 0),
  ai_calls integer not null default 0 check (ai_calls >= 0),
  primary key(owner_id, period_month)
);

create table if not exists public.business_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My small business',
  created_at timestamptz not null default now()
);
create unique index if not exists business_workspaces_one_primary_per_owner
  on public.business_workspaces(owner_id);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.business_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'staff' check (member_role in ('owner','staff')),
  joined_at timestamptz not null default now(),
  primary key(workspace_id, user_id)
);
create unique index if not exists workspace_members_one_business_per_user
  on public.workspace_members(user_id);

alter table public.subscriptions
  add column if not exists workspace_id uuid references public.business_workspaces(id) on delete cascade,
  add column if not exists pending_plan text,
  add column if not exists pending_period_end timestamptz;
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('active','past_due','suspended','expired','cancelled'));
alter table public.subscriptions drop constraint if exists subscriptions_pending_plan_check;
alter table public.subscriptions add constraint subscriptions_pending_plan_check
  check (pending_plan is null or pending_plan in ('basic','smart','business'));
create unique index if not exists subscriptions_workspace_unique
  on public.subscriptions(workspace_id) where workspace_id is not null;
alter table public.ai_monthly_usage
  add column if not exists workspace_id uuid references public.business_workspaces(id) on delete cascade;

create table if not exists public.ai_period_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  voice_seconds integer not null default 0 check (voice_seconds >= 0),
  ai_calls integer not null default 0 check (ai_calls >= 0),
  primary key(owner_id, period_start)
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text,
  plan text not null check (plan in ('basic','smart','business')),
  amount integer not null check (amount > 0),
  transaction_ref text,
  proof_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists payment_requests_owner_submitted_idx
  on public.payment_requests(owner_id, submitted_at desc);

-- Trial-abuse protection stores only supplied hashes, never raw device data.
create table if not exists public.trial_claims (
  device_hash text primary key,
  first_owner_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz not null default now()
);
create table if not exists public.trial_owner_claims (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create table if not exists public.trial_email_claims (
  email_hash text primary key,
  claimed_at timestamptz not null default now()
);
create table if not exists public.trial_device_signature_claims (
  signature_hash text primary key,
  first_owner_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz not null default now()
);
create table if not exists public.trial_expiry_email_log (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_end timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key(owner_id, period_end)
);

-- Versioned workspace snapshots. The ledger remains separate and untouched.
create table if not exists public.workspace_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  backup_kind text not null default 'daily' check (backup_kind in ('daily','pre_restore')),
  backup_day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create unique index if not exists workspace_backups_daily_owner_day
  on public.workspace_backups(owner_id, backup_day) where backup_kind = 'daily';
create index if not exists workspace_backups_owner_created
  on public.workspace_backups(owner_id, created_at desc);

-- The app uses server-side/service-role payment uploads. Do not expose object writes
-- directly to browser roles; only provision the private bucket here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- RLS and direct-table permissions. Server functions below are the mutation path
-- for protected data; authenticated clients receive only their own reads.
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_monthly_usage enable row level security;
alter table public.ai_period_usage enable row level security;
alter table public.business_workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.payment_requests enable row level security;
alter table public.trial_claims enable row level security;
alter table public.trial_owner_claims enable row level security;
alter table public.trial_email_claims enable row level security;
alter table public.trial_device_signature_claims enable row level security;
alter table public.trial_expiry_email_log enable row level security;
alter table public.workspace_backups enable row level security;

revoke all on public.workspaces, public.profiles, public.subscriptions, public.ai_usage,
  public.ai_monthly_usage, public.ai_period_usage, public.business_workspaces,
  public.workspace_members, public.payment_requests, public.trial_claims,
  public.trial_owner_claims, public.trial_email_claims,
  public.trial_device_signature_claims, public.trial_expiry_email_log,
  public.workspace_backups from anon;
revoke all on public.subscriptions, public.ai_usage, public.ai_monthly_usage,
  public.ai_period_usage, public.trial_claims, public.trial_owner_claims,
  public.trial_email_claims, public.trial_device_signature_claims,
  public.trial_expiry_email_log from authenticated;
grant select, insert, update on public.workspaces, public.profiles to authenticated;
grant select on public.subscriptions, public.ai_monthly_usage, public.ai_period_usage,
  public.business_workspaces, public.workspace_members, public.payment_requests,
  public.workspace_backups to authenticated;

drop policy if exists "Read own workspace" on public.workspaces;
drop policy if exists "Insert own workspace" on public.workspaces;
drop policy if exists "Update own workspace" on public.workspaces;
create policy "Read own workspace" on public.workspaces for select to authenticated using (owner_id = auth.uid());
create policy "Insert own workspace" on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy "Update own workspace" on public.workspaces for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Read own profile" on public.profiles;
drop policy if exists "Insert own profile" on public.profiles;
drop policy if exists "Update own profile" on public.profiles;
create policy "Read own profile" on public.profiles for select to authenticated using (owner_id = auth.uid());
create policy "Insert own profile" on public.profiles for insert to authenticated with check (owner_id = auth.uid() and role = 'user');
create policy "Update own profile" on public.profiles for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and role = 'user');

drop policy if exists "Read own subscription" on public.subscriptions;
create policy "Read own subscription" on public.subscriptions for select to authenticated using (owner_id = auth.uid());
drop policy if exists "Read own monthly AI usage" on public.ai_monthly_usage;
create policy "Read own monthly AI usage" on public.ai_monthly_usage for select to authenticated using (owner_id = auth.uid());
drop policy if exists "Read own AI period usage" on public.ai_period_usage;
create policy "Read own AI period usage" on public.ai_period_usage for select to authenticated using (owner_id = auth.uid());
drop policy if exists "Users can read own payment requests" on public.payment_requests;
create policy "Users can read own payment requests" on public.payment_requests for select to authenticated using (owner_id = auth.uid());
drop policy if exists "Members read business workspace" on public.business_workspaces;
create policy "Members read business workspace" on public.business_workspaces for select to authenticated
  using (owner_id = auth.uid() or exists (select 1 from public.workspace_members m where m.workspace_id = id and m.user_id = auth.uid()));
drop policy if exists "Members read workspace membership" on public.workspace_members;
create policy "Members read workspace membership" on public.workspace_members for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.business_workspaces w where w.id = workspace_id and w.owner_id = auth.uid()));
drop policy if exists "workspace_backups_select_own" on public.workspace_backups;
create policy "workspace_backups_select_own" on public.workspace_backups for select to authenticated using (owner_id = auth.uid());

-- Security-definer functions are service-role-only unless an authenticated user
-- needs a narrowly scoped self-service RPC.
create or replace function public.consume_ai_credit(user_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  insert into public.ai_usage(owner_id, usage_day, calls) values(user_id, current_date, 1)
  on conflict(owner_id, usage_day) do update set calls = public.ai_usage.calls + 1
    where public.ai_usage.calls < 30 returning calls into n;
  return n is not null;
end; $$;

create or replace function public.ensure_user_access(user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(owner_id) values(user_id) on conflict(owner_id) do nothing;
  insert into public.subscriptions(owner_id) values(user_id) on conflict(owner_id) do nothing;
end; $$;

create or replace function public.ensure_user_workspace(user_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare wid uuid;
begin
  select workspace_id into wid from public.workspace_members where workspace_members.user_id = user_id limit 1;
  if wid is not null then return wid; end if;
  select id into wid from public.business_workspaces where owner_id = user_id limit 1;
  if wid is null then insert into public.business_workspaces(owner_id) values(user_id) returning id into wid; end if;
  insert into public.workspace_members(workspace_id,user_id,member_role) values(wid,user_id,'owner') on conflict(workspace_id,user_id) do nothing;
  update public.subscriptions set workspace_id = wid where owner_id = user_id and workspace_id is null;
  return wid;
end; $$;

create or replace function public.add_workspace_member(actor_id uuid, member_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare wid uuid; p text; n integer; workspace_owner uuid;
begin
  wid := public.ensure_user_workspace(actor_id);
  select owner_id into workspace_owner from public.business_workspaces where id = wid;
  if workspace_owner <> actor_id then return jsonb_build_object('allowed',false,'reason','owner_only'); end if;
  select plan into p from public.subscriptions where workspace_id = wid and status = 'active' and period_end > now();
  if p <> 'business' then return jsonb_build_object('allowed',false,'reason','business_plan_required'); end if;
  if exists(select 1 from public.workspace_members where user_id = member_id and workspace_id <> wid) then return jsonb_build_object('allowed',false,'reason','member_already_has_business'); end if;
  select count(*) into n from public.workspace_members where workspace_id = wid;
  if n >= 3 then return jsonb_build_object('allowed',false,'reason','member_limit'); end if;
  insert into public.workspace_members(workspace_id,user_id,member_role) values(wid,member_id,'staff') on conflict(workspace_id,user_id) do nothing;
  return jsonb_build_object('allowed',true,'workspace_id',wid);
end; $$;

create or replace function public.apply_due_pending_plan(target_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype;
begin
  select * into sub from public.subscriptions where owner_id = target_user_id for update;
  if not found then return jsonb_build_object('ok',false,'action','no_subscription'); end if;
  if sub.pending_plan is not null and sub.pending_period_end is not null and sub.period_end <= now() and sub.pending_period_end > sub.period_end then
    update public.subscriptions set plan=sub.pending_plan,status='active',period_start=sub.period_end,period_end=sub.pending_period_end,pending_plan=null,pending_period_end=null,updated_at=now() where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','pending_plan_activated','plan',sub.pending_plan,'period_start',sub.period_end,'period_end',sub.pending_period_end);
  end if;
  return jsonb_build_object('ok',true,'action','unchanged','plan',sub.plan,'period_start',sub.period_start,'period_end',sub.period_end,'pending_plan',sub.pending_plan,'pending_period_end',sub.pending_period_end);
end; $$;

create or replace function public.consume_ai_usage(user_id uuid, voice_seconds_to_add integer default 0, ai_calls_to_add integer default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype; used public.ai_period_usage%rowtype; voice_limit integer; cycle_start timestamptz; elapsed_cycles integer;
begin
  if voice_seconds_to_add < 0 or ai_calls_to_add < 0 then raise exception 'USAGE_INCREMENT_MUST_NOT_BE_NEGATIVE'; end if;
  insert into public.profiles(owner_id) values(user_id) on conflict(owner_id) do nothing;
  perform public.apply_due_pending_plan(user_id);
  select * into sub from public.subscriptions where owner_id=user_id for update;
  if not found or sub.status <> 'active' or sub.period_end <= now() then return jsonb_build_object('allowed',false,'reason','subscription_inactive'); end if;
  voice_limit := case sub.plan when 'trial' then 6000 when 'basic' then 6000 when 'smart' then 30000 when 'business' then 60000 else 0 end + sub.bonus_voice_seconds;
  elapsed_cycles := greatest(0, floor(extract(epoch from (now()-sub.period_start))/2592000)::integer);
  cycle_start := sub.period_start + (elapsed_cycles * interval '30 days');
  insert into public.ai_period_usage(owner_id,period_start,voice_seconds,ai_calls) values(user_id,cycle_start,0,0) on conflict(owner_id,period_start) do nothing;
  select * into used from public.ai_period_usage where owner_id=user_id and period_start=cycle_start for update;
  if used.voice_seconds + voice_seconds_to_add > voice_limit then return jsonb_build_object('allowed',false,'reason','voice_limit','voice_seconds',used.voice_seconds,'voice_limit',voice_limit); end if;
  update public.ai_period_usage set voice_seconds=voice_seconds+voice_seconds_to_add,ai_calls=ai_calls+ai_calls_to_add where owner_id=user_id and period_start=cycle_start returning * into used;
  return jsonb_build_object('allowed',true,'plan',sub.plan,'voice_seconds',used.voice_seconds,'voice_limit',voice_limit,'ai_calls',used.ai_calls,'usage_period_start',cycle_start,'period_start',sub.period_start,'period_end',sub.period_end);
end; $$;

create or replace function public.activate_paid_plan(target_user_id uuid, target_plan text, activation_mode text default 'purchase')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype; start_at timestamptz; end_at timestamptz; current_rank integer; target_rank integer; is_active boolean; pending_end timestamptz;
begin
  if target_plan not in ('basic','smart','business') then raise exception 'INVALID_PLAN'; end if;
  select * into sub from public.subscriptions where owner_id=target_user_id for update;
  is_active := found and sub.status='active' and sub.period_end>now();
  current_rank := case when found then case sub.plan when 'basic' then 1 when 'smart' then 2 when 'business' then 3 else 0 end else 0 end;
  target_rank := case target_plan when 'basic' then 1 when 'smart' then 2 when 'business' then 3 end;
  if activation_mode='renewal' and is_active and sub.plan=target_plan then
    update public.subscriptions set period_end=sub.period_end+interval '30 days',pending_plan=null,pending_period_end=null,updated_at=now() where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','renewed','plan',target_plan,'period_start',sub.period_start,'period_end',sub.period_end+interval '30 days');
  end if;
  if is_active and current_rank>target_rank then
    pending_end := case when sub.pending_plan=target_plan and sub.pending_period_end is not null then sub.pending_period_end+interval '30 days' else sub.period_end+interval '30 days' end;
    update public.subscriptions set pending_plan=target_plan,pending_period_end=pending_end,updated_at=now() where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','downgrade_prepaid','plan',sub.plan,'pending_plan',target_plan,'period_start',sub.period_start,'period_end',sub.period_end,'pending_period_end',pending_end);
  end if;
  if is_active and current_rank>0 and target_rank>current_rank then
    update public.subscriptions set plan=target_plan,pending_plan=null,pending_period_end=null,status='active',updated_at=now() where owner_id=target_user_id;
    return jsonb_build_object('ok',true,'action','upgraded','plan',target_plan,'period_start',sub.period_start,'period_end',sub.period_end);
  end if;
  start_at:=now(); end_at:=start_at+interval '30 days';
  insert into public.subscriptions(owner_id,plan,status,period_start,period_end,bonus_voice_seconds,pending_plan,pending_period_end,updated_at)
  values(target_user_id,target_plan,'active',start_at,end_at,case when found then sub.bonus_voice_seconds else 0 end,null,null,now())
  on conflict(owner_id) do update set plan=excluded.plan,status='active',period_start=excluded.period_start,period_end=excluded.period_end,pending_plan=null,pending_period_end=null,updated_at=now();
  return jsonb_build_object('ok',true,'action','activated','plan',target_plan,'period_start',start_at,'period_end',end_at);
end; $$;

create or replace function public.extend_subscription(target_user_id uuid, extension_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype; base_at timestamptz; end_at timestamptz; safe_days integer;
begin
  safe_days:=greatest(1,least(coalesce(extension_days,30),3650)); select * into sub from public.subscriptions where owner_id=target_user_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  base_at:=greatest(now(),coalesce(sub.period_end,now())); end_at:=base_at+make_interval(days=>safe_days);
  update public.subscriptions set period_end=end_at,status='active',updated_at=now() where owner_id=target_user_id;
  return jsonb_build_object('ok',true,'period_end',end_at);
end; $$;

create or replace function public.set_subscription_status(target_user_id uuid, target_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sub public.subscriptions%rowtype;
begin
  if target_status not in ('active','suspended') then raise exception 'INVALID_STATUS'; end if;
  select * into sub from public.subscriptions where owner_id=target_user_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  if target_status='active' and sub.period_end<=now() then raise exception 'SUBSCRIPTION_EXPIRED'; end if;
  update public.subscriptions set status=target_status,updated_at=now() where owner_id=target_user_id;
  return jsonb_build_object('ok',true,'status',target_status,'period_end',sub.period_end);
end; $$;

create or replace function public.admin_grant_trial(target_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare start_at timestamptz:=now(); end_at timestamptz:=now()+interval '30 days';
begin
  if not exists(select 1 from auth.users where id=target_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  insert into public.subscriptions(owner_id,plan,status,period_start,period_end,bonus_voice_seconds,updated_at)
  values(target_user_id,'trial','active',start_at,end_at,0,now()) on conflict(owner_id) do update
  set plan='trial',status='active',period_start=start_at,period_end=end_at,bonus_voice_seconds=0,pending_plan=null,pending_period_end=null,updated_at=now();
  return jsonb_build_object('ok',true,'plan','trial','period_start',start_at,'period_end',end_at);
end; $$;

create or replace function public.claim_trial(user_id uuid, supplied_device_hash text, supplied_email_hash text, supplied_signature_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing_owner uuid; existing_signature_owner uuid; sub public.subscriptions%rowtype; owner_already_claimed boolean; email_already_claimed boolean; trial_start timestamptz; trial_end timestamptz;
begin
  if supplied_device_hash is null or length(trim(supplied_device_hash)) < 16 then return jsonb_build_object('allowed',false,'reason','invalid_device'); end if;
  if supplied_email_hash is null or length(trim(supplied_email_hash)) <> 64 then return jsonb_build_object('allowed',false,'reason','invalid_email'); end if;
  if supplied_signature_hash is null or length(trim(supplied_signature_hash)) <> 64 then return jsonb_build_object('allowed',false,'reason','invalid_device_signature'); end if;
  perform pg_advisory_xact_lock(hashtext(user_id::text)); perform pg_advisory_xact_lock(hashtext(supplied_email_hash)); perform pg_advisory_xact_lock(hashtext(supplied_signature_hash));
  select exists(select 1 from public.trial_owner_claims where owner_id=user_id) into owner_already_claimed;
  select exists(select 1 from public.trial_email_claims where email_hash=supplied_email_hash) into email_already_claimed;
  select first_owner_id into existing_owner from public.trial_claims where device_hash=supplied_device_hash;
  select first_owner_id into existing_signature_owner from public.trial_device_signature_claims where signature_hash=supplied_signature_hash;
  if existing_owner is not null and existing_owner<>user_id then insert into public.trial_device_signature_claims(signature_hash,first_owner_id) values(supplied_signature_hash,existing_owner) on conflict(signature_hash) do nothing; return jsonb_build_object('allowed',false,'reason','trial_already_used_on_device'); end if;
  if existing_signature_owner is not null and existing_signature_owner<>user_id then return jsonb_build_object('allowed',false,'reason','trial_already_used_on_device'); end if;
  if owner_already_claimed then return jsonb_build_object('allowed',false,'reason','trial_already_used_on_account'); end if;
  if email_already_claimed then return jsonb_build_object('allowed',false,'reason','trial_already_used_on_email'); end if;
  select * into sub from public.subscriptions where owner_id=user_id for update;
  if found and sub.plan <> 'trial' then return jsonb_build_object('allowed',false,'reason','paid_account'); end if;
  trial_start:=now(); trial_end:=trial_start+interval '30 days';
  insert into public.trial_owner_claims(owner_id,claimed_at) values(user_id,trial_start) on conflict(owner_id) do nothing;
  insert into public.trial_email_claims(email_hash,claimed_at) values(supplied_email_hash,trial_start) on conflict(email_hash) do nothing;
  insert into public.trial_claims(device_hash,first_owner_id,claimed_at) values(supplied_device_hash,user_id,trial_start) on conflict(device_hash) do nothing;
  insert into public.trial_device_signature_claims(signature_hash,first_owner_id,claimed_at) values(supplied_signature_hash,user_id,trial_start) on conflict(signature_hash) do nothing;
  insert into public.subscriptions(owner_id,plan,status,period_start,period_end,bonus_voice_seconds,updated_at) values(user_id,'trial','active',trial_start,trial_end,0,trial_start)
  on conflict(owner_id) do update set plan='trial',status='active',period_start=excluded.period_start,period_end=excluded.period_end,bonus_voice_seconds=0,pending_plan=null,pending_period_end=null,updated_at=excluded.updated_at;
  return jsonb_build_object('allowed',true,'reason','trial_claimed','period_start',trial_start,'period_end',trial_end);
end; $$;

-- Keep the production customer-cap semantics while preserving workspace JSON.
create or replace function public.save_workspace(payload jsonb) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_plan text; v_status text; v_period_end timestamptz; v_limit integer; v_existing_payload jsonb; v_existing_count integer:=0; v_new_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'INVALID_WORKSPACE_PAYLOAD'; end if;
  select plan,status,period_end into v_plan,v_status,v_period_end from public.subscriptions where owner_id=auth.uid();
  if not found or v_status <> 'active' or v_period_end <= now() then raise exception 'SUBSCRIPTION_INACTIVE'; end if;
  v_limit:=case v_plan when 'trial' then 100 when 'basic' then 100 when 'smart' then 250 when 'business' then null else 0 end;
  select count(distinct customer) into v_new_count from (
    select lower(trim(x->>'customer')) customer from jsonb_array_elements(case when jsonb_typeof(payload->'jobs')='array' then payload->'jobs' else '[]'::jsonb end) x
    union select lower(trim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(payload->'payments')='array' then payload->'payments' else '[]'::jsonb end) x
    union select lower(trim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(payload->'notes')='array' then payload->'notes' else '[]'::jsonb end) x
    union select lower(trim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(payload->'reminders')='array' then payload->'reminders' else '[]'::jsonb end) x
    union select lower(trim(key)) from jsonb_object_keys(case when jsonb_typeof(payload->'customerPhones')='object' then payload->'customerPhones' else '{}'::jsonb end) key
  ) customers where customer is not null and customer <> '';
  if v_limit is not null then
    select w.payload into v_existing_payload from public.workspaces w where w.owner_id=auth.uid();
    if v_existing_payload is not null then
      select count(distinct customer) into v_existing_count from (
        select lower(trim(x->>'customer')) customer from jsonb_array_elements(case when jsonb_typeof(v_existing_payload->'jobs')='array' then v_existing_payload->'jobs' else '[]'::jsonb end) x
        union select lower(trim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(v_existing_payload->'payments')='array' then v_existing_payload->'payments' else '[]'::jsonb end) x
        union select lower(trim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(v_existing_payload->'notes')='array' then v_existing_payload->'notes' else '[]'::jsonb end) x
        union select lower(trim(x->>'customer')) from jsonb_array_elements(case when jsonb_typeof(v_existing_payload->'reminders')='array' then v_existing_payload->'reminders' else '[]'::jsonb end) x
        union select lower(trim(key)) from jsonb_object_keys(case when jsonb_typeof(v_existing_payload->'customerPhones')='object' then v_existing_payload->'customerPhones' else '{}'::jsonb end) key
      ) customers where customer is not null and customer <> '';
    end if;
    if v_new_count > v_limit and v_new_count > v_existing_count then raise exception 'CUSTOMER_LIMIT_REACHED:%',v_limit; end if;
  end if;
  insert into public.workspaces(owner_id,payload) values(auth.uid(),payload) on conflict(owner_id) do update set payload=excluded.payload,updated_at=now();
end; $$;

create or replace function public.save_workspace_backup(payload jsonb, kind text default 'daily') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid:=auth.uid(); today date:=(now() at time zone 'utc')::date;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'Invalid backup payload'; end if;
  if kind not in ('daily','pre_restore') then raise exception 'Invalid backup kind'; end if;
  if kind='daily' then insert into public.workspace_backups(owner_id,payload,backup_kind,backup_day) values(uid,payload,'daily',today)
    on conflict(owner_id,backup_day) where backup_kind='daily' do update set payload=excluded.payload,created_at=now();
  else insert into public.workspace_backups(owner_id,payload,backup_kind,backup_day) values(uid,payload,'pre_restore',today); end if;
  delete from public.workspace_backups where owner_id=uid and id not in (select id from public.workspace_backups where owner_id=uid order by created_at desc limit 8);
end; $$;

revoke all on function public.consume_ai_credit(uuid), public.ensure_user_access(uuid), public.ensure_user_workspace(uuid),
  public.add_workspace_member(uuid,uuid), public.consume_ai_usage(uuid,integer,integer), public.activate_paid_plan(uuid,text,text),
  public.apply_due_pending_plan(uuid), public.extend_subscription(uuid,integer), public.set_subscription_status(uuid,text),
  public.admin_grant_trial(uuid), public.claim_trial(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.consume_ai_credit(uuid), public.ensure_user_access(uuid), public.ensure_user_workspace(uuid),
  public.add_workspace_member(uuid,uuid), public.consume_ai_usage(uuid,integer,integer), public.activate_paid_plan(uuid,text,text),
  public.apply_due_pending_plan(uuid), public.extend_subscription(uuid,integer), public.set_subscription_status(uuid,text),
  public.admin_grant_trial(uuid), public.claim_trial(uuid,text,text,text) to service_role;
revoke all on function public.save_workspace(jsonb), public.save_workspace_backup(jsonb,text) from public, anon;
grant execute on function public.save_workspace(jsonb), public.save_workspace_backup(jsonb,text) to authenticated;

commit;
