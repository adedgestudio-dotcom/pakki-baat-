# Staging baseline and migration strategy

`20261009000000_staging_application_baseline.sql` is a one-time, explicit staging
bootstrap for a project that already has the Phase 1A ledger migration recorded.
It deliberately leaves `hisaab_ledger_transactions` untouched.

## Why it is not `supabase db push`

The legacy files use date-only version prefixes and several share the same version
(`20260928` and `20260929`). Supabase migration history cannot independently track
those files. Do not rename, repair, or replay them against production.

For this staging project, apply the new baseline explicitly after review, then run
`supabase/tests/staging_application_baseline_verification.sql`. Record only the new
unique baseline version in staging history. Do not mark the colliding legacy files
as applied.

## Forward-only rule

Every migration created after this baseline must use a unique 14-digit UTC prefix,
for example `YYYYMMDDHHMMSS_feature_name.sql`. New migrations must be additive and
must assume the canonical baseline objects exist. Production must receive a separate
reviewed rollout plan; its historical files and history are not to be rewritten.
