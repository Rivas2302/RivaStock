param(
    [switch]$Remove,
    [string]$ChromeProfileDirectory = ''
)
$ErrorActionPreference = 'Stop'
$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory 'RivaStock Facebook.lnk'
if ($Remove) {
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
    Write-Output 'Inicio automatico de RivaStock desactivado.'
    exit
}
if (-not $ChromeProfileDirectory) { throw 'Indicá -ChromeProfileDirectory con la carpeta del perfil que tiene la extensión vinculada (chrome://version, Ruta del perfil).' }
if ($ChromeProfileDirectory -and $ChromeProfileDirectory -notmatch '^[a-zA-Z0-9 _-]+$') {
    throw 'Invalid Chrome profile directory.'
}
$chromeCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chromePath = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw 'Google Chrome no esta instalado en una ruta reconocida.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $chromePath
$shortcut.Arguments = '--new-window https://www.facebook.com/marketplace/you/selling'
if ($ChromeProfileDirectory) {
    $shortcut.Arguments = '--profile-directory="' + $ChromeProfileDirectory + '" ' + $shortcut.Arguments
}
$shortcut.WorkingDirectory = Split-Path -Parent $chromePath
$shortcut.WindowStyle = 7
$shortcut.Description = 'RivaStock: iniciar Chrome y la cola de Facebook al entrar a Windows.'
$shortcut.Save()
$verifiedShortcut = $shell.CreateShortcut($shortcutPath)
if ($verifiedShortcut.TargetPath -ne $chromePath -or $verifiedShortcut.Arguments -ne $shortcut.Arguments) {
    throw 'No se pudo verificar el acceso directo de inicio.'
}
Write-Output ('Inicio automatico configurado: ' + $shortcutPath)
Write-Output 'Chrome se abrira al iniciar sesion en Windows; la extension conserva su vinculacion y estado activo.'
