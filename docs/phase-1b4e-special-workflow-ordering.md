# Phase 1B.4E special workflow ordering

Current behavior (unchanged): `saveReminder` updates reminder state and closes its editor, then attempts direct `saveCloud`; failure leaves local state and continues alert messaging. Ledger undo calls `saveCloud` before applying state. Ledger import creates a `pre_restore` cloud backup, calls `saveCloud`, verifies the original session, then restores. Delete safety copy calls `saveWorkspaceBackup` and blocks deletion if it fails. `saveWorkspaceBackup` resolves only after its RPC returns successfully. Ledger retries preserve `pakki-baat-ledger-dirty` and re-send the exact payload/revision after an ambiguous response.

The new pure `workspace-special-workflow` state machine does not alter that behavior. It defines the guarded-reducer successor:

`preflight → journal-durable → cloud-pending → cloud-confirmed`

Any owner change, quota/storage failure, ledger disagreement, unknown/newer journal, manual journal, or cloud revision conflict goes to `failed` or `conflict`; no snapshot is applied. Destructive undo/import/restore requires a **confirmed** cloud backup before journal replacement. A failed/offline backup leaves the original workspace untouched. Reminder save must journal first and wait for the coordinator; it must not invoke legacy direct `saveCloud` or duplicate an upload. Ambiguous network outcomes remain `cloud-pending` until exact snapshot/owner acknowledgment, never success. Journal upload remains disabled in the application until the coordinator is integrated.
