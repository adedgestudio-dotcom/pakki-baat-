-- Stop new uploads while preserving all photos, metadata and financial records.
begin;
revoke insert on public.hisaab_entry_photos from authenticated;
drop policy hisaab_entry_photo_object_add_own on storage.objects;
commit;
-- Restore only the original INSERT policy/grant after the cause is fixed.
-- Do not drop the bucket/table or delete attached files during an application rollback.
