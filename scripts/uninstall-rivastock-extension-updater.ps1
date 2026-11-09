Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskName = 'RivaStock Extension Updater'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
Write-Host 'Se quitó la tarea programada. La extensión y sus archivos siguen instalados.'
