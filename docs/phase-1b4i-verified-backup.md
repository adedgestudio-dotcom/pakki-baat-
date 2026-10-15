# Phase 1B.4I — local preparation (NOT APPLIED)

Additive `save_workspace_backup_verified(jsonb,text)` RPC returns the newly inserted row's `backup_id`, `owner_id`, `backup_kind`, SHA-256 of PostgreSQL's canonical `jsonb::text` representation, and `created_at`. This is a specific newly inserted row, not a list-read inference. For daily backups, the old daily row is deleted and a new row inserted in the same transaction, preserving one-per-day behavior. Per-owner row locking serializes creation and retention cleanup. Cleanup retains 8 total, always preserving the inserted row. Failed calls roll back insert, deletion, and cleanup together.

**Preconditions:** Verify `extensions.digest` (pgcrypto in Supabase extensions schema) and existing staging schema/permissions before applying. `auth.uid()` must match an existing account. Existing legacy RPC is untouched. `SECURITY DEFINER` function has empty search_path, schema-qualified relations and crypto function, and authenticated-only execution grant.

**Review before staging apply:** Confirm whether replacing an existing daily backup is acceptable; confirm retention policy of 8 and dependency on `auth.users` row lock. The backup identity confirms that the database function inserted the row; it does **not** guarantee permanent retention or solve an ambiguous network response. Clients must validate returned owner/kind/digest/ID and active session, and treat lost responses as unconfirmed. A future coordinator should use the backup ID and an explicit authenticated verification read if needed.

**Staging test:** Apply migration to staging only after review, then run `tests/verified-workspace-backup.sql` in staging SQL editor. The test uses an existing staging auth user plus a rolled-back second-user fixture, executes its RPC assertions as `authenticated`, verifies cross-owner RLS isolation, then verifies the `anon` execution denial. It rolls back its changes.

**Rollback:** `drop function if exists public.save_workspace_backup_verified(jsonb,text);` in staging only, after ensuring no new caller depends on it. Do not touch the legacy function.
