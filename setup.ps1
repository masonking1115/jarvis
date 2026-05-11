# One-time setup: creates Python venv, installs backend + frontend deps.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "==> Python venv" -ForegroundColor Cyan
if (-not (Test-Path ".venv")) { python -m venv .venv }
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt

if (-not (Test-Path "backend\.env")) {
    Copy-Item "backend\.env.example" "backend\.env"
    Write-Host "Created backend\.env from example. Add your API keys before chat works." -ForegroundColor Yellow
}

Write-Host "==> Web deps" -ForegroundColor Cyan
Set-Location web
npm install
Set-Location $root

Write-Host "`nDone. Open two terminals:" -ForegroundColor Green
Write-Host "  Terminal A:  .\run-backend.ps1"
Write-Host "  Terminal B:  .\run-web.ps1"
Write-Host "Then open http://localhost:3000"
