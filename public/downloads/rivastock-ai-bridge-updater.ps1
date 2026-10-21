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

function Read-WorkerId([string]$ConfigPath) {
  $match = [regex]::Match((Get-Content -LiteralPath $ConfigPath -Raw), '(?m)^\s*AI_BRIDGE_WORKER_ID\s*=\s*([^\r\n#]+)')
  if (!$match.Success) { return '' }
  return $match.Groups[1].Value.Trim()
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

  $lockDirectory = Join-Path $env:USERPROFILE '.rivastock-ai-bridge\worker.lock'
  while (Test-Path -LiteralPath $lockDirectory -PathType Container) {
    $choice = [System.Windows.Forms.MessageBox]::Show(
      'AI Bridge sigue abierto. Cerrá su ventana y elegí Reintentar para continuar con la actualización.',
      'Cerrá AI Bridge',
      [System.Windows.Forms.MessageBoxButtons]::RetryCancel,
      [System.Windows.Forms.MessageBoxIcon]::Information
    )
    if ($choice -ne [System.Windows.Forms.DialogResult]::Retry) { exit 1 }
    Start-Sleep -Milliseconds 750
  }

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
  Show-Message $_.Exception.Message 'No se pudo actualizar RivaStock AI Bridge' ([System.Windows.Forms.MessageBoxButtons]::OK) ([System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}
