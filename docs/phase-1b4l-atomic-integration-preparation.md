# Phase 1B.4L atomic workspace integration preparation

## Current persisted mutation inventory

The static audit finds 57 direct setters in `app/workspace.tsx`.

- Privileged session/hydration reset only: lines 699–705 and 1758–1762 (12 setters). These become reducer `hydrate`/`owner-reset` actions and never journal.
- Guarded user/application coverage (45 setters): profile (461–462), reminder delete (1550), AI reminder/note/payment correction (1880, 1923, 1948, 1950), all job/payment saves (1992, 1995, 2063, 2066, 2114, 2116, 2595–2596), undo (2488–2494), WhatsApp phone (2514), status (2613), customer and entry cascades (2637–2642, 2657–2659), sample (2700), restore bridge (2728–2734), reminders (2841, 2881, 2943), and inline customer-note/draft-delete callbacks (4436, 4584).

`lib/workspace-atomic-cutover-contract.ts` and its audit test require every one of those 45 lines to be mapped before staging activation. A new direct setter, a missing mapping, or a changed line requires an explicit re-audit.

## Atomic cutover design

1. Replace the seven persisted React fields with one reducer-owned `Snapshot`. Keep transient UI state outside it.
2. Each user operation first validates session, subscription, plan/customer limits, recovery gate, and ledger-dirty compatibility; it then builds one complete snapshot through the planner or a dedicated complete-snapshot adapter.
3. It synchronously writes and verifies the owner-scoped pending journal, then dispatches the reducer action. Failure changes no displayed persisted state.
4. Hydration/logout are privileged reducer actions only. They do not journal. All user actions—including async AI continuations—must re-check owner/session after awaits.
5. Generic autosave remains blocked for any journal/recovery state. Only the existing journal-specific cloud path may later acknowledge a revisioned journal; it remains disabled for this phase.

## Destructive workflow rule

Undo, import/restore, customer deletion, entry deletion, and any future destructive replacement must call the verified-backup coordinator first. It must receive a matching owner, `pre_restore` kind, specific backup UUID, server digest, timestamp, and post-request active session. Offline, stale, mismatched, duplicate, manual-recovery, ledger-dirty, or conflict state blocks continuation. Legacy void backup confirmation is never accepted.

## Activation checklist

1. Implement all 45 mappings in one atomic branch; remove direct user setters rather than leaving flag-dependent duplicates.
2. Replace the current restore bridge with the reducer’s sole post-journal application action.
3. Add complete planner adapters for reminder delete/complete/snooze, sample, status, note creation, and exact import/undo replacement snapshots; retain existing job/payment ledger validation before planning.
4. Connect special operations to the verified-backup coordinator and journal acknowledgment coordinator; verify backups before destructive continuation.
5. Confirm zero non-privileged setters through the static audit, all unit/ledger tests, and a full manual staging pass covering account switch, storage quota, offline, retry, chat/voice, receipts, import, restore, undo, reminders, and deletes.
6. Enable only the staging flag after all checks. Journal cloud upload stays separately gated until safe coordinator integration is tested.

## Rollback and blockers

Disable the staging flag before any new guarded action. Preserve journals and ledger-dirty records; never fall back to generic autosave. Restore only after recovery state is inspected.

This preparation is **not ready to activate**. The planner does not yet cover all 45 operations, `app/workspace.tsx` still owns seven independent persisted fields, special workflow adapters are not wired, and journal upload/conflict UI remain inactive. These must be completed atomically in a separate staging activation phase.
