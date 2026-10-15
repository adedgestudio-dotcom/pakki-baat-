<#
STAGING-ONLY, genuine two-session harness for guarded workspace idempotency.
It refuses any host other than the reviewed staging project and creates a
disposable committed fixture so the two sessions can observe the same locks.
The fixture is removed in finally, but an interrupted process may leave it
behind; the cleanup script is deliberately UUID-addressed for manual recovery.
Never run against production.
#>
[CmdletBinding()]
param(
  [string] $ConnectionString,
  [string] $Psql = 'psql',
  [switch] $ValidateOnly,
  [switch] $CleanupOnly,
  [string] $FixtureOwner,
  [string] $FixtureEmail
)

$ErrorActionPreference = 'Stop'
$expectedHost = 'db.jplxtqiryjnsdruqxgbh.supabase.co'
$redirectingEnvironmentVariables = @(
  'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS'
)
$cleanupConnectionEnvironmentVariable = 'PAKKI_BAAT_GUARDED_STAGING_DATABASE_URL'

function Assert-ReviewedStagingTarget([string] $Value) {
  foreach ($name in $redirectingEnvironmentVariables) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      throw "Refusing concurrency harness: $name is set and could make the effective psql target ambiguous."
    }
  }

  try { $uri = [Uri]$Value } catch { throw 'Refusing concurrency harness: connection string is not a valid PostgreSQL URI.' }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('postgres', 'postgresql')) {
    throw 'Refusing concurrency harness: connection string must use an absolute postgres:// or postgresql:// URI.'
  }
  if ($uri.Host -cne $expectedHost -or $uri.Port -ne 5432) {
    throw 'Refusing concurrency harness: target must be exactly the reviewed staging host on port 5432.'
  }
  if ([string]::IsNullOrWhiteSpace($uri.UserInfo) -or $uri.AbsolutePath -cne '/postgres') {
    throw 'Refusing concurrency harness: connection URI must include credentials and the approved postgres database.'
  }
  if ([string]::IsNullOrWhiteSpace($uri.Query) -or $uri.Query -cne '?sslmode=require') {
    throw 'Refusing concurrency harness: only an explicit sslmode=require query is accepted.'
  }
  if ($uri.Fragment -or $uri.HostNameType -ne [UriHostNameType]::Dns) {
    throw 'Refusing concurrency harness: URI fragments and non-DNS hosts are not allowed.'
  }
  return $uri
}

if ($CleanupOnly) {
  if (-not [string]::IsNullOrWhiteSpace($ConnectionString)) {
    throw 'Refusing cleanup mode: supply the reviewed URI only through the named recovery environment variable.'
  }
  $ConnectionString = [Environment]::GetEnvironmentVariable($cleanupConnectionEnvironmentVariable)
  $parsedFixtureOwner = [guid]::Empty
  if (-not [guid]::TryParse($FixtureOwner, [ref]$parsedFixtureOwner)) {
    throw 'Refusing cleanup mode: FixtureOwner must be a generated UUID.'
  }
  $expectedFixtureEmail = "guarded-operation-concurrency-$parsedFixtureOwner@example.test"
  if ($FixtureEmail -cne $expectedFixtureEmail) {
    throw 'Refusing cleanup mode: FixtureEmail must exactly match the generated fixture UUID.'
  }
} elseif ([string]::IsNullOrWhiteSpace($ConnectionString)) {
  throw 'Refusing concurrency harness: ConnectionString is required in normal mode.'
}

[void](Assert-ReviewedStagingTarget $ConnectionString)
if ($ValidateOnly) { Write-Output 'PASS: reviewed staging target validation'; return }
if (-not (Get-Command $Psql -ErrorAction SilentlyContinue)) {
  throw "psql executable not found: $Psql"
}

$root = Split-Path -Parent $PSScriptRoot
$payload = '{"jobs":[],"payments":[],"reminders":[],"notes":[],"customerPhones":{},"owner":{},"business":{}}'
$owner = [guid]::NewGuid().ToString()
$sameOperation = [guid]::NewGuid().ToString()
$winnerOperation = [guid]::NewGuid().ToString()
$loserOperation = [guid]::NewGuid().ToString()
$logs = Join-Path ([System.IO.Path]::GetTempPath()) ("pakki-baat-guarded-concurrency-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $logs | Out-Null

function Invoke-GuardedSql([string] $File, [hashtable] $Variables, [bool] $Background = $false) {
  # -X prevents ~/.psqlrc from issuing \connect or other command overrides.
  $args = @('-X', '--set', 'ON_ERROR_STOP=1', '--dbname', $ConnectionString, '--file', (Join-Path $PSScriptRoot $File))
  foreach ($pair in $Variables.GetEnumerator()) { $args += @('--set', "$($pair.Key)=$($pair.Value)") }
  if ($Background) {
    return Start-Process -FilePath $Psql -ArgumentList $args -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $logs ($File + '.out')) -RedirectStandardError (Join-Path $logs ($File + '.err'))
  }
  & $Psql @args
  if ($LASTEXITCODE -ne 0) { throw "SQL harness failed: $File" }
}

function Wait-ForProcess([Diagnostics.Process] $Process, [string] $Name) {
  if (-not $Process.WaitForExit(15000)) {
    try { $Process.Kill($true) } catch { }
    $Process.WaitForExit()
    throw "$Name exceeded the 15-second harness timeout; safe diagnostics are in $logs."
  }
  if ($Process.ExitCode -ne 0) { throw "$Name failed; safe diagnostics are in $logs." }
}

function Stop-RunningChildren([object[]] $Processes) {
  foreach ($process in $Processes) {
    if ($null -eq $process) { continue }
    try {
      if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() }
    } catch { }
  }
}

function Wait-ForOwnerLock([string] $FixtureOwner) {
  $deadline = [Diagnostics.Stopwatch]::StartNew()
  do {
    $probeArgs = @('-X', '-qAt', '--set', 'ON_ERROR_STOP=1', '--set', "owner=$FixtureOwner", '--dbname', $ConnectionString,
      '--file', (Join-Path $PSScriptRoot 'guarded-workspace-operation-idempotency-concurrency-ready.sql'))
    $probeOutput = & $Psql @probeArgs 2>&1
    if ($LASTEXITCODE -eq 0 -and (($probeOutput -join "`n") -match '(?m)^READY$')) { return }
    Start-Sleep -Milliseconds 100
  } while ($deadline.ElapsedMilliseconds -lt 5000)
  throw "Session A never proved it held the owner lock within 5 seconds; safe diagnostics are in $logs."
}

function Write-RecoveryCommand([string] $FixtureOwner) {
  $cleanup = Join-Path $PSScriptRoot 'guarded-workspace-operation-idempotency-concurrency-cleanup.sql'
  $fixtureEmail = "guarded-operation-concurrency-$FixtureOwner@example.test"
  [Environment]::SetEnvironmentVariable($cleanupConnectionEnvironmentVariable, $ConnectionString)
  Write-Warning "If interrupted after setup, run exactly: & `"$PSCommandPath`" -CleanupOnly -FixtureOwner `"$FixtureOwner`" -FixtureEmail `"$fixtureEmail`" -Psql `"$Psql`""
}

function Copy-Variables([hashtable] $Source) {
  $copy = @{}
  foreach ($pair in $Source.GetEnumerator()) { $copy[$pair.Key] = $pair.Value }
  return $copy
}

$common = @{ owner = $owner; payload = $payload }
$sameBarrier = [guid]::NewGuid().ToString()
$competingBarrier = [guid]::NewGuid().ToString()
$children = @()
try {
  if ($CleanupOnly) {
    Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-cleanup.sql' @{ owner = $FixtureOwner; email = $FixtureEmail }
    Write-Output 'PASS: UUID-scoped concurrency fixture cleanup completed.'
    return
  }
  Write-RecoveryCommand $owner
  Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-setup.sql' $common

  # Same operation, two sessions: only one revision advance and one receipt.
  $sameWinner = Copy-Variables $common
  $sameWinner.operation_id = $sameOperation; $sameWinner.expected_revision = '1'; $sameWinner.barrier_id = $sameBarrier
  $first = Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-same-winner.sql' $sameWinner $true
  $children += $first
  Wait-ForOwnerLock $owner
  $sameRetry = Copy-Variables $common
  $sameRetry.operation_id = $sameOperation; $sameRetry.expected_revision = '1'; $sameRetry.barrier_id = $sameBarrier
  $second = Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-same-retry.sql' $sameRetry $true
  $children += $second
  Wait-ForProcess $first 'Same-operation winner session'; Wait-ForProcess $second 'Same-operation retry session'

  # Competing operations at revision 2: one wins, the peer must conflict.
  $competingWinner = Copy-Variables $common
  $competingWinner.operation_id = $winnerOperation; $competingWinner.expected_revision = '2'; $competingWinner.barrier_id = $competingBarrier
  $winner = Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-competing-winner.sql' $competingWinner $true
  $children += $winner
  Wait-ForOwnerLock $owner
  $competingLoser = Copy-Variables $common
  $competingLoser.operation_id = $loserOperation; $competingLoser.expected_revision = '2'; $competingLoser.barrier_id = $competingBarrier
  $loser = Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-competing-loser.sql' $competingLoser $true
  $children += $loser
  Wait-ForProcess $winner 'Competing-operation winner session'; Wait-ForProcess $loser 'Competing-operation loser session'
  Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-verify.sql' @{
    owner = $owner; same_operation = $sameOperation; winner_operation = $winnerOperation; loser_operation = $loserOperation
  }

  Write-Host "PASS: guarded two-session concurrency harness. Logs: $logs"
}
finally {
  Stop-RunningChildren $children
  if (-not $CleanupOnly) { try { Invoke-GuardedSql 'guarded-workspace-operation-idempotency-concurrency-cleanup.sql' @{ owner = $owner; email = "guarded-operation-concurrency-$owner@example.test" } } catch {
    Write-Warning "Disposable fixture cleanup failed. Run the UUID-addressed cleanup script with owner=$owner."
    throw
  } }
}
