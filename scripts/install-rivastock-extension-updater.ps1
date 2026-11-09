param([switch]$ValidateOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'RivaStock Extension Updater'
$appRoot = Join-Path $env:LOCALAPPDATA 'RivaStock'
$installedUpdater = Join-Path $appRoot 'rivastock-extension-updater.ps1'
$sourceUpdater = Join-Path $PSScriptRoot 'rivastock-extension-updater.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path -LiteralPath $sourceUpdater -PathType Leaf)) { throw 'No se encontró el actualizador junto al instalador.' }

$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$escapedSid = [Security.SecurityElement]::Escape($userSid)
$escapedPowerShell = [Security.SecurityElement]::Escape($powershell)
$escapedUpdater = [Security.SecurityElement]::Escape($installedUpdater)
$escapedRoot = [Security.SecurityElement]::Escape($appRoot)
$startBoundary = (Get-Date).AddMinutes(2).ToString("yyyy-MM-dd'T'HH:mm:sszzz")
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Author>RivaStock</Author><Description>Actualiza la extensión local de RivaStock sin permisos de administrador.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$escapedSid</UserId></LogonTrigger>
    <TimeTrigger><Repetition><Interval>PT1H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$startBoundary</StartBoundary><Enabled>true</Enabled></TimeTrigger>
  </Triggers>
  <Principals><Principal id="RivaStockUser"><UserId>$escapedSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit><Priority>7</Priority>
  </Settings>
  <Actions Context="RivaStockUser"><Exec><Command>$escapedPowerShell</Command><Arguments>-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$escapedUpdater&quot;</Arguments><WorkingDirectory>$escapedRoot</WorkingDirectory></Exec></Actions>
</Task>
"@

[xml]$validatedTaskXml = $taskXml
if (-not $validatedTaskXml.Task.Triggers.LogonTrigger -or
  $validatedTaskXml.Task.Triggers.TimeTrigger.Repetition.Interval -ne 'PT1H' -or
  $validatedTaskXml.Task.Principals.Principal.RunLevel -ne 'LeastPrivilege') { throw 'La programación de la tarea no pasó la validación.' }
if ($ValidateOnly) {
  Write-Output 'PASS scheduled task XML: logon + hourly, current user, least privilege'
  exit 0
}

if (-not (Test-Path -LiteralPath $appRoot)) { New-Item -ItemType Directory -Path $appRoot -Force | Out-Null }
$tempUpdater = Join-Path $appRoot ('.updater-' + [Guid]::NewGuid().ToString('N') + '.ps1')
$backupUpdater = Join-Path $appRoot ('.updater-backup-' + [Guid]::NewGuid().ToString('N') + '.ps1')
try {
  Copy-Item -LiteralPath $sourceUpdater -Destination $tempUpdater -Force
  if (Test-Path -LiteralPath $installedUpdater) { [IO.File]::Replace($tempUpdater, $installedUpdater, $backupUpdater) }
  else { [IO.File]::Move($tempUpdater, $installedUpdater) }
} finally {
  if (Test-Path -LiteralPath $tempUpdater) { Remove-Item -LiteralPath $tempUpdater -Force }
  if (Test-Path -LiteralPath $backupUpdater) { Remove-Item -LiteralPath $backupUpdater -Force }
}

Register-ScheduledTask -TaskName $taskName -Xml $taskXml -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host 'Actualizador instalado para esta cuenta. El primer chequeo ya empezó.'
Write-Host "Carpeta de la extensión: $(Join-Path $appRoot 'extension')"
Write-Host "Registro: $(Join-Path $appRoot 'updater.log')"
