import { strToU8, zipSync } from 'fflate';

interface InstallerPairing {
  endpoint: string;
  pairingCode: string;
  deviceId: string;
}

const ACTIVATION_SCRIPT = String.raw`import { readFile } from 'node:fs/promises';

const lines = (await readFile(new URL('./.env', import.meta.url), 'utf8'))
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#'));
const config = Object.fromEntries(lines.map((line) => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));

try {
  const response = await fetch(config.AI_BRIDGE_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + config.AI_BRIDGE_TOKEN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: 'worker_heartbeat',
      worker_id: config.AI_BRIDGE_WORKER_ID,
      state: 'idle',
    }),
  });

  if (response.status === 401) {
    throw new Error('El vínculo venció. Generá otro instalador desde RivaStock.');
  }
  if (!response.ok) throw new Error('No se pudo activar el vínculo con RivaStock.');
  process.stdout.write('Conexión con RivaStock activada.\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'No se pudo activar el vínculo.') + '\n');
  process.exitCode = 1;
}`;

const WINDOWS_LAUNCHER = String.raw`@echo off
setlocal
cd /d "%~dp0"
title RivaStock AI Bridge
echo.
echo RivaStock AI Bridge
echo ===================
echo.

where node >nul 2>nul
if errorlevel 1 goto node_missing
node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 20 || (major === 20 && minor < 6)) process.exit(1)"
if errorlevel 1 goto node_old

node activate.mjs
if errorlevel 1 goto setup_failed

if not exist "package\package.json" (
  echo Descargando los componentes del Bridge...
  tar -xzf "rivastock-ai-bridge-latest.tgz"
  if errorlevel 1 goto setup_failed
)
copy /Y ".env" "package\.env" >nul
pushd package

if not exist "node_modules\.bin\tsx.cmd" (
  echo Instalando el Bridge. Esto puede tardar unos minutos...
  call npm install
  if errorlevel 1 goto package_failed
)

set "CODEX_HOME=%USERPROFILE%\.rivastock-ai-bridge\codex"
if not exist "%CODEX_HOME%" (
  mkdir "%CODEX_HOME%" >nul 2>nul
  if errorlevel 1 goto codex_home_failed
)
call node_modules\.bin\codex.cmd login status >nul 2>&1
if errorlevel 1 (
  echo Se va a abrir el navegador para iniciar sesion en Codex.
  call node_modules\.bin\codex.cmd login
  if errorlevel 1 goto package_failed
)

echo.
echo AI Bridge conectado. Deja esta ventana abierta mientras uses RivaStock.
echo Para desconectarlo, cerra esta ventana.
echo.
call npm start
popd
pause
exit /b 0

:node_missing
echo Falta Node.js 20.6 o posterior. Se abrira la pagina oficial para instalarlo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:node_old
echo Node.js 20.6 o posterior es necesario. Actualizalo y vuelve a abrir este instalador.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:setup_failed
echo No se pudo preparar la conexion. Genera un instalador nuevo desde RivaStock y vuelve a intentar.
pause
exit /b 1

:package_failed
popd
echo La instalacion no se completo. Revisa la conexion a Internet y vuelve a ejecutar este archivo.
pause
exit /b 1

:codex_home_failed
popd
echo No se pudo crear la carpeta de datos de Codex: "%CODEX_HOME%".
pause
exit /b 1`;

const INSTALLER_README = `INSTALADOR DE RIVASTOCK AI BRIDGE (WINDOWS)

1. Extrae esta carpeta.
2. Abre "Iniciar RivaStock AI Bridge.bat".
3. Si Codex lo solicita, inicia sesion con la cuenta de este negocio en el navegador.
4. Deja la ventana abierta mientras uses la IA en RivaStock.

El instalador verifica el vinculo, instala el Bridge y Codex CLI, y lo inicia.
Requiere Windows, Internet y Node.js 20.6 o posterior. Si Node.js falta, abre
su pagina oficial para instalarlo; despues, vuelve a abrir el instalador.

Este ZIP incluye una credencial privada de este negocio. No lo compartas.
Despues de extraerlo, elimina el ZIP y conserva la carpeta extraida. Puedes
revocar la conexion desde RivaStock > IA cuando quieras.
`;

const WINDOWS_UPDATER_LAUNCHER = String.raw`@echo off
setlocal
title Actualizador de RivaStock AI Bridge
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Actualizar RivaStock AI Bridge.ps1" -PackageUrl "__PACKAGE_URL__"
if errorlevel 1 pause
`;

const WINDOWS_UPDATER_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)]
  [string]$PackageUrl
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

function Show-Message([string]$Message, [string]$Title, $Buttons, $Icon) {
  [System.Windows.Forms.MessageBox]::Show($Message, $Title, $Buttons, $Icon) | Out-Null
}

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Elegí la carpeta donde está instalado RivaStock AI Bridge (debe contener .env y package).'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }

$installDirectory = $dialog.SelectedPath
$configPath = Join-Path $installDirectory '.env'
$packageDirectory = Join-Path $installDirectory 'package'
$packageManifestPath = Join-Path $packageDirectory 'package.json'
if (!(Test-Path -LiteralPath $configPath -PathType Leaf) -or !(Test-Path -LiteralPath $packageManifestPath -PathType Leaf)) {
  Show-Message 'La carpeta elegida no parece ser una instalación de RivaStock AI Bridge. Elegí la carpeta que contiene .env y package.' 'No se encontró la instalación' ([System.Windows.Forms.MessageBoxButtons]::OK) ([System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}

$confirmation = [System.Windows.Forms.MessageBox]::Show(
  'Antes de continuar, cerrá la ventana donde está corriendo AI Bridge. La actualización conserva el vínculo, el inicio de sesión y las sesiones locales. ¿La ventana está cerrada?',
  'Actualizar RivaStock AI Bridge',
  [System.Windows.Forms.MessageBoxButtons]::YesNo,
  [System.Windows.Forms.MessageBoxIcon]::Information
)
if ($confirmation -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }

$uri = [uri]$PackageUrl
if (($uri.Scheme -ne 'https' -and !($uri.Scheme -eq 'http' -and $uri.IsLoopback)) -or $uri.AbsolutePath -ne '/downloads/rivastock-ai-bridge-latest.tgz') {
  throw 'La dirección del paquete de actualización no es válida.'
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
  if ($LASTEXITCODE -ne 0 -or !$entries -or $invalidEntry) {
    throw 'El paquete descargado no tiene un formato válido.'
  }
  & $tar.Source -xzf $archivePath -C $extractDirectory
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo extraer la actualización.' }

  $newPackageDirectory = Join-Path $extractDirectory 'package'
  $newManifestPath = Join-Path $newPackageDirectory 'package.json'
  if (!(Test-Path -LiteralPath $newManifestPath -PathType Leaf)) { throw 'El paquete descargado está incompleto.' }
  $manifest = Get-Content -LiteralPath $newManifestPath -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'rivastock-ai-bridge') { throw 'El paquete descargado no corresponde a RivaStock AI Bridge.' }

  Get-ChildItem -LiteralPath $newPackageDirectory -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $packageDirectory -Recurse -Force
  }
  Copy-Item -LiteralPath $configPath -Destination (Join-Path $packageDirectory '.env') -Force

  Push-Location $packageDirectory
  try {
    Write-Host ('Instalando AI Bridge ' + $manifest.version + '...')
    & $npm.Source install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
    Write-Host 'Actualización lista. AI Bridge queda iniciado en esta ventana.'
    & $npm.Source start
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
`;

const UPDATER_README = `ACTUALIZADOR DE RIVASTOCK AI BRIDGE (WINDOWS)

1. Cierra la ventana donde está corriendo AI Bridge.
2. Abre "Actualizar RivaStock AI Bridge.bat".
3. Selecciona la carpeta de la instalación existente; debe contener .env y package.
4. Deja abierta la ventana del actualizador: instalará la versión nueva y arrancará el Bridge.

Este proceso conserva el vínculo, la sesión de Codex y las sesiones locales. No genera un código nuevo ni cambia la PC vinculada.
Requiere Windows, Internet y Node.js 20.6 o posterior.
`;

export async function createAIBridgeWindowsInstaller(pairing: InstallerPairing): Promise<Uint8Array> {
  const response = await fetch('/downloads/rivastock-ai-bridge-latest.tgz', { cache: 'no-store' });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('application/octet-stream')) {
    throw new Error('No se pudo descargar el Bridge. Actualiza RivaStock e intenta de nuevo.');
  }

  const workerArchive = new Uint8Array(await response.arrayBuffer());
  const configuration = [
    `AI_BRIDGE_ENDPOINT=${pairing.endpoint}`,
    `AI_BRIDGE_TOKEN=${pairing.pairingCode}`,
    `AI_BRIDGE_WORKER_ID=${pairing.deviceId}`,
    'AI_BRIDGE_ENABLE_CODEX=true',
  ].join('\n') + '\n';

  return zipSync({
    'RivaStock AI Bridge/.env': strToU8(configuration),
    'RivaStock AI Bridge/LEEME.txt': strToU8(INSTALLER_README),
    'RivaStock AI Bridge/activate.mjs': strToU8(ACTIVATION_SCRIPT),
    'RivaStock AI Bridge/Iniciar RivaStock AI Bridge.bat': strToU8(WINDOWS_LAUNCHER),
    'RivaStock AI Bridge/rivastock-ai-bridge-latest.tgz': workerArchive,
  }, { level: 6 });
}

export function createAIBridgeWindowsUpdater(packageUrl: string): Uint8Array {
  const url = new URL(packageUrl);
  const isLocalHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocalHttp) throw new Error('La URL de actualización no es segura.');
  if (url.pathname !== '/downloads/rivastock-ai-bridge-latest.tgz') throw new Error('La URL del paquete de actualización no es válida.');

  const launcher = WINDOWS_UPDATER_LAUNCHER.replace('__PACKAGE_URL__', url.toString());
  return zipSync({
    'Actualizar RivaStock AI Bridge.bat': strToU8(launcher),
    'Actualizar RivaStock AI Bridge.ps1': strToU8(WINDOWS_UPDATER_SCRIPT),
    'LEEME.txt': strToU8(UPDATER_README),
  }, { level: 6 });
}
