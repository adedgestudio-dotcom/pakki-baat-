-- Keep upload and response sizes below the host limit, including multipart overhead.
-- Never truncate, recompress or delete an existing photo.
begin;
set local lock_timeout='5s';
lock table public.hisaab_entry_photos in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.hisaab_entry_photos where byte_size>4194304) then
  raise exception 'EXISTING_PHOTOS_REQUIRE_REVIEW_BEFORE_LIMIT_CHANGE';
 end if;
 if not exists(select 1 from storage.buckets where id='hisaab-entry-photos' and not public) then
  raise exception 'PRIVATE_ENTRY_PHOTO_BUCKET_REQUIRED';
 end if;
end $$;
update storage.buckets set file_size_limit=4194304 where id='hisaab-entry-photos';
alter table public.hisaab_entry_photos add constraint entry_photo_host_request_limit check(byte_size<=4194304);
commit;
