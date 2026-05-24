$engram = "$env:USERPROFILE\AppData\Local\engram\bin\engram.exe"
if (Test-Path $engram) {
    & $engram sync --import
    Write-Host "Engram memory imported."
} else {
    Write-Host "Engram not installed. Run: scoop bucket add gentleman https://github.com/Gentleman-Programming/scoop-bucket && scoop install gentle-ai"
}
