$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'guarded-workspace-operation-idempotency-concurrency.ps1'
$valid = 'postgresql://postgres:example-password@db.jplxtqiryjnsdruqxgbh.supabase.co:5432/postgres?sslmode=require'

function Assert-Rejected([string] $ConnectionString, [string] $Name) {
  try {
    & $runner -ConnectionString $ConnectionString -ValidateOnly | Out-Null
    throw "Expected rejection: $Name"
  } catch {
    if ($_.Exception.Message -like "Expected rejection: $Name") { throw }
  }
}

& $runner -ConnectionString $valid -ValidateOnly | Out-Null
Assert-Rejected 'postgresql://postgres:example-password@jplxtqiryjnsdruqxgbh.evil.example:5432/postgres?sslmode=require' 'lookalike host'
Assert-Rejected 'postgresql://postgres:example-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require' 'pooler host'
Assert-Rejected 'postgresql://postgres:example-password@db.jplxtqiryjnsdruqxgbh.supabase.co:5433/postgres?sslmode=require' 'alternate port'
Assert-Rejected 'postgresql://postgres:example-password@db.jplxtqiryjnsdruqxgbh.supabase.co:5432/not-postgres?sslmode=require' 'alternate database'
Assert-Rejected 'not a connection URI' 'malformed URI'

$redirectingNames = @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS')
foreach ($name in $redirectingNames) {
  $prior = [Environment]::GetEnvironmentVariable($name)
  try {
    [Environment]::SetEnvironmentVariable($name, 'redirect.example.test')
    Assert-Rejected $valid "$name override"
  } finally {
    [Environment]::SetEnvironmentVariable($name, $prior)
  }
}

$fixtureOwner = '11111111-2222-4333-8444-555555555555'
$fixtureEmail = "guarded-operation-concurrency-$fixtureOwner@example.test"
$cleanupEnv = 'PAKKI_BAAT_GUARDED_STAGING_DATABASE_URL'
$priorCleanupUri = [Environment]::GetEnvironmentVariable($cleanupEnv)
try {
  [Environment]::SetEnvironmentVariable($cleanupEnv, $valid)
  & $runner -CleanupOnly -FixtureOwner $fixtureOwner -FixtureEmail $fixtureEmail -ValidateOnly | Out-Null
  try {
    & $runner -CleanupOnly -FixtureOwner $fixtureOwner -FixtureEmail 'wrong@example.test' -ValidateOnly | Out-Null
    throw 'Expected rejection: cleanup email mismatch'
  } catch {
    if ($_.Exception.Message -like 'Expected rejection:*') { throw }
  }
} finally {
  [Environment]::SetEnvironmentVariable($cleanupEnv, $priorCleanupUri)
}

Write-Output 'PASS: 15 strict staging-target validation cases'
