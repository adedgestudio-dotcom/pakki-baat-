-- STAGING ONLY. Run AFTER applying migration; transaction rolls back all fixtures.
-- Requires an existing staging auth.users account. Never run in production.
begin;
do $$
declare
  v_owner uuid;
  v_other_owner uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then raise exception 'Need existing staging auth user'; end if;
  -- A rolled-back fixture lets the test exercise real cross-account RLS even
  -- when staging currently has only one authenticating user.
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_other_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'verified-backup-other@example.test','not-used',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
  perform set_config('app.verified_backup_owner', v_owner::text, true);
  perform set_config('app.verified_backup_other_owner', v_other_owner::text, true);
end $$;

-- Exercise the same role used by PostgREST.
set local role authenticated;

do $$
declare
  v_owner uuid;
  v_other_owner uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_first record;
  v_second record;
  v_daily record;
  v_count integer;
  v_visible_to_other_owner integer;
  v_i integer;
begin
  v_owner := current_setting('app.verified_backup_owner', true)::uuid;
  v_other_owner := current_setting('app.verified_backup_other_owner', true)::uuid;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select * into v_first from public.save_workspace_backup_verified('{"test":1}'::jsonb,'pre_restore');
  select * into v_second from public.save_workspace_backup_verified('{"test":1}'::jsonb,'pre_restore');
  if v_first.backup_id = v_second.backup_id then raise exception 'Identical backups reused ID'; end if;
  if v_first.owner_id <> v_owner or v_second.owner_id <> v_owner then raise exception 'Wrong owner'; end if;
  if v_first.created_at is null or v_second.created_at is null then raise exception 'Missing creation timestamp'; end if;
  if v_first.payload_sha256 <> pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"test":1}'::jsonb::text,'UTF8'),'sha256'),'hex') then raise exception 'Digest mismatch'; end if;
  if not exists(select 1 from public.workspace_backups where id=v_second.backup_id and owner_id=v_owner and backup_kind='pre_restore'
    and payload='{"test":1}'::jsonb and created_at=v_second.created_at) then raise exception 'Returned confirmation did not match its inserted row'; end if;
  perform set_config('request.jwt.claim.sub', v_other_owner::text, true);
  select count(*) into v_visible_to_other_owner from public.workspace_backups where id = v_second.backup_id;
  if v_visible_to_other_owner <> 0 then raise exception 'Cross-owner backup read was allowed'; end if;
  if (select owner_id from public.save_workspace_backup_verified('{"other":true}'::jsonb,'pre_restore')) <> v_other_owner then raise exception 'RPC did not bind backup to current authenticated owner'; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  select * into v_daily from public.save_workspace_backup_verified('{"test":"daily"}'::jsonb,'daily');
  if v_daily.backup_kind <> 'daily' then raise exception 'Wrong daily kind'; end if;
  for v_i in 1..10 loop
    perform * from public.save_workspace_backup_verified(pg_catalog.jsonb_build_object('seq',v_i),'pre_restore');
  end loop;
  select count(*) into v_count from public.workspace_backups where owner_id=v_owner;
  if v_count <> 8 then raise exception 'Retention failed: %',v_count; end if;
  if not exists(select 1 from public.workspace_backups where owner_id=v_owner and payload = '{"seq":10}'::jsonb) then raise exception 'Latest backup was removed'; end if;
  begin
    perform * from public.save_workspace_backup_verified('[]'::jsonb,'pre_restore');
    raise exception 'Expected invalid payload rejection';
  exception when others then
    if position('Invalid backup payload' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform * from public.save_workspace_backup_verified('{}'::jsonb,'wrong_kind');
    raise exception 'Expected invalid kind rejection';
  exception when others then
    if position('Invalid backup kind' in sqlerrm) = 0 then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform * from public.save_workspace_backup_verified('{}'::jsonb,'pre_restore');
    raise exception 'Expected unauthenticated rejection';
  exception when others then
    if position('Not authenticated' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- Anonymous callers have no execution grant, regardless of supplied payload.
set local role anon;
do $$
begin
  begin
    perform * from public.save_workspace_backup_verified('{}'::jsonb,'pre_restore');
    raise exception 'Expected anonymous execution rejection';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;
