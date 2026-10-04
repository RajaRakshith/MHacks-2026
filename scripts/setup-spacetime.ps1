# ScamShield SpacetimeDB setup helper (Windows)
# Run from repo root after installing the CLI:
#   iwr https://windows.spacetimedb.com -useb | iex

$InstallDir = Join-Path $env:LOCALAPPDATA "SpacetimeDB"
$SpacetimeExe = Join-Path $InstallDir "spacetime.exe"

if (-not (Test-Path $SpacetimeExe)) {
    Write-Host "SpacetimeDB CLI not found. Install first:" -ForegroundColor Yellow
    Write-Host '  iwr https://windows.spacetimedb.com -useb | iex' -ForegroundColor Cyan
    exit 1
}

if ($env:Path -notlike "*$InstallDir*") {
    $env:Path = "$InstallDir;$env:Path"
}

Write-Host "SpacetimeDB CLI:" -ForegroundColor Green
& $SpacetimeExe version list
& $SpacetimeExe mcp --help | Select-Object -First 3

Write-Host ""
Write-Host "1) Open a NEW PowerShell window (PATH was updated)." -ForegroundColor Cyan
Write-Host "2) Login (opens browser — redeem credits on spacetimedb.com first):" -ForegroundColor Cyan
Write-Host "     spacetime login" -ForegroundColor White
Write-Host "3) Local dev (terminal A):" -ForegroundColor Cyan
Write-Host "     spacetime start" -ForegroundColor White
Write-Host "4) Local dev (terminal B, from repo root):" -ForegroundColor Cyan
Write-Host "     npm run spacetime:dev" -ForegroundColor White
Write-Host "5) Cloud publish (after login + credits):" -ForegroundColor Cyan
Write-Host "     npm run spacetime:publish:cloud" -ForegroundColor White
Write-Host ""
Write-Host "Reload Cursor after agent MCP setup (Settings > Tools & Integrations)." -ForegroundColor Yellow
