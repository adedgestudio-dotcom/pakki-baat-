-- Workflow 5 coexistence. ADDITIVE ONLY: do not backfill workspace payloads.
-- A reminder without payload.reminders[].scheduler = 'v5' remains legacy-v4.
begin;

create table public.reminder_v5_delivery_controls (
  singleton boolean primary key default true check (singleton),
  delivery_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.reminder_v5_delivery_controls(singleton, delivery_enabled)
values (true, false) on conflict (singleton) do nothing;

create table public.reminder_v5_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  reminder_id text not null check (length(reminder_id) between 1 and 160),
  expected_date date not null,
  expected_time time not null,
  subscription_fingerprint text not null check (subscription_fingerprint ~ '^[0-9a-f]{64}$'),
  generation bigint not null default 1 check (generation > 0),
  status text not null default 'active' check (status in ('active','cancelled')),
  runner_id text,
  workflow_run_id text,
  workflow_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, reminder_id)
);

create table public.reminder_v5_deliveries (
  schedule_id uuid not null references public.reminder_v5_schedules(id) on delete cascade,
  generation bigint not null,
  occurrence_at timestamptz not null,
  state text not null check (state in ('sending','sent')),
  attempts integer not null default 0 check (attempts > 0),
  lease_until timestamptz,
  sent_at timestamptz,
  primary key(schedule_id, generation, occurrence_at)
);
alter table public.reminder_v5_delivery_controls enable row level security;
alter table public.reminder_v5_schedules enable row level security;
alter table public.reminder_v5_deliveries enable row level security;
revoke all on public.reminder_v5_delivery_controls, public.reminder_v5_schedules, public.reminder_v5_deliveries from public, anon, authenticated;

-- Server-only function. It serializes each owner/reminder schedule generation.
create function public.ensure_v5_reminder_schedule(p_owner_id uuid, p_reminder_id text, p_expected_date date, p_expected_time time, p_subscription_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare snapshot jsonb; candidate jsonb; schedule public.reminder_v5_schedules%rowtype; enabled boolean;
begin
  select delivery_enabled into enabled from public.reminder_v5_delivery_controls where singleton=true for update;
  if enabled is distinct from true then return jsonb_build_object('reason','delivery_disabled'); end if;
  select payload into snapshot from public.workspaces where owner_id=p_owner_id for update;
  select value into candidate from jsonb_array_elements(coalesce(snapshot->'reminders','[]'::jsonb))
    where value->>'id'=p_reminder_id limit 1;
  if candidate is null or candidate->>'scheduler'<>'v5' or coalesce((candidate->>'done')::boolean,false)
     or candidate->>'date'<>p_expected_date::text or coalesce(candidate->>'time','09:00')<>to_char(p_expected_time,'HH24:MI') then
    raise exception 'V5_REMINDER_OWNERSHIP_MISMATCH';
  end if;
  select * into schedule from public.reminder_v5_schedules where owner_id=p_owner_id and reminder_id=p_reminder_id for update;
  if not found then
    insert into public.reminder_v5_schedules(owner_id,reminder_id,expected_date,expected_time,subscription_fingerprint)
      values(p_owner_id,p_reminder_id,p_expected_date,p_expected_time,p_subscription_fingerprint) returning * into schedule;
    return jsonb_build_object('schedule_id',schedule.id,'generation',schedule.generation,'should_start',true);
  end if;
  if schedule.expected_date=p_expected_date and schedule.expected_time=p_expected_time and schedule.subscription_fingerprint=p_subscription_fingerprint and schedule.status='active' then
    return jsonb_build_object('schedule_id',schedule.id,'generation',schedule.generation,'should_start',schedule.workflow_started_at is null);
  end if;
  update public.reminder_v5_schedules set expected_date=p_expected_date,expected_time=p_expected_time,subscription_fingerprint=p_subscription_fingerprint,
    generation=schedule.generation+1,status='active',runner_id=null,workflow_run_id=null,workflow_started_at=null,updated_at=now()
    where id=schedule.id returning * into schedule;
  return jsonb_build_object('schedule_id',schedule.id,'generation',schedule.generation,'should_start',true);
end; $$;

create function public.record_v5_reminder_workflow_start(p_schedule_id uuid,p_generation bigint,p_run_id text)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.reminder_v5_schedules set workflow_run_id=p_run_id, workflow_started_at=now(), updated_at=now()
  where id=p_schedule_id and generation=p_generation and status='active' and workflow_started_at is null;
$$;

create function public.claim_v5_reminder_runner(p_schedule_id uuid,p_generation bigint,p_runner_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare enabled boolean; claimed boolean;
begin
  select delivery_enabled into enabled from public.reminder_v5_delivery_controls where singleton=true;
  if enabled is distinct from true then return jsonb_build_object('claimed',false); end if;
  update public.reminder_v5_schedules set runner_id=p_runner_id,updated_at=now()
   where id=p_schedule_id and generation=p_generation and status='active' and (runner_id is null or runner_id=p_runner_id)
   returning true into claimed;
  return jsonb_build_object('claimed',coalesce(claimed,false));
end; $$;

create function public.begin_v5_reminder_delivery(p_schedule_id uuid,p_generation bigint,p_occurrence_at timestamptz,p_runner_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare enabled boolean; claimed boolean:=false; affected integer;
begin
  select delivery_enabled into enabled from public.reminder_v5_delivery_controls where singleton=true;
  if enabled is distinct from true or not exists(select 1 from public.reminder_v5_schedules where id=p_schedule_id and generation=p_generation and status='active' and runner_id=p_runner_id) then return jsonb_build_object('claimed',false); end if;
  insert into public.reminder_v5_deliveries(schedule_id,generation,occurrence_at,state,attempts,lease_until)
    values(p_schedule_id,p_generation,p_occurrence_at,'sending',1,now()+interval '10 minutes') on conflict do nothing;
  get diagnostics affected=row_count;
  claimed:=affected>0;
  if not claimed then
    update public.reminder_v5_deliveries set state='sending',attempts=attempts+1,lease_until=now()+interval '10 minutes',sent_at=null
      where schedule_id=p_schedule_id and generation=p_generation and occurrence_at=p_occurrence_at and state='sending' and lease_until<now();
    get diagnostics affected=row_count;
    claimed:=affected>0;
  end if;
  return jsonb_build_object('claimed',claimed);
end; $$;

create function public.finish_v5_reminder_delivery(p_schedule_id uuid,p_generation bigint,p_occurrence_at timestamptz)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.reminder_v5_deliveries set state='sent',sent_at=now(),lease_until=null
  where schedule_id=p_schedule_id and generation=p_generation and occurrence_at=p_occurrence_at and state='sending';
$$;
create function public.release_v5_reminder_delivery(p_schedule_id uuid,p_generation bigint,p_occurrence_at timestamptz)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.reminder_v5_deliveries set lease_until=now()-interval '1 second'
  where schedule_id=p_schedule_id and generation=p_generation and occurrence_at=p_occurrence_at and state='sending';
$$;

-- Rollback switch: stops new starts and is rechecked immediately before V5 push.
create function public.set_v5_reminder_delivery_enabled(p_enabled boolean)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.reminder_v5_delivery_controls set delivery_enabled=p_enabled,updated_at=now() where singleton=true;
$$;
revoke all on function public.ensure_v5_reminder_schedule(uuid,text,date,time,text), public.record_v5_reminder_workflow_start(uuid,bigint,text), public.claim_v5_reminder_runner(uuid,bigint,text), public.begin_v5_reminder_delivery(uuid,bigint,timestamptz,text), public.finish_v5_reminder_delivery(uuid,bigint,timestamptz), public.release_v5_reminder_delivery(uuid,bigint,timestamptz), public.set_v5_reminder_delivery_enabled(boolean) from public,anon,authenticated;
grant execute on function public.ensure_v5_reminder_schedule(uuid,text,date,time,text), public.record_v5_reminder_workflow_start(uuid,bigint,text), public.claim_v5_reminder_runner(uuid,bigint,text), public.begin_v5_reminder_delivery(uuid,bigint,timestamptz,text), public.finish_v5_reminder_delivery(uuid,bigint,timestamptz), public.release_v5_reminder_delivery(uuid,bigint,timestamptz), public.set_v5_reminder_delivery_enabled(boolean) to service_role;
commit;
