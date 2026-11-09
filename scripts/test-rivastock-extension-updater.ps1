Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

foreach ($name in @(
  'rivastock-extension-updater.ps1',
  'install-rivastock-extension-updater.ps1',
  'uninstall-rivastock-extension-updater.ps1'
)) {
  $tokens = $null
  $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) { throw ('PowerShell syntax validation failed: ' + $name) }
}

& $powerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-rivastock-extension-updater.ps1') -ValidateOnly
if ($LASTEXITCODE -ne 0) { throw 'Scheduled task validation failed.' }
& $powerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'rivastock-extension-updater.ps1') -Simulation
if ($LASTEXITCODE -ne 0) { throw 'Update simulation failed.' }
