param(
  [int]$Port = 7777,
  [int]$PollSeconds = 30,
  [string]$AppBaseUrl = ''
)

$ErrorActionPreference = 'Stop'

trap {
  Write-Host ""
  Write-Host "[dartcounter] ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
  Write-Host ""
  Read-Host 'Press Enter to close'
  exit 1
}

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

$env:PORT = "$Port"
$env:NODE_ENV = 'production'
$appBase = $AppBaseUrl.Trim()
if (-not [string]::IsNullOrWhiteSpace($appBase)) {
  $env:APP_BASE_URL = $appBase
}
$env:AUTODARTS_MODE = 'REAL'
$env:AUTODARTS_ALLOW_MOCK_BINDING = 'false'
$env:AUTODARTS_ALLOW_MOCK_DARTS = 'false'

function Write-Info($msg) {
  Write-Host "[$(Get-Date -Format HH:mm:ss)] $msg"
}

function Ensure-Dependencies {
  $missingTypeScript = -not (Test-Path 'node_modules\typescript\package.json')
  $missingNodemailer = -not (Test-Path 'node_modules\nodemailer\package.json')
  $missingDotenv = -not (Test-Path 'node_modules\dotenv\package.json')
  if ($missingTypeScript -or $missingNodemailer -or $missingDotenv) {
    Write-Info 'Installing dependencies (including devDependencies for build)...'
    $env:npm_config_production = 'false'
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
  }
}

function Build-App {
  Write-Info 'Building...'
  $env:npm_config_production = 'false'
  npm run build:all
  if ($LASTEXITCODE -ne 0) { throw 'build failed (npm run build:all)' }
}

function Start-Server {
  if (-not (Test-Path 'dist\server.js')) {
    throw 'Missing dist\server.js (run build first)'
  }

  $logDir = Join-Path (Get-Location) 'logs'
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
  }
  $outLog = Join-Path $logDir 'server.out.log'
  $errLog = Join-Path $logDir 'server.err.log'

  Write-Info "Starting server on http://localhost:$Port ..."
  $p = Start-Process -FilePath node -ArgumentList @('dist\server.js') -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  return @{ Process = $p; OutLog = $outLog; ErrLog = $errLog }
}

function Show-SmtpStatus($server) {
  Start-Sleep -Milliseconds 350
  $line = $null
  if (Test-Path $server.OutLog) {
    $line = Get-Content $server.OutLog -Tail 60 | Where-Object { $_ -like '[auth] SMTP *' } | Select-Object -Last 1
  }
  if (-not $line -and (Test-Path $server.ErrLog)) {
    $line = Get-Content $server.ErrLog -Tail 60 | Where-Object { $_ -like '[auth] SMTP *' } | Select-Object -Last 1
  }
  if ($line) {
    Write-Info $line
  } else {
    Write-Info 'SMTP status not found yet (check logs/server.out.log and logs/server.err.log).'
  }
}

function Stop-Server($server) {
  if ($null -eq $server) { return }
  $proc = $server.Process
  try {
    if (-not $proc.HasExited) {
      Write-Info "Stopping server (pid $($proc.Id))..."
      Stop-Process -Id $proc.Id -Force
    }
  } catch {
    # ignore
  }
}

function Git-HasUpstream {
  git rev-parse --abbrev-ref '@{u}' 1>$null 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Git-IsClean {
  $s = git status --porcelain
  return [string]::IsNullOrWhiteSpace($s)
}

function Git-NeedsUpdate {
  git fetch --prune 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'git fetch failed'
  }
  $local = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw 'git rev-parse HEAD failed'
  }
  $remote = (git rev-parse '@{u}').Trim()
  if ($LASTEXITCODE -ne 0) {
    throw 'git rev-parse @{u} failed'
  }
  return $local -ne $remote
}

function Git-PullFastForward {
  git pull --ff-only
}

Ensure-Dependencies
Build-App
$server = Start-Server
Show-SmtpStatus $server

Write-Info "Auto-update enabled. Polling every $PollSeconds seconds."

while ($true) {
  Start-Sleep -Seconds $PollSeconds

  if ($server.Process.HasExited) {
    Write-Info "Server exited (code $($server.Process.ExitCode)); rebuilding + restarting..."
    if (Test-Path $server.ErrLog) {
      Write-Info 'Last stderr lines:'
      Get-Content $server.ErrLog -Tail 40 | ForEach-Object { Write-Host $_ }
    }
    Ensure-Dependencies
    Build-App
    $server = Start-Server
    Show-SmtpStatus $server
    continue
  }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { continue }
  if (-not (Git-HasUpstream)) { continue }

  if (-not (Git-IsClean)) {
    Write-Info 'Working tree is dirty; skipping auto-pull.'
    continue
  }

  $needsUpdate = $false
  try {
    $needsUpdate = Git-NeedsUpdate
  } catch {
    continue
  }

  if ($needsUpdate) {
    Write-Info 'Remote update found; pulling + rebuilding...'
    Stop-Server $server
    Git-PullFastForward
    Ensure-Dependencies
    Build-App
    $server = Start-Server
    Show-SmtpStatus $server
  }
}
