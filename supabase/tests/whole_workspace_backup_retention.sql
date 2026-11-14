-- Staging only. Uses the fictional QA account; all fixture writes roll back.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $$
begin
  if not exists (select 1 from auth.users
    where id = '740411d2-a2c9-4dd6-84ba-8679514d28fb'
      and email = 'ledger-staging-01@example.com') then
    raise exception 'STAGING_QA_IDENTITY_REQUIRED';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '740411d2-a2c9-4dd6-84ba-8679514d28fb', true);
delete from public.workspace_backups where owner_id = auth.uid();

insert into public.workspace_backups(owner_id, payload, backup_kind, backup_day, created_at)
values
  (auth.uid(), '{"owner":"QA","business":"Shop","jobs":[]}', 'manual', current_date - 31, now() - interval '31 days'),
  (auth.uid(), '{"owner":"QA","business":"Shop","jobs":[]}', 'pre_restore', current_date - 31, now() - interval '31 days'),
  (auth.uid(), '{"owner":"QA","business":"Shop","jobs":[]}', 'pre_restore', current_date - 20, now() - interval '20 days');
insert into public.workspace_backups(owner_id, payload, backup_kind, backup_day, created_at)
select auth.uid(), jsonb_build_object('owner','QA','business','Shop','jobs','[]'::jsonb,'number',n),
  'manual', current_date, now() - make_interval(mins => n)
from generate_series(1, 65) as n;

do $$
declare
  result jsonb;
  before_count integer;
begin
  result := public.save_workspace_backup('{"owner":"QA","business":"Shop","jobs":[],"number":"newest"}'::jsonb, 'manual');
  if result->>'created' <> 'true' then raise exception 'NEWEST_NOT_CREATED'; end if;
  if (select count(*) from public.workspace_backups where owner_id = auth.uid()) <> 60 then
    raise exception 'COUNT_NOT_CAPPED_AT_60';
  end if;
  if exists (select 1 from public.workspace_backups where owner_id = auth.uid()
      and created_at < now() - interval '30 days') then
    raise exception 'OLD_BACKUP_NOT_PRUNED';
  end if;
  if not exists (select 1 from public.workspace_backups where id = (result->>'id')::uuid) then
    raise exception 'NEWEST_BACKUP_REMOVED';
  end if;
  if not exists (select 1 from public.workspace_backups where owner_id = auth.uid()
      and backup_kind = 'pre_restore' and created_at > now() - interval '21 days'
      and created_at < now() - interval '19 days') then
    raise exception 'YOUNG_SAFETY_COPY_REMOVED';
  end if;
  select count(*) into before_count from public.workspace_backups where owner_id = auth.uid();
  result := public.save_workspace_backup('{"owner":"QA","business":"Shop","jobs":[],"number":"newest"}'::jsonb, 'manual');
  if result->>'created' <> 'false' or
     (select count(*) from public.workspace_backups where owner_id = auth.uid()) <> before_count then
    raise exception 'IDENTICAL_BACKUP_DUPLICATED';
  end if;
  raise notice 'PASS: 30-day pruning, 60-backup cap, newest and safety protection, dedupe';
end $$;
rollback;
