param(
  [Parameter(Mandatory = $true)]
  [string]$PackageUrl,
  [string]$DeviceId = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

function Show-Message([string]$Message, [string]$Title, $Buttons, $Icon) {
  [System.Windows.Forms.MessageBox]::Show($Message, $Title, $Buttons, $Icon) | Out-Null
}

function Read-ConfigValue([string]$ConfigPath, [string]$Name) {
  $match = [regex]::Match((Get-Content -LiteralPath $ConfigPath -Raw), '(?m)^\s*' + [regex]::Escape($Name) + '\s*=\s*([^\r\n#]+)')
  if (!$match.Success) { return '' }
  return $match.Groups[1].Value.Trim()
}

function Invoke-BridgeAction([string]$Endpoint, [string]$Token, [string]$Action, [string]$WorkerId) {
  $body = @{ action = $Action; worker_id = $WorkerId } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri $Endpoint -Method Post -Headers @{ Authorization = "Bearer $Token" } `
    -ContentType 'application/json' -Body $body -TimeoutSec 20
}

function Stop-BridgeConsole {
  $workers = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -ieq 'node.exe' -and $_.CommandLine -match '(?i)(^|\s)--env-file=\.env(\s|$)' `
      -and $_.CommandLine -match '(?i)(^|\s)--import\s+tsx(\s|$)' `
      -and $_.CommandLine -match '(?i)(^|\s)src/index\.ts(\s|$)'
  })
  if ($workers.Count -ne 1) { throw 'No pude identificar de forma segura la ventana del AI Bridge.' }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RivaStockBridgeConsole {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GenerateConsoleCtrlEvent(uint eventType, uint processGroupId);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetConsoleTitle(StringBuilder title, uint size);
  public static string ReadTitle() {
    var title = new StringBuilder(512);
    GetConsoleTitle(title, (uint)title.Capacity);
    return title.ToString();
  }
}
'@

  $processId = [uint32]$workers[0].ProcessId
  [RivaStockBridgeConsole]::FreeConsole() | Out-Null
  if (![RivaStockBridgeConsole]::AttachConsole($processId)) { throw 'No pude conectar con la ventana del AI Bridge.' }
  $consoleWindow = [RivaStockBridgeConsole]::GetConsoleWindow()
  try {
    [RivaStockBridgeConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
    $title = [RivaStockBridgeConsole]::ReadTitle()
    if (!$title.StartsWith('RivaStock AI Bridge', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'La ventana encontrada no corresponde al AI Bridge.'
    }
    if (![RivaStockBridgeConsole]::GenerateConsoleCtrlEvent(0, 0)) {
      throw 'Windows no pudo cerrar el AI Bridge de forma segura.'
    }
  } finally {
    [RivaStockBridgeConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) | Out-Null
    [RivaStockBridgeConsole]::FreeConsole() | Out-Null
  }
  return $consoleWindow
}

function Get-InstallCandidates([string]$ExpectedDeviceId) {
  if (!$ExpectedDeviceId) { return @() }
  $roots = @(
    (Join-Path $env:USERPROFILE 'Downloads'),
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:USERPROFILE 'Documents'),
    (Join-Path $env:LOCALAPPDATA 'RivaStock'),
    (Join-Path $env:APPDATA 'RivaStock')
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $candidates = [System.Collections.Generic.List[object]]::new()
  foreach ($root in $roots) {
    $directories = @((Get-Item -LiteralPath $root))
    $directories += Get-ChildItem -LiteralPath $root -Directory -Force -Recurse -Depth 5 -ErrorAction SilentlyContinue
    foreach ($directory in $directories) {
      if (!$seen.Add($directory.FullName)) { continue }
      $configPath = Join-Path $directory.FullName '.env'
      $manifestPath = Join-Path $directory.FullName 'package\package.json'
      if (!(Test-Path -LiteralPath $configPath -PathType Leaf) -or !(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { continue }
      if ($ExpectedDeviceId -and (Read-WorkerId $configPath) -ne $ExpectedDeviceId) { continue }
      try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.name -ne 'rivastock-ai-bridge') { continue }
        $version = [version]$manifest.version
        $candidates.Add([pscustomobject]@{
          Directory = $directory.FullName
          Version = $version
          LastWriteTime = (Get-Item -LiteralPath $manifestPath).LastWriteTime
        })
      } catch {
        continue
      }
    }
  }
  return $candidates
}

function Select-InstallDirectory([string]$ExpectedDeviceId) {
  $candidates = @(Get-InstallCandidates $ExpectedDeviceId)
  if ($candidates.Count -gt 0) {
    $selected = $candidates | Sort-Object `
      @{ Expression = { $_.Version }; Descending = $true }, `
      @{ Expression = { $_.LastWriteTime }; Descending = $true } | Select-Object -First 1
    Write-Host ('Instalación encontrada: ' + $selected.Directory)
    Write-Host ('Versión instalada: ' + $selected.Version)
    return $selected.Directory
  }

  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'No encontré automáticamente la instalación vinculada. Elegí la carpeta que contiene .env y package.'
  $dialog.ShowNewFolderButton = $false
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }

  $directory = $dialog.SelectedPath
  $configPath = Join-Path $directory '.env'
  $manifestPath = Join-Path $directory 'package\package.json'
  if (!(Test-Path -LiteralPath $configPath -PathType Leaf) -or !(Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'La carpeta elegida no parece una instalación de RivaStock AI Bridge.'
  }
  if ($ExpectedDeviceId -and (Read-WorkerId $configPath) -ne $ExpectedDeviceId) {
    throw 'La instalación elegida no corresponde a la PC vinculada en RivaStock.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'rivastock-ai-bridge') { throw 'La carpeta elegida no contiene RivaStock AI Bridge.' }
  return $directory
}

try {
  $uri = [uri]$PackageUrl
  if (($uri.Scheme -ne 'https' -and !($uri.Scheme -eq 'http' -and $uri.IsLoopback)) -or
    $uri.AbsolutePath -ne '/downloads/rivastock-ai-bridge-latest.tgz') {
    throw 'La dirección del paquete de actualización no es válida.'
  }
  if ($DeviceId -and $DeviceId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw 'El identificador de la PC vinculada no es válido.'
  }

  $installDirectory = Select-InstallDirectory $DeviceId
  if (!$installDirectory) { exit 0 }
  $configPath = Join-Path $installDirectory '.env'
  $packageDirectory = Join-Path $installDirectory 'package'
  $workerId = Read-ConfigValue $configPath 'AI_BRIDGE_WORKER_ID'
  $workerEndpoint = Read-ConfigValue $configPath 'AI_BRIDGE_ENDPOINT'
  $workerToken = Read-ConfigValue $configPath 'AI_BRIDGE_TOKEN'
  if ($DeviceId -and $workerId -ne $DeviceId) { throw 'La instalación seleccionada no coincide con la PC vinculada.' }
  if ($workerId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or $workerToken.Length -lt 32) {
    throw 'La instalación no tiene una configuración de vínculo válida para actualizarse de forma segura.'
  }
  $endpointUri = [uri]$workerEndpoint
  if ($endpointUri.Scheme -ne 'https' -or $endpointUri.AbsolutePath -notmatch '/functions/v1/ai-bridge/?$') {
    throw 'La dirección del AI Bridge configurada no es válida.'
  }
  $workerApi = @{ Endpoint = $workerEndpoint; Token = $workerToken; WorkerId = $workerId }
  $updatePrepared = $false
  $lockDirectory = Join-Path $env:USERPROFILE '.rivastock-ai-bridge\worker.lock'

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  if (!$node -or !$npm -or !$tar) { throw 'No encontré Node.js, npm o tar. Verificá que Node.js 20.6 o posterior esté instalado.' }
  $nodeVersionText = (& $node.Source --version).Trim() -replace '^v', '' -replace '-.*$', ''
  if ($LASTEXITCODE -ne 0 -or [version]$nodeVersionText -lt [version]'20.6') { throw 'AI Bridge requiere Node.js 20.6 o posterior.' }

  $tempDirectory = Join-Path $env:TEMP ('rivastock-ai-bridge-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDirectory | Out-Null
  try {
    $archivePath = Join-Path $tempDirectory 'rivastock-ai-bridge-latest.tgz'
    $extractDirectory = Join-Path $tempDirectory 'extracted'
    New-Item -ItemType Directory -Path $extractDirectory | Out-Null
    Write-Host 'Descargando la versión actual del Bridge...'
    Invoke-WebRequest -Uri $PackageUrl -OutFile $archivePath -UseBasicParsing

    $entries = & $tar.Source -tzf $archivePath
    $invalidEntry = $entries | Where-Object { $_ -notmatch '^package(?:/|$)' -or $_ -match '(^|/)\.\.(?:/|$)' } | Select-Object -First 1
    if ($LASTEXITCODE -ne 0 -or !$entries -or $invalidEntry) { throw 'El paquete descargado no tiene un formato válido.' }
    & $tar.Source -xzf $archivePath -C $extractDirectory
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo extraer la actualización.' }

    $newPackageDirectory = Join-Path $extractDirectory 'package'
    $newManifestPath = Join-Path $newPackageDirectory 'package.json'
    if (!(Test-Path -LiteralPath $newManifestPath -PathType Leaf)) { throw 'El paquete descargado está incompleto.' }
    $newManifest = Get-Content -LiteralPath $newManifestPath -Raw | ConvertFrom-Json
    if ($newManifest.name -ne 'rivastock-ai-bridge') { throw 'El paquete descargado no corresponde a RivaStock AI Bridge.' }

    $oldManifestPath = Join-Path $packageDirectory 'package.json'
    $oldVersion = [version]'0.0'
    if (Test-Path -LiteralPath $oldManifestPath -PathType Leaf) {
      $oldManifest = Get-Content -LiteralPath $oldManifestPath -Raw | ConvertFrom-Json
      $oldVersion = [version]$oldManifest.version
    }
    $newVersion = [version]$newManifest.version
    if ($newVersion -lt $oldVersion) { throw 'El servidor ofreció una versión anterior a la que ya está instalada.' }

    if (Test-Path -LiteralPath $lockDirectory -PathType Container) {
      Write-Host 'Preparando el AI Bridge para actualizarse sin interrumpir tareas...'
      while (Test-Path -LiteralPath $lockDirectory -PathType Container) {
        $prepare = Invoke-BridgeAction $workerApi.Endpoint $workerApi.Token 'worker_update_prepare' $workerApi.WorkerId
        if ($prepare.data.ready -eq $true) {
          $updatePrepared = $true
          break
        }
        Write-Host 'Hay una tarea en curso. Espero a que termine para continuar...'
        Start-Sleep -Seconds 2
      }

      if ($updatePrepared) {
        for ($attempt = 0; $attempt -lt 12 -and (Test-Path -LiteralPath $lockDirectory -PathType Container); $attempt++) {
          Start-Sleep -Seconds 1
        }
        if (Test-Path -LiteralPath $lockDirectory -PathType Container) {
          Write-Host 'Cerrando el AI Bridge en forma segura...'
          $bridgeWindow = Stop-BridgeConsole
          for ($attempt = 0; $attempt -lt 40 -and (Test-Path -LiteralPath $lockDirectory -PathType Container); $attempt++) {
            Start-Sleep -Milliseconds 500
          }
          if (!(Test-Path -LiteralPath $lockDirectory -PathType Container) -and $bridgeWindow -ne [IntPtr]::Zero) {
            [RivaStockBridgeConsole]::PostMessage($bridgeWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
          }
        }
        if (Test-Path -LiteralPath $lockDirectory -PathType Container) {
          throw 'El AI Bridge recibió la solicitud de cierre, pero no liberó su bloqueo. Volvé a intentar la actualización.'
        }
      }
    }

    if ($newVersion -gt $oldVersion) {
      Get-ChildItem -LiteralPath $packageDirectory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin @('node_modules', '.env') } |
        Remove-Item -Recurse -Force
      Get-ChildItem -LiteralPath $newPackageDirectory -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $packageDirectory -Recurse -Force
      }
      Write-Host ('Actualizando AI Bridge a ' + $newManifest.version + '...')
    } else {
      Write-Host ('AI Bridge ya está en la versión actual ' + $newManifest.version + '.')
    }

    Copy-Item -LiteralPath $configPath -Destination (Join-Path $packageDirectory '.env') -Force
    $needsInstall = $newVersion -gt $oldVersion -or !(Test-Path -LiteralPath (Join-Path $packageDirectory 'node_modules\.bin\tsx.cmd') -PathType Leaf)
    Push-Location $packageDirectory
    try {
      if ($needsInstall) {
        Write-Host 'Instalando componentes...'
        & $npm.Source install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
      }
      $env:CODEX_HOME = Join-Path $env:USERPROFILE '.rivastock-ai-bridge\codex'
      Write-Host 'AI Bridge queda iniciado en esta ventana.'
      & $npm.Source start
      if ($LASTEXITCODE -ne 0) { throw 'AI Bridge se detuvo con un error.' }
    } finally {
      Pop-Location
    }
  } finally {
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
} catch {
  if ($updatePrepared -and $workerApi) {
    try { Invoke-BridgeAction $workerApi.Endpoint $workerApi.Token 'worker_start' $workerApi.WorkerId | Out-Null }
    catch { }
  }
  Show-Message $_.Exception.Message 'No se pudo actualizar RivaStock AI Bridge' ([System.Windows.Forms.MessageBoxButtons]::OK) ([System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}
