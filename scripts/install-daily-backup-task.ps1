[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runnerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'run-daily-backup.ps1')).Path
$taskName = 'RivaStock Daily Verified Backup'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
  if ([string]$existingTask.Description -notlike 'Runs a verified RivaStock PostgreSQL and Storage backup*') {
    throw 'A scheduled task with the RivaStock backup task name already exists and was not changed.'
  }
}

$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $runnerPath
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '3:30AM'
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew
$description = 'Runs a verified RivaStock PostgreSQL and Storage backup daily at 03:30 local time. Uses the current Windows user; no credentials are stored in task arguments.'

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null
$registered = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName

[pscustomobject]@{
  task = $registered.TaskName
  state = [string]$registered.State
  nextRunTime = $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss')
  startTime = '03:30 local'
  runAsCurrentUser = $currentUser
  credentialsStored = $false
} | ConvertTo-Json -Compress
