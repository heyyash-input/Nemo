param(
    [ValidateSet('dev', 'build', 'test', 'start', 'admin', 'check-mail')]
    [string]$Task = 'dev'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:UV_CACHE_DIR = Join-Path $PSScriptRoot '.uv-cache'
$env:npm_config_cache = Join-Path $PSScriptRoot '.data\npm-cache'
$env:MONGOMS_DOWNLOAD_DIR = Join-Path $PSScriptRoot '.data\mongodb-binaries'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv before running this project.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 20.19+ before running this project.' }
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    uv venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the project uv environment.' }
}
if (-not (Test-Path -LiteralPath 'node_modules')) {
    uv run --no-project --python .venv\Scripts\python.exe npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
uv run --no-project --python .venv\Scripts\python.exe npm.cmd run $Task
exit $LASTEXITCODE
