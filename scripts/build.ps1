$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
pnpm install --frozen-lockfile
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
pnpm test
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
pnpm bundle
exit $LASTEXITCODE
