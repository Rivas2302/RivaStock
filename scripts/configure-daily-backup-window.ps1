<#
.SYNOPSIS
Configures whether the RivaStock daily backup task shows a PowerShell window.

.DESCRIPTION
The scheduled backup remains enabled. By default, this script hides its console.
Pass -ShowWindow to make the console visible again.

.EXAMPLE
./scripts/configure-daily-backup-window.ps1

.EXAMPLE
./scripts/configure-daily-backup-window.ps1 -ShowWindow
#>
param(
  [switch]$ShowWindow
)

$ErrorActionPreference = 'Stop'
$taskName = 'RivaStock Daily Verified Backup'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop

if ($task.Actions.Count -ne 1) {
  throw "La tarea '$taskName' debe tener exactamente una acción."
}

$action = $task.Actions[0]
if ([System.IO.Path]::GetFileName($action.Execute) -notmatch '^powershell(?:\.exe)?$') {
  throw "La acción de '$taskName' no ejecuta Windows PowerShell."
}

$arguments = [regex]::Replace(
  $action.Arguments,
  '(?i)(?:^|\s)-WindowStyle\s+(?:Hidden|Normal|Minimized|Maximized)\b',
  ''
).Trim()

if (-not $ShowWindow) {
  $arguments = "-WindowStyle Hidden $arguments"
}

$actionParameters = @{
  Execute = $action.Execute
  Argument = $arguments
}
if ($action.WorkingDirectory) {
  $actionParameters.WorkingDirectory = $action.WorkingDirectory
}
$updatedAction = New-ScheduledTaskAction @actionParameters
Set-ScheduledTask -TaskName $taskName -Action $updatedAction | Out-Null

$verified = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($verified.Actions[0].Arguments -ne $arguments) {
  throw 'No se pudo verificar la configuración de la ventana del backup.'
}

if ($ShowWindow) {
  Write-Output "La tarea '$taskName' puede volver a mostrar su ventana."
} else {
  Write-Output "La tarea '$taskName' seguirá ejecutándose sin mostrar la ventana."
}
