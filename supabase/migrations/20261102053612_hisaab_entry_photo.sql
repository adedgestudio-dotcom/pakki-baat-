-- PB-11: independent attachment metadata. No workspace, ledger or mode is changed.
begin;
set local lock_timeout='5s';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hisaab-entry-photos','hisaab-entry-photos',false,5242880,array['image/jpeg','image/png','image/webp']);

create table public.hisaab_entry_photos (
  owner_id uuid not null references auth.users(id) on delete cascade,
  entry_id text not null check(char_length(entry_id) between 1 and 200 and length(btrim(entry_id))>0),
  object_path text not null unique,
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check(byte_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  primary key(owner_id,entry_id),
  check(object_path ~ ('^'||owner_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$'))
);
alter table public.hisaab_entry_photos enable row level security;
revoke all on public.hisaab_entry_photos from public,anon,authenticated;
grant select,insert on public.hisaab_entry_photos to authenticated;
grant all on public.hisaab_entry_photos to service_role;
create policy hisaab_entry_photo_read_own on public.hisaab_entry_photos for select to authenticated
using(owner_id=(select auth.uid()));
create policy hisaab_entry_photo_add_own_saved_entry on public.hisaab_entry_photos for insert to authenticated
with check(
 owner_id=(select auth.uid())
 and exists(select 1 from public.subscriptions s where s.owner_id=(select auth.uid()) and s.status='active' and s.period_end>now())
 and exists(select 1 from public.workspaces w cross join lateral jsonb_array_elements(w.payload->'jobs') j
            where w.owner_id=(select auth.uid()) and j->>'id'=entry_id)
 and exists(select 1 from storage.objects o where o.bucket_id='hisaab-entry-photos' and o.name=object_path
            and o.metadata->>'mimetype'=content_type and (o.metadata->>'size')::bigint=byte_size)
);
create policy hisaab_entry_photo_object_read_own on storage.objects for select to authenticated
using(bucket_id='hisaab-entry-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy hisaab_entry_photo_object_add_own on storage.objects for insert to authenticated
with check(bucket_id='hisaab-entry-photos'
 and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
 and exists(select 1 from public.subscriptions s where s.owner_id=(select auth.uid()) and s.status='active' and s.period_end>now()));
-- Only unlinked failed uploads can be removed. A committed photo is immutable in v1.
create policy hisaab_entry_photo_object_cleanup_own on storage.objects for delete to authenticated
using(bucket_id='hisaab-entry-photos' and (storage.foldername(name))[1]=(select auth.uid())::text
 and not exists(select 1 from public.hisaab_entry_photos p where p.object_path=objects.name));
commit;
