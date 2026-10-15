# Phase 1B.4F guarded reducer cutover contract

`GUARDED_REDUCER_STAGING_FLAG_DEFAULT` is `false` and is not connected to the app. A future staging-only enable request succeeds only when every audited user mutation is migrated and all special workflows are ready. Any count mismatch disables the flag, preventing mixed guarded/unguarded operation.

Rollback: disable the staging flag before dispatching any new guarded user operation; preserve journals and do not fall back to generic autosave for pending data. Roll back only after recovery state is inspected. Cutover requires: 57 baseline user setter sites classified, zero direct user setters remaining after migration, full reducer/ledger/storage/account-switch suite passing, and manual staging checks of imports, undo, reminder alerts, and destructive backups.
