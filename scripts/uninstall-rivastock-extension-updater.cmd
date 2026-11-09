@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-rivastock-extension-updater.ps1"
if errorlevel 1 (
  echo No se pudo quitar la tarea programada.
  pause
)
