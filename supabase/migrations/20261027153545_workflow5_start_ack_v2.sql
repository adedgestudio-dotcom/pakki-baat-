-- Additive acknowledgement only. Does not start workflows or enable delivery.
begin;

create function public.record_v5_reminder_workflow_start_v2(
  p_owner_id uuid, p_schedule_id uuid, p_reminder_id text,
  p_generation bigint, p_expected_date date, p_expected_time time, p_run_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  snapshot jsonb;
  candidate jsonb;
  schedule public.reminder_v5_schedules%rowtype;
  outcome text := 'not_found';
  updated_id uuid;
begin
  if p_owner_id is null or p_schedule_id is null or p_generation is null or p_generation < 1
     or p_expected_date is null or p_expected_time is null
     or p_reminder_id is null or length(btrim(p_reminder_id)) = 0 or length(p_reminder_id) > 160
     or p_run_id is null or length(btrim(p_run_id)) = 0 or length(p_run_id) > 512 then
    raise exception 'INVALID_V5_ACK_INPUT' using errcode = '22023';
  end if;

  -- Same relative lock order as ensure_v5_reminder_schedule: workspace, schedule.
  -- No delivery-control lock is needed: acknowledgement never authorizes a send.
  <<checks>>
  begin
    select w.payload into snapshot from public.workspaces w
      where w.owner_id = p_owner_id for update;
    if not found then exit checks; end if;
    select s.* into schedule from public.reminder_v5_schedules s
      where s.id = p_schedule_id for update;
    if not found then exit checks; end if;
    if schedule.owner_id is distinct from p_owner_id or schedule.reminder_id is distinct from p_reminder_id then
      outcome := 'ownership_mismatch'; exit checks;
    end if;
    if schedule.generation is distinct from p_generation then
      outcome := 'stale_generation'; exit checks;
    end if;
    if schedule.status is distinct from 'active' then
      outcome := 'inactive'; exit checks;
    end if;
    if jsonb_typeof(snapshot->'reminders') is distinct from 'array' then
      outcome := 'inactive'; exit checks;
    end if;
    -- Duplicate identities are ambiguous and must not acknowledge a start.
    if (select count(*) from jsonb_array_elements(snapshot->'reminders') r
        where r->>'id' = p_reminder_id) > 1 then
      outcome := 'ownership_mismatch'; exit checks;
    end if;
    select r into candidate from jsonb_array_elements(snapshot->'reminders') r
      where r->>'id' = p_reminder_id;
    if not found then outcome := 'inactive'; exit checks; end if;
    if candidate->>'scheduler' is distinct from 'v5' then
      outcome := 'ownership_mismatch'; exit checks;
    end if;
    if candidate->'done' is distinct from 'false'::jsonb then
      outcome := 'inactive'; exit checks;
    end if;
    if schedule.expected_date is distinct from p_expected_date or schedule.expected_time is distinct from p_expected_time
       or candidate->>'date' is distinct from to_char(p_expected_date, 'YYYY-MM-DD')
       or coalesce(nullif(candidate->>'time', ''), '09:00') is distinct from to_char(p_expected_time, 'HH24:MI') then
      outcome := 'stale_generation'; exit checks;
    end if;
    if schedule.workflow_run_id is not null then
      if schedule.workflow_run_id = p_run_id and schedule.workflow_started_at is not null then
        outcome := 'already_recorded_same_run';
      else outcome := 'already_recorded_other_run'; end if;
      exit checks;
    end if;
    -- Fail closed on an inconsistent legacy acknowledgement, without overwriting.
    if schedule.workflow_started_at is not null then
      outcome := 'already_recorded_other_run'; exit checks;
    end if;
    update public.reminder_v5_schedules s
      set workflow_run_id = p_run_id, workflow_started_at = now(), updated_at = now()
      where s.id = p_schedule_id and s.owner_id = p_owner_id and s.reminder_id = p_reminder_id
        and s.generation = p_generation and s.status = 'active'
        and s.workflow_run_id is null and s.workflow_started_at is null
      returning s.id into updated_id;
    if updated_id is null then
      raise exception 'V5_ACK_UPDATE_NOT_CONFIRMED';
    end if;
    outcome := 'recorded';
  end checks;
  return jsonb_build_object('contract_version', 2, 'outcome', outcome,
    'schedule_id', p_schedule_id, 'generation', p_generation);
end;
$$;

revoke all on function public.record_v5_reminder_workflow_start_v2(uuid,uuid,text,bigint,date,time,text)
  from public, anon, authenticated;
grant execute on function public.record_v5_reminder_workflow_start_v2(uuid,uuid,text,bigint,date,time,text)
  to service_role;
commit;
