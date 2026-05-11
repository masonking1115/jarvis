# Start the FastAPI backend on http://localhost:8000
# First time: .\setup.ps1 to install deps.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path ".venv")) {
    Write-Host "No .venv found. Run .\setup.ps1 first." -ForegroundColor Yellow
    exit 1
}

.\.venv\Scripts\Activate.ps1
if (-not (Test-Path "backend\.env") -and (Test-Path "backend\.env.example")) {
    Copy-Item "backend\.env.example" "backend\.env"
    Write-Host "Created backend\.env from example. Add your API keys." -ForegroundColor Cyan
}
python -m uvicorn backend.main:app --reload --port 8000
