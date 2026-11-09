@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-rivastock-extension-updater.ps1"
if errorlevel 1 (
  echo No se pudo instalar el actualizador. No se hicieron cambios con permisos de administrador.
  pause
)
