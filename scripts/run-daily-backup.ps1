[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backupRoot = Join-Path $env:USERPROFILE 'rivastock-backups'
$logPath = Join-Path $backupRoot 'backup-log.txt'
$statePath = Join-Path $backupRoot 'backup-state.json'

function Get-NormalizedPath([string] $Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Test-PathIsDirectChild([string] $Parent, [string] $Child) {
  $parentPath = Get-NormalizedPath $Parent
  $childPath = Get-NormalizedPath $Child
  $childParent = Get-NormalizedPath ([System.IO.Path]::GetDirectoryName($childPath))
  return [string]::Equals($parentPath, $childParent, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathIsInside([string] $Parent, [string] $Child) {
  $parentPath = Get-NormalizedPath $Parent
  $childPath = Get-NormalizedPath $Child
  $prefix = $parentPath + [System.IO.Path]::DirectorySeparatorChar
  return $childPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-VerifiedBackup([string] $Path) {
  $name = [System.IO.Path]::GetFileName($Path)
  if ($name -notmatch '^\d{8}T\d{6}Z$' -or -not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
  if (-not (Test-PathIsDirectChild $backupRoot $Path)) { return $false }

  $directory = Get-Item -LiteralPath $Path -Force
  if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  if (Test-Path -LiteralPath (Join-Path $Path 'BACKUP-UNVERIFIED.txt')) { return $false }

  foreach ($fileName in @('schema.sql', 'data.sql', 'table-counts.csv', 'storage-manifest.json')) {
    $filePath = Join-Path $Path $fileName
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $filePath).Length -le 0) { return $false }
  }
  if (Test-Path -LiteralPath (Join-Path $Path 'storage-manifest.partial.json')) { return $false }

  try {
    $manifest = Get-Content -LiteralPath (Join-Path $Path 'storage-manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.version -ne 1 -or $manifest.buckets -isnot [System.Array] -or $manifest.objects -isnot [System.Array]) { return $false }
    foreach ($object in $manifest.objects) {
      if ($object.sha256 -notmatch '^[0-9a-f]{64}$' -or $object.size -lt 0 -or -not $object.file) { return $false }
      $objectPath = Get-NormalizedPath (Join-Path $Path $object.file)
      if (-not (Test-PathIsInside $Path $objectPath)) { return $false }
      if (-not (Test-Path -LiteralPath $objectPath -PathType Leaf)) { return $false }
      if ((Get-Item -LiteralPath $objectPath).Length -ne $object.size) { return $false }
    }
  } catch {
    return $false
  }

  return $true
}

function Get-BackupSummary([object[]] $Output) {
  foreach ($line in $Output) {
    try {
      $candidate = ([string]$line).Trim() | ConvertFrom-Json
      if (
        $candidate.verification -eq 'passed' -and
        $candidate.storage.verification -eq 'passed' -and
        $candidate.tables -gt 0 -and
        $candidate.rows -gt 0
      ) {
        return $candidate
      }
    } catch {
      # Ignore npm output; only the structured verified summary is accepted.
    }
  }
  return $null
}

function Remove-OldVerifiedBackups([int] $KeepCount) {
  $verified = @(
    Get-ChildItem -LiteralPath $backupRoot -Directory -Force |
      Where-Object { Test-VerifiedBackup $_.FullName } |
      Sort-Object Name -Descending
  )
  $toRemove = @($verified | Select-Object -Skip $KeepCount)
  foreach ($entry in $toRemove) {
    $target = Get-NormalizedPath $entry.FullName
    if (-not (Test-PathIsDirectChild $backupRoot $target)) { throw 'unsafe-retention-target' }
    if (-not (Test-VerifiedBackup $target)) { throw 'retention-target-not-verified' }
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  return $toRemove.Count
}

function Read-BackupState {
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    return [pscustomobject]@{ date = ''; outcome = ''; consecutiveFailures = 0 }
  }
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ([int]$state.consecutiveFailures -ge 0 -and $state.outcome -in @('passed', 'failed')) { return $state }
  } catch {
    # A malformed status file starts a fresh counter; no backup is deleted.
  }
  return [pscustomobject]@{ date = ''; outcome = ''; consecutiveFailures = 0 }
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$previousState = Read-BackupState
$today = Get-Date -Format 'yyyy-MM-dd'
$outcome = 'failed'
$reason = 'backup_failed'
$summary = $null
$backupName = 'none'
$removedBackups = 0

try {
  Push-Location $repoRoot
  try {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    $output = @(& $npm.Source run backup:db -- --with-storage 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  $summary = Get-BackupSummary $output
  if ($exitCode -ne 0 -or -not $summary) { throw 'backup-not-verified' }

  $backupPath = Get-NormalizedPath ([string]$summary.backup)
  if (-not (Test-PathIsDirectChild $backupRoot $backupPath) -or -not (Test-VerifiedBackup $backupPath)) {
    throw 'backup-path-or-files-not-verified'
  }
  $backupName = [System.IO.Path]::GetFileName($backupPath)
  $reason = 'retention_failed'
  $removedBackups = Remove-OldVerifiedBackups 14
  $outcome = 'passed'
  $reason = 'none'
} catch {
  if ($null -eq $summary) { $reason = 'backup_failed' }
}

$consecutiveFailures = 0
if ($outcome -eq 'failed') {
  $yesterday = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
  if ($previousState.outcome -eq 'failed' -and $previousState.date -eq $today) {
    $consecutiveFailures = [Math]::Max(1, [int]$previousState.consecutiveFailures)
  } elseif ($previousState.outcome -eq 'failed' -and $previousState.date -eq $yesterday) {
    $consecutiveFailures = [Math]::Max(1, [int]$previousState.consecutiveFailures) + 1
  } else {
    $consecutiveFailures = 1
  }
}

$now = Get-Date
$state = [pscustomobject]@{
  date = $today
  outcome = $outcome
  consecutiveFailures = $consecutiveFailures
  reportOwner = ($consecutiveFailures -ge 2)
}
$stateTemporaryPath = "$statePath.tmp"
$state | ConvertTo-Json -Compress | Set-Content -LiteralPath $stateTemporaryPath -Encoding UTF8
Move-Item -LiteralPath $stateTemporaryPath -Destination $statePath -Force

$tables = if ($summary) { [int]$summary.tables } else { 0 }
$rows = if ($summary) { [int64]$summary.rows } else { 0 }
$storageObjects = if ($summary) { [int]$summary.storage.objects } else { 0 }
$storageBytes = if ($summary) { [int64]$summary.storage.bytes } else { 0 }
$logLine = '{0} outcome={1} backup={2} tables={3} rows={4} storage_objects={5} storage_bytes={6} retained=14 removed={7} consecutive_failures={8} reason={9}' -f `
  $now.ToString('yyyy-MM-ddTHH:mm:sszzz'), $outcome, $backupName, $tables, $rows, $storageObjects, $storageBytes, $removedBackups, $consecutiveFailures, $reason
Add-Content -LiteralPath $logPath -Value $logLine -Encoding UTF8

if ($outcome -eq 'passed') { exit 0 }
exit 1
