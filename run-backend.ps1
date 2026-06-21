# Start the FastAPI backend on http://localhost:8000
# First time: .\setup.ps1 to install deps.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Ensure GitHub CLI is reachable (so JARVIS's agent can run `gh`) even if this
# shell predates the install and has a stale PATH.
$ghDir = "C:\Program Files\GitHub CLI"
if ((Test-Path $ghDir) -and ($env:Path -notlike "*$ghDir*")) { $env:Path = "$ghDir;$env:Path" }

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
