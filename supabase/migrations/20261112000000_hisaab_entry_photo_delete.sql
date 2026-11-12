grant delete on public.hisaab_entry_photos to authenticated;

drop policy if exists hisaab_entry_photo_delete_own on public.hisaab_entry_photos;
create policy hisaab_entry_photo_delete_own on public.hisaab_entry_photos
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.subscriptions s
      where s.owner_id = (select auth.uid())
        and s.status = 'active'
        and s.period_end > now()
    )
  );
