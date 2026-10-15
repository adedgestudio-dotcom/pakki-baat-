# Phase 1B.4D guarded reducer migration plan

## Persisted state boundary

The reducer owns exactly `Snapshot`: `jobs`, `payments`, `reminders`, `notes`, `customerPhones`, `owner`, and `business`. The following remain transient and must never dispatch persisted reducer actions: tabs, modals, drafts, selected customer, chat turns/pending chat entry, voice URLs/files, payment request UI, toast, sync indicators, subscription state, theme, online state, reminder alarm UI, and authentication/session display state.

## 57 direct setter audit groups

| Group | Current examples | Multi-field or async dependency |
| --- | --- | --- |
| Hydration/reset (excluded from user dispatch) | cloud hydration, signed-out reset, `restore` | Must use a privileged `hydrate`/`reset` reducer action only after owner check; never journal. |
| Profile and phones | profile, WhatsApp, controlled phone editor | Profile is two fields; phone must be a complete snapshot operation. |
| Hisaab and payments | chat edit, pending/form save, quick payment, draft save | Jobs and payments must commit as one snapshot; preserve payment reconciliation and ledger validation first. |
| Reminders and notes | AI reminder/note, editor save, complete/snooze/delete | AI continuations must re-check owner and gate after awaits. |
| Deletes | customer, entry, reminder, inline commitment deletion | Customer/entry deletes cascade jobs, payments, reminders, notes, phones, plus transient cleanup. |
| Special workflows | undo, import/restore, pre-delete/pre-restore backup, immediate reminder cloud save | Require the dedicated journal-aware cloud/backup coordinator; no reducer user action may bypass it. |
| Sample data | sample commitments | Full snapshot operation, prohibited while ledger retry/pending recovery exists. |

The enforced 57-call baseline is in `tests/workspace-persisted-setter-audit.test.cjs`. Each migration removes a listed direct setter; a new one fails the audit.

## Reducer and dispatch contract

1. Store one `persistedSnapshot` reducer state; derive the current Snapshot ref synchronously from each accepted reducer application.
2. `dispatchWorkspaceOperation(operation)` first verifies active owner, subscription policy, gate state, and operation-specific validation.
3. It builds a complete next Snapshot through `planWorkspaceMutation`, then calls `commitWorkspaceTransaction` synchronously.
4. Only after storage readback succeeds does it dispatch `{ type: "apply-user-snapshot", snapshot, operationId }`.
5. Hydration/logout/reset use separate privileged actions. They must clear/replace reducer state only after session sequencing, and never create a journal.
6. A reducer action carrying an unknown owner, stale operation ID, failed storage result, manual journal, recovery conflict, or ledger-dirty disagreement is rejected without changing persisted state.

## Legacy cloud/backup policies

- `saveReminder` immediate cloud save: block migration until it becomes journal-first and receives a confirmed coordinator acknowledgment.
- Undo: create a journaled replacement operation only after its precondition policy is defined; do not call legacy `saveCloud` directly.
- Import/restore: retain pre-restore backup semantics, then journal the imported snapshot; cloud confirmation is a later coordinator operation.
- Pre-delete/pre-restore backup: defer backup creation until confirmed journal-aware cloud save, or introduce a durable local backup record first.
- Ledger-dirty exact retry: a differing payload blocks all user operations. A matching payload remains under the existing exact retry path until a coordinator proves compatible reconciliation.

## Atomic migration batches

No temporary mixed guarded/unguarded user-write mode is safe: an unguarded setter can produce an unjournaled state while a journal blocks autosave. Use one atomic cutover in a staging-only feature flag:

1. Add reducer state and privileged hydration/reset actions, but leave the flag off.
2. Convert *every* user persisted operation behind the flag in one branch: profile/phones, Hisaab/payments, reminders/notes/AI, deletes/sample/inline callbacks, then special flows only when their policies are implemented.
3. Under the flag, remove or make unreachable every direct user persisted setter; audit baseline must be zero except privileged hydration/reset application internals.
4. Enable only after reducer, storage-failure, owner-switch, and ledger regression suites pass. The flag must fail closed when a special workflow is not yet supported.

Smallest viable atomic cutover risk: this is a large UI-state refactor; it can alter modal cleanup and chat drafts. Mitigate with reducer-level pure tests, staged feature-flag tests, and a full manual staging pass before enabling. Do not enable for production until journal cloud coordination and conflict-resolution UI are complete.

## Acceptance criteria

- No direct user persisted setters remain; audit contains only approved hydration/logout/reducer application internals.
- Every user operation produces one validated complete snapshot and journal before reducer dispatch.
- Failed storage, owner changes, gate denial, and async stale continuations leave both persisted UI state and journal ownership safe.
- Job/payment cascades, deletes, import/undo policy, subscription limits, and ledger exact-retry regression tests pass.
- Journal cloud upload remains separately gated and disabled until its coordinator integration is verified.
