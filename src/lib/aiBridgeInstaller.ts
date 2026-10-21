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

Codex puede buscar en la web, ejecutar comandos y leer o modificar archivos
accesibles para el usuario de Windows, sin aprobacion por accion. Usa el Bridge
solo en una PC de confianza.

Este ZIP incluye una credencial privada de este negocio. No lo compartas.
Despues de extraerlo, elimina el ZIP y conserva la carpeta extraida. Puedes
revocar la conexion desde RivaStock > IA cuando quieras.
`;

const WINDOWS_UPDATER_LAUNCHER = String.raw`@echo off
setlocal
title Actualizador de RivaStock AI Bridge
set "RIVASTOCK_PACKAGE_URL=__PACKAGE_URL__"
set "RIVASTOCK_UPDATER_URL=__UPDATER_URL__"
set "RIVASTOCK_DEVICE_ID=__DEVICE_ID__"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -Command "$ErrorActionPreference='Stop'; $download=Join-Path $env:TEMP ('rivastock-ai-bridge-update-' + [guid]::NewGuid().ToString('N') + '.download'); $launcherScript=Join-Path $env:TEMP ('rivastock-ai-bridge-update-' + [guid]::NewGuid().ToString('N') + '.ps1'); try { Invoke-WebRequest -Uri $env:RIVASTOCK_UPDATER_URL -OutFile $download -UseBasicParsing; $source=[IO.File]::ReadAllText($download,[Text.Encoding]::UTF8); [IO.File]::WriteAllText($launcherScript,$source,[Text.Encoding]::Unicode); & $launcherScript -PackageUrl $env:RIVASTOCK_PACKAGE_URL -DeviceId $env:RIVASTOCK_DEVICE_ID } finally { Remove-Item -LiteralPath $download,$launcherScript -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 pause
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

export function createAIBridgeWindowsUpdater(packageUrl: string, deviceId: string | null): Uint8Array {
  const url = new URL(packageUrl);
  const isLocalHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocalHttp) throw new Error('La URL de actualización no es segura.');
  if (url.pathname !== '/downloads/rivastock-ai-bridge-latest.tgz') throw new Error('La URL del paquete de actualización no es válida.');

  const updaterUrl = new URL('/downloads/rivastock-ai-bridge-updater.ps1', url.origin);
  if (deviceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    throw new Error('El identificador de la PC vinculada no es válido.');
  }

  const launcher = WINDOWS_UPDATER_LAUNCHER
    .replace('__PACKAGE_URL__', url.toString())
    .replace('__UPDATER_URL__', updaterUrl.toString())
    .replace('__DEVICE_ID__', deviceId ?? '');
  return strToU8(launcher);
}
