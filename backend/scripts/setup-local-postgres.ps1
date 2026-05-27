# Configures local PostgreSQL for HAQMS on Windows.
# Usage (from backend/):
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local-postgres.ps1
# Optional: force-reset postgres password to "postgres" (dev only):
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local-postgres.ps1 -ResetPassword

param(
  [string]$DbUser = "postgres",
  [string]$DbPassword = "postgres",
  [string]$DbName = "haqms",
  [string]$DbHost = "127.0.0.1",
  [int]$DbPort = 5432,
  [switch]$ResetPassword
)

$ErrorActionPreference = "Stop"

$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$psql = Join-Path $pgBin "psql.exe"
$pgHba = "C:\Program Files\PostgreSQL\18\data\pg_hba.conf"
$pgService = "postgresql-x64-18"
$backendRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $backendRoot ".env"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Test-PostgresLogin {
  param([string]$Password)
  $env:PGPASSWORD = $Password
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    $null = & $psql -U $DbUser -h $DbHost -p $DbPort -d postgres -tAc "SELECT 1" 2>&1
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-Psql {
  param([string]$Sql, [string]$Password)
  $env:PGPASSWORD = $Password
  & $psql -U $DbUser -h $DbHost -p $DbPort -d postgres -v ON_ERROR_STOP=1 -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $Sql" }
}

function Enable-TrustAuth {
  if (-not (Test-Path $pgHba)) { throw "pg_hba.conf not found at $pgHba" }
  $backup = "$pgHba.bak.haqms"
  if (-not (Test-Path $backup)) {
    Copy-Item $pgHba $backup -Force
    Write-Step "Backed up pg_hba.conf to $backup"
  }
  $content = Get-Content $pgHba -Raw
  $content = $content -replace '127\.0\.0\.1/32\s+scram-sha-256', '127.0.0.1/32            trust'
  $content = $content -replace '::1/128\s+scram-sha-256', '::1/128                 trust'
  Set-Content -Path $pgHba -Value $content -NoNewline
  Restart-Service $pgService -Force
  Start-Sleep -Seconds 2
}

function Disable-TrustAuth {
  $backup = "$pgHba.bak.haqms"
  if (Test-Path $backup) {
    Copy-Item $backup $pgHba -Force
    Restart-Service $pgService -Force
    Start-Sleep -Seconds 2
  }
}

if (-not (Test-Path $psql)) {
  throw "psql not found at $psql. Install PostgreSQL or update paths in this script."
}

Write-Step "Testing PostgreSQL connection as ${DbUser}@${DbHost}:${DbPort}"
if (-not (Test-PostgresLogin -Password $DbPassword)) {
  if ($ResetPassword) {
    Write-Step "Login failed. Temporarily enabling trust auth to set dev password..."
    Enable-TrustAuth
    try {
      $env:PGPASSWORD = ""
      & $psql -U $DbUser -h $DbHost -p $DbPort -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER $DbUser WITH PASSWORD '$DbPassword';"
      if ($LASTEXITCODE -ne 0) { throw "Failed to set postgres password" }
      Write-Host "Password for '$DbUser' set to '$DbPassword' (local dev only)." -ForegroundColor Green
    } finally {
      Disable-TrustAuth
    }
  } else {
    Write-Host @"

Cannot connect with postgres:postgres.

Your Windows PostgreSQL password is not 'postgres'. Either:

  1) Re-run with password reset (dev only, requires admin):
       powershell -ExecutionPolicy Bypass -File scripts/setup-local-postgres.ps1 -ResetPassword

  2) Or set DATABASE_URL manually in backend/.env with your real password:
       DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/haqms?schema=public"

"@ -ForegroundColor Yellow
    exit 1
  }
}

if (-not (Test-PostgresLogin -Password $DbPassword)) {
  throw "Still cannot connect after setup. Check PostgreSQL service and credentials."
}

Write-Step "Ensuring database '$DbName' exists"
$exists = & { $env:PGPASSWORD = $DbPassword; & $psql -U $DbUser -h $DbHost -p $DbPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" }
if ($exists -ne "1") {
  Invoke-Psql -Sql "CREATE DATABASE $DbName;" -Password $DbPassword
  Write-Host "Created database $DbName" -ForegroundColor Green
} else {
  Write-Host "Database $DbName already exists" -ForegroundColor Green
}

Write-Step "Updating backend/.env DATABASE_URL"
$databaseUrl = "postgresql://${DbUser}:${DbPassword}@${DbHost}:${DbPort}/${DbName}?schema=public"
if (Test-Path $envFile) {
  $lines = Get-Content $envFile
  $updated = $false
  $lines = $lines | ForEach-Object {
    if ($_ -match '^\s*DATABASE_URL\s*=') {
      $updated = $true
      "DATABASE_URL=`"$databaseUrl`""
    } else { $_ }
  }
  if (-not $updated) { $lines += "DATABASE_URL=`"$databaseUrl`"" }
  Set-Content -Path $envFile -Value $lines
} else {
  @"
PORT=5000
DATABASE_URL="$databaseUrl"
JWT_SECRET="my-super-secret-secret-key-12345!!!-production-min-32"
JWT_EXPIRES_IN="8h"
NODE_ENV="development"
"@ | Set-Content -Path $envFile
}

Write-Step "Running Prisma migrations"
Push-Location $backendRoot
try {
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed" }

  Write-Step "Seeding database"
  npm run prisma:seed
  if ($LASTEXITCODE -ne 0) { throw "prisma seed failed" }
} finally {
  Pop-Location
}

Write-Host "`nDatabase ready. Restart the backend server and login with admin@haqms.com / password123" -ForegroundColor Green
