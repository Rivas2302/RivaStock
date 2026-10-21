param([switch]$InstallStartup)

$ErrorActionPreference = 'Stop'
$packageDirectory = Resolve-Path (Join-Path $PSScriptRoot '..')
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$node) { throw 'No encontré Node.js en PATH.' }
$launcherPath = Join-Path $PSScriptRoot 'start-background.mjs'
if (!(Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw 'Falta el iniciador en segundo plano del AI Bridge.' }

if ($InstallStartup) {
  $startupDirectory = [Environment]::GetFolderPath('Startup')
  if (!$startupDirectory) { throw 'No pude encontrar la carpeta de inicio de Windows.' }
  New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null

  $powershellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (!(Test-Path -LiteralPath $powershellPath -PathType Leaf)) { throw 'No encontré Windows PowerShell para configurar el inicio automático.' }
  $shortcutPath = Join-Path $startupDirectory 'RivaStock AI Bridge.lnk'
  $shortcutArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
  $shell = $null
  $shortcut = $null
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershellPath
    $shortcut.Arguments = $shortcutArguments
    $shortcut.WorkingDirectory = $packageDirectory.Path
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Starts RivaStock AI Bridge in the background when you sign in.'
    $shortcut.Save()
  } catch {
    Write-Warning ('No pude configurar el inicio automatico: ' + $_.Exception.Message)
  } finally {
    if ($shortcut) { [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null }
    if ($shell) { [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null }
  }
}

& $node.Source $launcherPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el AI Bridge en segundo plano.' }
