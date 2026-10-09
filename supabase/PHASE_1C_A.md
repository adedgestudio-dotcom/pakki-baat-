# Phase 1C-A atomic Hisaab save contract

Staging migrations `20261010000200`, `20261010000201`, and `20261010000202`
add the backend foundation. They enable no owner. The app still calls the legacy
`save_workspace` RPC, so live Hisaab behavior is unchanged.

## Activation preconditions

After a conflict-free Phase 1B backfill of an owner's current workspace, a
service-role caller may call `enable_workspace_hisaab_ledger(target_owner_id)`.
The RPC rejects missing/stale backfills, audit issues, duplicate payment IDs,
missing or mismatched charges/payments, and unrelated ledger rows. It locks the
workspace before changing the owner-level mode. Do not enable an owner until its
client has been switched to the atomic RPC; the legacy save path is blocked once
enabled.

## Save contract

`save_workspace_with_ledger(payload, expected_revision)` derives its owner from
`auth.uid()`. A client must read the current `workspaces.revision` with the payload
and submit that revision. The RPC locks the workspace, validates the snapshot,
appends ledger events, checks each active job's charge and paid balance, then
updates the workspace. PostgreSQL commits or rolls back all of it together.

Identical retries return the existing revision without new entries. A differing
save with a stale revision fails with `WORKSPACE_REVISION_CONFLICT`. The client
must reload and resolve that conflict rather than retrying with a guessed revision.

New jobs produce positive charge events. New payments produce positive payment
events. A zero-paid job produces no payment event. Total or payment edits append
a full reversal of the active event and a replacement; they never rewrite a
financial row. Payment replacements retain the original payment ID in metadata.
Deleting a job/customer from active JSON leaves its ledger history intact.
An ID already used by deleted history cannot be recycled.

Backfilled rows carry `legacy_backfill: true`; live events and reversals carry
`origin: live_atomic`. The ledger must be interpreted with reversal effects,
and active Hisaab balances must be scoped to currently active job IDs.

The guarded legacy `save_workspace` path and direct table writes continue while
the flag is OFF. Once enabled for an owner, workspace writes and ledger inserts
must come from the atomic RPC. The existing subscription/customer-cap rules are
also enforced for enabled owners.

## Known limits before UI integration

- The current UI does not fetch or submit `revision` and still calls legacy
  `save_workspace`; do not enable any real account yet.
- A historical workspace with unresolved Phase 1B issues cannot be activated.
- An edit of `job.paid` without corresponding payment-history changes is rejected
  rather than inventing a payment event.
- Rollback-only SQL tests verify optimistic conflict handling; they do not run
  two simultaneous database sessions. A concurrent-session test remains for the
  integration phase.
- The old date-only migrations still collide in Supabase history. Do not run
  `supabase db push`; use explicit, reviewed, unique forward migrations.
