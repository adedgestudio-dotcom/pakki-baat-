# Guarded-operation concurrency-harness recovery

The two-session harness commits only one disposable fixture so both sessions can
observe it. Before setup, the runner stores the reviewed URI only in the current
process environment as `PAKKI_BAAT_GUARDED_STAGING_DATABASE_URL` and prints an
executable UUID-specific `-CleanupOnly` command without printing the URI or its
password. If the process itself is terminated, set that variable again to the
same reviewed direct staging URI before running the printed command. Do not add
`PGHOST`, `PGSERVICE`, `PGDATABASE`, or other redirecting `PG*` variables.

```powershell
& '<absolute path to guarded-workspace-operation-idempotency-concurrency.ps1>' -CleanupOnly -FixtureOwner '<printed-fixture-uuid>' -FixtureEmail 'guarded-operation-concurrency-<printed-fixture-uuid>@example.test' -Psql 'psql'
```

The cleanup SQL deletes only `auth.users` where both the generated UUID and the
generated `guarded-operation-concurrency-<uuid>@example.test` email match. Its
foreign-key cascades remove only that fixture's workspace, entitlement, ledger
mode, and guarded receipts. The fixture payload intentionally contains no jobs
or payments, so it creates no immutable ledger rows; if that invariant changes,
the ledger's restrictive foreign key makes cleanup fail closed. Never substitute
a real customer UUID or use a broad delete. If cleanup does not complete, stop
and inspect the exact fixture UUID before retrying the same command.
