param(
  [int]$Port = 7777,
  [int]$PollSeconds = 30
)

$ErrorActionPreference = 'Stop'

Set-Location (Split-Path $PSScriptRoot -Parent)

$env:PORT = "$Port"
$env:NODE_ENV = 'production'

function Write-Info($msg) {
  Write-Host "[$(Get-Date -Format HH:mm:ss)] $msg"
}

function Ensure-Dependencies {
  if (-not (Test-Path 'node_modules\typescript\package.json')) {
    Write-Info 'Installing dependencies (including devDependencies for build)...'
    $env:npm_config_production = 'false'
    npm install
  }
}

function Build-App {
  Write-Info 'Building...'
  $env:npm_config_production = 'false'
  npm run build:all
}

function Start-Server {
  if (-not (Test-Path 'dist\server.js')) {
    throw 'Missing dist\server.js (run build first)'
  }

  Write-Info "Starting server on http://localhost:$Port ..."
  Start-Process "http://localhost:$Port/" | Out-Null
  $p = Start-Process -FilePath node -ArgumentList @('dist\server.js') -PassThru
  return $p
}

function Stop-Server($proc) {
  if ($null -eq $proc) { return }
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
  try {
    git rev-parse --abbrev-ref '@{u}' 2>$null | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Git-IsClean {
  $s = git status --porcelain
  return [string]::IsNullOrWhiteSpace($s)
}

function Git-NeedsUpdate {
  git fetch | Out-Null
  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse '@{u}').Trim()
  return $local -ne $remote
}

function Git-PullFastForward {
  git pull --ff-only
}

Ensure-Dependencies
Build-App
$server = Start-Server

Write-Info "Auto-update enabled. Polling every $PollSeconds seconds."

while ($true) {
  Start-Sleep -Seconds $PollSeconds

  if ($server.HasExited) {
    Write-Info 'Server exited; rebuilding + restarting...'
    Ensure-Dependencies
    Build-App
    $server = Start-Server
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
  }
}
