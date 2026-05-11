# Start the Next.js frontend on http://localhost:3000
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "web")

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing web dependencies..." -ForegroundColor Cyan
    npm install
}
npm run dev
