-- Run once in the Supabase SQL editor. Phone authentication requires an SMS provider.
create table if not exists public.workspaces (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon;
grant select, insert, update on public.workspaces to authenticated;
create policy "Read own workspace" on public.workspaces for select to authenticated using (auth.uid() = owner_id);
create policy "Insert own workspace" on public.workspaces for insert to authenticated with check (auth.uid() = owner_id);
create policy "Update own workspace" on public.workspaces for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create or replace function public.save_workspace(payload jsonb) returns void language sql security invoker set search_path = public as $$
 insert into public.workspaces(owner_id,payload) values(auth.uid(),payload)
 on conflict(owner_id) do update set payload=excluded.payload, updated_at=now();
$$;
revoke all on function public.save_workspace(jsonb) from public;
grant execute on function public.save_workspace(jsonb) to authenticated;

-- Atomic, durable quota. Only the server can consume credits.
create table if not exists public.ai_usage(owner_id uuid references auth.users(id) on delete cascade, usage_day date not null default current_date, calls integer not null default 0, primary key(owner_id,usage_day));
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon,authenticated;
create or replace function public.consume_ai_credit(user_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into public.ai_usage(owner_id,usage_day,calls) values(user_id,current_date,1)
 on conflict(owner_id,usage_day) do update set calls=ai_usage.calls+1 where ai_usage.calls<30
 returning calls into n;
 return n is not null;
end;$$;
revoke all on function public.consume_ai_credit(uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_credit(uuid) to service_role;


-- Pakki Baat account rights + subscription entitlements
create table if not exists public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin','owner')),
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;
drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles for select to authenticated using (auth.uid()=owner_id);
drop policy if exists "Insert own profile" on public.profiles;
create policy "Insert own profile" on public.profiles for insert to authenticated with check (auth.uid()=owner_id and role='user');
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated using (auth.uid()=owner_id) with check (auth.uid()=owner_id and role='user');

create table if not exists public.subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial','basic','smart','business')),
  status text not null default 'active' check (status in ('active','past_due','suspended','expired','cancelled')),
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now()+interval '30 days'),
  bonus_voice_seconds integer not null default 0 check (bonus_voice_seconds>=0),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon,authenticated;
grant select on public.subscriptions to authenticated;
drop policy if exists "Read own subscription" on public.subscriptions;
create policy "Read own subscription" on public.subscriptions for select to authenticated using (auth.uid()=owner_id);

create table if not exists public.ai_monthly_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null default date_trunc('month',current_date)::date,
  voice_seconds integer not null default 0,
  ai_calls integer not null default 0,
  primary key(owner_id,period_month)
);
alter table public.ai_monthly_usage enable row level security;
revoke all on public.ai_monthly_usage from anon,authenticated;
grant select on public.ai_monthly_usage to authenticated;
drop policy if exists "Read own monthly AI usage" on public.ai_monthly_usage;
create policy "Read own monthly AI usage" on public.ai_monthly_usage for select to authenticated using (auth.uid()=owner_id);

create or replace function public.ensure_user_access(user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(owner_id) values(user_id) on conflict(owner_id) do nothing;
  insert into public.subscriptions(owner_id) values(user_id) on conflict(owner_id) do nothing;
end;$$;
revoke all on function public.ensure_user_access(uuid) from public,anon,authenticated;
grant execute on function public.ensure_user_access(uuid) to service_role;

create or replace function public.consume_ai_usage(user_id uuid, voice_seconds_to_add integer default 0, ai_calls_to_add integer default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sub public.subscriptions%rowtype;
  used public.ai_monthly_usage%rowtype;
  voice_limit integer;
begin
  perform public.ensure_user_access(user_id);
  select * into sub from public.subscriptions where owner_id=user_id for update;
  if sub.status <> 'active' or sub.period_end <= now() then
    return jsonb_build_object('allowed',false,'reason','subscription_inactive');
  end if;
  voice_limit := case sub.plan when 'trial' then 6000 when 'basic' then 6000 when 'smart' then 30000 when 'business' then 60000 else 0 end;
  voice_limit := voice_limit + sub.bonus_voice_seconds;
  insert into public.ai_monthly_usage(owner_id,period_month,voice_seconds,ai_calls)
    values(user_id,date_trunc('month',current_date)::date,0,0)
    on conflict(owner_id,period_month) do nothing;
  select * into used from public.ai_monthly_usage where owner_id=user_id and period_month=date_trunc('month',current_date)::date for update;
  if voice_seconds_to_add > 0 and used.voice_seconds + voice_seconds_to_add > voice_limit then
    return jsonb_build_object('allowed',false,'reason','voice_limit','voice_seconds',used.voice_seconds,'voice_limit',voice_limit);
  end if;
  update public.ai_monthly_usage
    set voice_seconds=voice_seconds+greatest(0,voice_seconds_to_add),
        ai_calls=ai_calls+greatest(0,ai_calls_to_add)
    where owner_id=user_id and period_month=date_trunc('month',current_date)::date
    returning * into used;
  return jsonb_build_object('allowed',true,'plan',sub.plan,'voice_seconds',used.voice_seconds,'voice_limit',voice_limit,'ai_calls',used.ai_calls);
end;$$;
revoke all on function public.consume_ai_usage(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_ai_usage(uuid,integer,integer) to service_role;


-- Owner bootstrap for the Pakki Baat admin console.
-- The server still verifies the signed-in email before serving admin data.
update public.profiles p
set role='owner'
from auth.users u
where p.owner_id=u.id
  and lower(u.email)=lower('zorivoworks@gmail.com');

insert into public.profiles(owner_id,role)
select id,'owner' from auth.users
where lower(email)=lower('zorivoworks@gmail.com')
on conflict(owner_id) do update set role='owner';


-- Subscription payment requests submitted from the QR payment screen.
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
alter table public.payment_requests enable row level security;
drop policy if exists "Users can read own payment requests" on public.payment_requests;
create policy "Users can read own payment requests" on public.payment_requests for select using (auth.uid() = owner_id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];


-- Workspace-based subscriptions and team membership.
-- One subscription belongs to one business workspace, not to each login.
create table if not exists public.business_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My small business',
  created_at timestamptz not null default now()
);
create unique index if not exists business_workspaces_one_primary_per_owner on public.business_workspaces(owner_id);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.business_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'staff' check (member_role in ('owner','staff')),
  joined_at timestamptz not null default now(),
  primary key(workspace_id,user_id)
);
create unique index if not exists workspace_members_one_business_per_user on public.workspace_members(user_id);

alter table public.business_workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on public.business_workspaces from anon;
revoke all on public.workspace_members from anon;
grant select on public.business_workspaces to authenticated;
grant select on public.workspace_members to authenticated;
drop policy if exists "Members read business workspace" on public.business_workspaces;
create policy "Members read business workspace" on public.business_workspaces for select to authenticated
using (owner_id=auth.uid() or exists(select 1 from public.workspace_members m where m.workspace_id=id and m.user_id=auth.uid()));
drop policy if exists "Members read workspace membership" on public.workspace_members;
create policy "Members read workspace membership" on public.workspace_members for select to authenticated
using (user_id=auth.uid() or exists(select 1 from public.business_workspaces w where w.id=workspace_id and w.owner_id=auth.uid()));

alter table public.subscriptions add column if not exists workspace_id uuid references public.business_workspaces(id) on delete cascade;
create unique index if not exists subscriptions_workspace_unique on public.subscriptions(workspace_id) where workspace_id is not null;
alter table public.ai_monthly_usage add column if not exists workspace_id uuid references public.business_workspaces(id) on delete cascade;

create or replace function public.ensure_user_workspace(user_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare wid uuid;
begin
  select workspace_id into wid from public.workspace_members where workspace_members.user_id=user_id limit 1;
  if wid is not null then return wid; end if;
  select id into wid from public.business_workspaces where owner_id=user_id limit 1;
  if wid is null then
    insert into public.business_workspaces(owner_id) values(user_id) returning id into wid;
  end if;
  insert into public.workspace_members(workspace_id,user_id,member_role) values(wid,user_id,'owner')
    on conflict(workspace_id,user_id) do nothing;
  update public.subscriptions set workspace_id=wid where owner_id=user_id and workspace_id is null;
  return wid;
end;$$;
revoke all on function public.ensure_user_workspace(uuid) from public,anon,authenticated;
grant execute on function public.ensure_user_workspace(uuid) to service_role;

-- Business-plan members share one workspace subscription and one voice allowance.
-- Trial/Basic/Smart are single-member workspaces; Business allows 3 members total.
create or replace function public.add_workspace_member(actor_id uuid, member_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare wid uuid; p text; n integer; workspace_owner uuid;
begin
  wid:=public.ensure_user_workspace(actor_id);
  select owner_id into workspace_owner from public.business_workspaces where id=wid;
  if workspace_owner<>actor_id then return jsonb_build_object('allowed',false,'reason','owner_only'); end if;
  select plan into p from public.subscriptions where workspace_id=wid and status='active' and period_end>now();
  if p<>'business' then return jsonb_build_object('allowed',false,'reason','business_plan_required'); end if;
  if exists(select 1 from public.workspace_members where user_id=member_id and workspace_id<>wid) then
    return jsonb_build_object('allowed',false,'reason','member_already_has_business');
  end if;
  select count(*) into n from public.workspace_members where workspace_id=wid;
  if n>=3 then return jsonb_build_object('allowed',false,'reason','member_limit');
  end if;
  insert into public.workspace_members(workspace_id,user_id,member_role) values(wid,member_id,'staff')
    on conflict(workspace_id,user_id) do nothing;
  return jsonb_build_object('allowed',true,'workspace_id',wid);
end;$$;
revoke all on function public.add_workspace_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.add_workspace_member(uuid,uuid) to service_role;


-- Trial protection: 30 days, 50 customers and 100 voice minutes.
-- The server records a privacy-preserving hash supplied by the app; raw device signals are never stored here.
create table if not exists public.trial_claims (
  device_hash text primary key,
  first_owner_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from public,anon,authenticated;

create or replace function public.claim_trial(user_id uuid, supplied_device_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare existing_owner uuid; sub public.subscriptions%rowtype;
begin
  if supplied_device_hash is null or length(trim(supplied_device_hash)) < 16 then
    return jsonb_build_object('allowed',false,'reason','invalid_device');
  end if;
  perform public.ensure_user_access(user_id);
  select * into sub from public.subscriptions where owner_id=user_id for update;
  if sub.plan <> 'trial' then return jsonb_build_object('allowed',true,'reason','paid_account'); end if;
  select first_owner_id into existing_owner from public.trial_claims where device_hash=supplied_device_hash;
  if existing_owner is not null and existing_owner<>user_id then
    update public.subscriptions set status='expired',period_end=least(period_end,now()),updated_at=now() where owner_id=user_id and plan='trial';
    return jsonb_build_object('allowed',false,'reason','trial_already_used_on_device');
  end if;
  insert into public.trial_claims(device_hash,first_owner_id) values(supplied_device_hash,user_id)
    on conflict(device_hash) do nothing;
  return jsonb_build_object('allowed',true,'reason','trial_claimed');
end;$$;
revoke all on function public.claim_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_trial(uuid,text) to service_role;
