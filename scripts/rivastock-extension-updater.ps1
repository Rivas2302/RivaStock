param([switch]$Simulation)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RivaStockRoot = Join-Path $env:LOCALAPPDATA 'RivaStock'
$script:ExpectedExtensionId = 'iplfoimfiigmoaihampblmibohekbbkj'
$script:ReleaseManifestUri = [Uri]'https://rivastock.vercel.app/downloads/extension-version.json'
$script:MaxManifestBytes = 128KB
$script:MaxArchiveBytes = 25MB
$script:MaxExpandedBytes = 40MB
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-RivaStockOwnedPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'path-invalid' }
  $root = [IO.Path]::GetFullPath($script:RivaStockRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $full = [IO.Path]::GetFullPath($Path)
  $prefix = $root + [IO.Path]::DirectorySeparatorChar
  if ($full -ne $root -and -not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'path-outside-rivastock' }
  return $full
}

function Assert-RivaStockNoReparsePath([string]$Path) {
  $safePath = Get-RivaStockOwnedPath $Path
  $root = [IO.Path]::GetFullPath($script:RivaStockRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $relative = $safePath.Substring($root.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $current = $root
  foreach ($segment in @($relative -split '[\\/]')) {
    if ([string]::IsNullOrEmpty($segment)) { continue }
    $current = Join-Path $current $segment
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse-point-rejected' }
    }
  }
  return $safePath
}

function Remove-RivaStockOwnedPath([string]$Path) {
  $safePath = Assert-RivaStockNoReparsePath $Path
  if (Test-Path -LiteralPath $safePath) {
    $item = Get-Item -LiteralPath $safePath -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse-point-rejected' }
    if ($item.PSIsContainer) { Remove-Item -LiteralPath $safePath -Recurse -Force }
    else { Remove-Item -LiteralPath $safePath -Force }
  }
}

function Test-RivaStockVersionNewer([string]$Candidate, [string]$Current) {
  if ($Candidate -notmatch '^\d+\.\d+\.\d+$' -or $Current -notmatch '^\d+\.\d+\.\d+$') { return $false }
  $left = @($Candidate.Split('.') | ForEach-Object { [int]$_ })
  $right = @($Current.Split('.') | ForEach-Object { [int]$_ })
  for ($index = 0; $index -lt 3; $index++) {
    if ($left[$index] -ne $right[$index]) { return $left[$index] -gt $right[$index] }
  }
  return $false
}

function Get-ExtensionIdFromKey([string]$Key) {
  if ([string]::IsNullOrWhiteSpace($Key)) { throw 'extension-key-missing' }
  try { $bytes = [Convert]::FromBase64String($Key) } catch { throw 'extension-key-invalid' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $digest = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
  $id = [Text.StringBuilder]::new()
  for ($index = 0; $index -lt 16; $index++) {
    [void]$id.Append([char](97 + ($digest[$index] -shr 4)))
    [void]$id.Append([char](97 + ($digest[$index] -band 15)))
  }
  return $id.ToString()
}

function Assert-RivaStockHttpsUrl([Uri]$Uri, [string]$ExpectedPath) {
  if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne 'https' -or $Uri.Host -ne 'rivastock.vercel.app' -or
    $Uri.Port -ne 443 -or $Uri.UserInfo -or $Uri.Fragment -or $Uri.Query -or
    ($ExpectedPath -and $Uri.AbsolutePath -ne $ExpectedPath)) { throw 'release-url-rejected' }
}

function Get-TrustedRivaStockBytes([Uri]$Uri, [int]$MaxBytes, [string]$ExpectedPath) {
  Assert-RivaStockHttpsUrl $Uri $ExpectedPath
  $request = [Net.HttpWebRequest]::Create($Uri)
  $request.Method = 'GET'
  $request.AllowAutoRedirect = $false
  $request.UseDefaultCredentials = $false
  $request.Credentials = $null
  $request.CookieContainer = $null
  $request.Timeout = 30000
  $request.ReadWriteTimeout = 30000
  $request.UserAgent = 'RivaStock-Extension-Updater/1'
  $response = $null
  try { $response = $request.GetResponse() }
  catch { throw 'release-download-failed' }
  try {
    if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) { throw 'release-redirect-rejected' }
    if ([int]$response.StatusCode -ne 200) { throw 'release-download-failed' }
    if ($response.ContentLength -gt $MaxBytes) { throw 'release-size-limit' }
    $inputStream = $response.GetResponseStream()
    $memory = [IO.MemoryStream]::new()
    $buffer = New-Object byte[] 8192
    try {
      while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        if (($memory.Length + $read) -gt $MaxBytes) { throw 'release-size-limit' }
        $memory.Write($buffer, 0, $read)
      }
      return $memory.ToArray()
    } finally { $memory.Dispose(); $inputStream.Dispose() }
  } finally { $response.Dispose() }
}

function Get-Sha256Hex([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Write-RivaStockAtomicFile([string]$Path, [byte[]]$Bytes) {
  $safePath = Assert-RivaStockNoReparsePath $Path
  $parent = Split-Path -Parent $safePath
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $tempPath = Get-RivaStockOwnedPath ($safePath + '.new-' + [Guid]::NewGuid().ToString('N'))
  $backupPath = Get-RivaStockOwnedPath ($safePath + '.previous-' + [Guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllBytes($tempPath, $Bytes)
    if (Test-Path -LiteralPath $safePath) { [IO.File]::Replace($tempPath, $safePath, $backupPath) }
    else { [IO.File]::Move($tempPath, $safePath) }
  } finally {
    if (Test-Path -LiteralPath $tempPath) { Remove-RivaStockOwnedPath $tempPath }
    if (Test-Path -LiteralPath $backupPath) { try { Remove-RivaStockOwnedPath $backupPath } catch { } }
  }
}

function Test-ReleaseFileList($Release) {
  if (-not ($Release.files -is [System.Array]) -or $Release.files.Count -lt 2 -or $Release.files.Count -gt 100) { throw 'release-files-invalid' }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($name in $Release.files) {
    if (-not ($name -is [string]) -or $name -match '(^/|\\|:|(^|/)\.\.?(/|$)|[\x00-\x1f])' -or $name -notmatch '^[A-Za-z0-9._/-]+$') { throw 'release-files-invalid' }
    if (-not $seen.Add($name)) { throw 'release-files-invalid' }
  }
  if (-not $seen.Contains('manifest.json') -or -not $seen.Contains('worker.js')) { throw 'release-files-invalid' }
  return @($Release.files)
}

function Expand-VerifiedArchive([string]$ArchivePath, [string]$StagePath, [string[]]$ExpectedFiles) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead((Get-RivaStockOwnedPath $ArchivePath))
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $totalLength = 0L
  try {
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName
      if ([string]::IsNullOrWhiteSpace($name) -or $entry.Name -eq '' -or $name -match '(^/|\\|:|(^|/)\.\.?(/|$)|[\x00-\x1f])' -or
        $name -notmatch '^[A-Za-z0-9._/-]+$' -or -not $seen.Add($name)) { throw 'archive-entry-invalid' }
      if ($entry.Length -gt $script:MaxExpandedBytes) { throw 'archive-size-limit' }
      $totalLength += $entry.Length
      if ($totalLength -gt $script:MaxExpandedBytes) { throw 'archive-size-limit' }
    }
    if ($seen.Count -ne $ExpectedFiles.Count) { throw 'archive-file-set-mismatch' }
    foreach ($expected in $ExpectedFiles) { if (-not $seen.Contains($expected)) { throw 'archive-file-set-mismatch' } }

    $stage = Get-RivaStockOwnedPath $StagePath
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    foreach ($entry in $archive.Entries) {
      $relative = $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)
      $destination = Get-RivaStockOwnedPath (Join-Path $stage $relative)
      $stagePrefix = $stage.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $destination.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'archive-entry-invalid' }
      $parent = Split-Path -Parent $destination
      if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
      $source = $entry.Open()
      $target = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try { $source.CopyTo($target) } finally { $target.Dispose(); $source.Dispose() }
      if ((Get-Item -LiteralPath $destination).Length -ne $entry.Length) { throw 'archive-entry-invalid' }
    }
  } finally { $archive.Dispose() }
}

function Restore-RivaStockDirectory([string]$TargetPath, [string]$BackupPath, [string[]]$PackageFiles) {
  $target = Get-RivaStockOwnedPath $TargetPath
  $backup = Get-RivaStockOwnedPath $BackupPath
  $backupFiles = @{}
  if (Test-Path -LiteralPath $backup) {
    Get-ChildItem -LiteralPath $backup -File -Recurse | ForEach-Object {
      $relative = $_.FullName.Substring($backup.Length + 1).Replace([IO.Path]::DirectorySeparatorChar, '/')
      $backupFiles[$relative] = $_.FullName
    }
  }
  if (Test-Path -LiteralPath $target) {
    Get-ChildItem -LiteralPath $target -File -Recurse | ForEach-Object {
      $relative = $_.FullName.Substring($target.Length + 1).Replace([IO.Path]::DirectorySeparatorChar, '/')
      if (-not $backupFiles.ContainsKey($relative)) { Remove-RivaStockOwnedPath $_.FullName }
    }
  }
  foreach ($relative in $backupFiles.Keys) {
    $destination = Join-Path $target ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
    Write-RivaStockAtomicFile $destination ([IO.File]::ReadAllBytes($backupFiles[$relative]))
  }
}

function Install-VerifiedExtensionArchive(
  [string]$ArchivePath,
  [string]$ExtensionPath,
  [string]$ReleaseVersion,
  [string]$ExpectedSha256,
  [string[]]$ExpectedFiles
) {
  $archive = Get-RivaStockOwnedPath $ArchivePath
  $target = Get-RivaStockOwnedPath $ExtensionPath
  if ($ReleaseVersion -notmatch '^\d+\.\d+\.\d+$' -or $ExpectedSha256 -notmatch '^[a-f0-9]{64}$') { throw 'release-manifest-invalid' }
  if ((Get-Sha256Hex ([IO.File]::ReadAllBytes($archive))) -ne $ExpectedSha256) { throw 'checksum-mismatch' }
  $stage = Join-Path $script:RivaStockRoot ('.stage-' + [Guid]::NewGuid().ToString('N'))
  $backup = Join-Path $script:RivaStockRoot ('.backup-' + [Guid]::NewGuid().ToString('N'))
  $hadTarget = Test-Path -LiteralPath $target
  $commitComplete = $false
  try {
    Expand-VerifiedArchive $archive $stage $ExpectedFiles
    $stagedManifestPath = Join-Path $stage 'manifest.json'
    $stagedManifest = Get-Content -Raw -LiteralPath $stagedManifestPath | ConvertFrom-Json
    if ($stagedManifest.name -ne 'RivaStock' -or $stagedManifest.version -ne $ReleaseVersion -or
      (Get-ExtensionIdFromKey $stagedManifest.key) -ne $script:ExpectedExtensionId) { throw 'staged-manifest-invalid' }
    $installedManifestPath = Join-Path $target 'manifest.json'
    if (Test-Path -LiteralPath $installedManifestPath) {
      $installedManifest = Get-Content -Raw -LiteralPath $installedManifestPath | ConvertFrom-Json
      if ((Get-ExtensionIdFromKey $installedManifest.key) -ne $script:ExpectedExtensionId) { throw 'installed-extension-id-mismatch' }
      if (-not (Test-RivaStockVersionNewer $ReleaseVersion $installedManifest.version)) { throw 'release-not-newer' }
      if ($installedManifest.key -ne $stagedManifest.key) { throw 'extension-key-changed' }
    }

    if ($hadTarget) {
      Assert-RivaStockNoReparsePath $target | Out-Null
      if (Get-ChildItem -LiteralPath $target -Force -Recurse | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }) { throw 'reparse-point-rejected' }
      Copy-Item -LiteralPath $target -Destination $backup -Recurse -Force
    } else { New-Item -ItemType Directory -Path $target -Force | Out-Null }

    $orderedFiles = @($ExpectedFiles | Where-Object { $_ -ne 'manifest.json' }) + @('manifest.json')
    foreach ($relative in $orderedFiles) {
      $source = Join-Path $stage ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
      $destination = Join-Path $target ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
      Write-RivaStockAtomicFile $destination ([IO.File]::ReadAllBytes($source))
    }
    $commitComplete = $true
    if (Test-Path -LiteralPath $backup) { try { Remove-RivaStockOwnedPath $backup } catch { } }
  } catch {
    if (-not $commitComplete) {
      try {
        if ($hadTarget -and (Test-Path -LiteralPath $backup)) { Restore-RivaStockDirectory $target $backup $ExpectedFiles }
        elseif (-not $hadTarget -and (Test-Path -LiteralPath $target)) { Remove-RivaStockOwnedPath $target }
      } catch { throw 'atomic-rollback-failed' }
    }
    throw
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-RivaStockOwnedPath $stage }
    if (Test-Path -LiteralPath $archive) { Remove-RivaStockOwnedPath $archive }
  }
}

function Write-RivaStockUpdaterLog([string]$Message) {
  if (-not (Test-Path -LiteralPath $script:RivaStockRoot)) { New-Item -ItemType Directory -Path $script:RivaStockRoot -Force | Out-Null }
  $safeMessage = if ($Message -match '^[a-z0-9.-]{1,64}$') { $Message } else { 'error' }
  $logPath = Join-Path $script:RivaStockRoot 'updater.log'
  $lines = @()
  if (Test-Path -LiteralPath $logPath) { $lines = @(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue | Select-Object -Last 39) }
  $line = '{0} {1}' -f [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'), $safeMessage
  $content = (@($lines) + $line) -join [Environment]::NewLine
  Write-RivaStockAtomicFile $logPath ([Text.UTF8Encoding]::new($false).GetBytes($content + [Environment]::NewLine))
}

function Invoke-RivaStockExtensionUpdate {
  $root = Get-RivaStockOwnedPath $script:RivaStockRoot
  if (-not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
  $extensionPath = Join-Path $root 'extension'
  $installedVersion = '0.0.0'
  $installedManifestPath = Join-Path $extensionPath 'manifest.json'
  if (Test-Path -LiteralPath $installedManifestPath) {
    try { $installedVersion = (Get-Content -Raw -LiteralPath $installedManifestPath | ConvertFrom-Json).version }
    catch { throw 'installed-manifest-invalid' }
  }

  $manifestBytes = Get-TrustedRivaStockBytes $script:ReleaseManifestUri $script:MaxManifestBytes '/downloads/extension-version.json'
  try { $release = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json }
  catch { throw 'release-manifest-invalid' }
  if ($release.version -notmatch '^\d+\.\d+\.\d+$' -or $release.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'release-manifest-invalid' }
  $zipUri = $null
  try { $zipUri = [Uri]$release.url } catch { throw 'release-url-rejected' }
  Assert-RivaStockHttpsUrl $zipUri '/downloads/rivastock-facebook.zip'
  $expectedFiles = Test-ReleaseFileList $release
  if (-not (Test-RivaStockVersionNewer $release.version $installedVersion)) {
    Write-RivaStockUpdaterLog ('current-' + $installedVersion)
    return
  }

  $archiveBytes = Get-TrustedRivaStockBytes $zipUri $script:MaxArchiveBytes '/downloads/rivastock-facebook.zip'
  if ((Get-Sha256Hex $archiveBytes) -ne $release.sha256) { throw 'checksum-mismatch' }
  $archivePath = Join-Path $root ('.download-' + [Guid]::NewGuid().ToString('N') + '.zip')
  [IO.File]::WriteAllBytes((Get-RivaStockOwnedPath $archivePath), $archiveBytes)
  Install-VerifiedExtensionArchive $archivePath $extensionPath $release.version $release.sha256 $expectedFiles
  Write-RivaStockUpdaterLog ('updated-' + $release.version)
}

function Invoke-RivaStockUpdaterSimulation {
  $simulationRoot = Join-Path $script:RivaStockRoot ('.simulation-' + [Guid]::NewGuid().ToString('N'))
  $extensionPath = Join-Path $simulationRoot 'extension'
  $archivePath = Join-Path $simulationRoot 'simulated-release.zip'
  $sourceManifestPath = Join-Path $PSScriptRoot '..\extensions\facebook\manifest.json'
  $sourceManifest = Get-Content -Raw -LiteralPath $sourceManifestPath | ConvertFrom-Json
  $parts = @($sourceManifest.version.Split('.') | ForEach-Object { [int]$_ })
  $nextVersion = '{0}.{1}.{2}' -f $parts[0], $parts[1], ($parts[2] + 1)
  $files = @('manifest.json', 'worker.js')
  try {
    New-Item -ItemType Directory -Path $extensionPath -Force | Out-Null
    $oldManifest = @{ name = 'RivaStock'; version = $sourceManifest.version; key = $sourceManifest.key } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $extensionPath 'manifest.json'), $oldManifest, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $extensionPath 'worker.js'), 'simulation-old', [Text.UTF8Encoding]::new($false))

    $newManifest = @{ name = 'RivaStock'; version = $nextVersion; key = $sourceManifest.key } | ConvertTo-Json -Compress
    $stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
      $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
      try {
        foreach ($entry in @(@{ Name='manifest.json'; Text=$newManifest }, @{ Name='worker.js'; Text='simulation-new-' + $nextVersion })) {
          $zipEntry = $zip.CreateEntry($entry.Name, [IO.Compression.CompressionLevel]::Optimal)
          $entryStream = $zipEntry.Open()
          $bytes = [Text.UTF8Encoding]::new($false).GetBytes($entry.Text)
          try { $entryStream.Write($bytes, 0, $bytes.Length) } finally { $entryStream.Dispose() }
        }
      } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }

    $releaseHash = Get-Sha256Hex ([IO.File]::ReadAllBytes($archivePath))
    Install-VerifiedExtensionArchive $archivePath $extensionPath $nextVersion $releaseHash $files
    $resultManifest = Get-Content -Raw -LiteralPath (Join-Path $extensionPath 'manifest.json') | ConvertFrom-Json
    $worker = Get-Content -Raw -LiteralPath (Join-Path $extensionPath 'worker.js')
    if ($resultManifest.version -ne $nextVersion -or $worker -ne ('simulation-new-' + $nextVersion) -or
      (Get-ExtensionIdFromKey $resultManifest.key) -ne $script:ExpectedExtensionId) { throw 'simulation-verification-failed' }
    Write-Output ('PASS simulated atomic update to ' + $nextVersion + '; extension ID preserved')
  } finally {
    if (Test-Path -LiteralPath $simulationRoot) { Remove-RivaStockOwnedPath $simulationRoot }
  }
}

if ($Simulation) {
  Invoke-RivaStockUpdaterSimulation
} else {
  try { Invoke-RivaStockExtensionUpdate }
  catch {
    $code = if ($_.Exception.Message -match '^[a-z0-9.-]{1,64}$') { $_.Exception.Message } else { 'error' }
    try { Write-RivaStockUpdaterLog $code } catch { }
  }
}
