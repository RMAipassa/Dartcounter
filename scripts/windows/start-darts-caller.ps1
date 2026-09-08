param(
  [switch]$Strict = $false
)

$ErrorActionPreference = 'Stop'

function Complete-WithError($message) {
  if ($Strict) { throw $message }
  Write-Warning $message
  exit 0
}

if ($env:DARTS_CALLER_AUTO_START -ne 'true') {
  Write-Host '[darts-caller] Auto-start disabled. Set DARTS_CALLER_AUTO_START=true to enable.'
  exit 0
}

try {
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
  $exePath = Join-Path $repoRoot 'tools\darts-caller\darts-caller.exe'
  $mediaPath = if ($env:DARTS_CALLER_MEDIA_PATH) {
    $env:DARTS_CALLER_MEDIA_PATH
  } else {
    Join-Path $repoRoot 'data\darts-caller-media'
  }

  if (-not (Test-Path $exePath)) { Complete-WithError 'darts-caller.exe is not installed.' }
  if ([string]::IsNullOrWhiteSpace($env:DARTS_CALLER_AUTODARTS_EMAIL)) {
    Complete-WithError 'DARTS_CALLER_AUTODARTS_EMAIL is required for auto-start.'
  }
  if ([string]::IsNullOrWhiteSpace($env:DARTS_CALLER_AUTODARTS_PASSWORD)) {
    Complete-WithError 'DARTS_CALLER_AUTODARTS_PASSWORD is required for auto-start.'
  }
  if ([string]::IsNullOrWhiteSpace($env:DARTS_CALLER_AUTODARTS_BOARD_ID)) {
    Complete-WithError 'DARTS_CALLER_AUTODARTS_BOARD_ID is required for auto-start.'
  }

  New-Item -ItemType Directory -Force -Path $mediaPath | Out-Null

  $existing = Get-CimInstance Win32_Process -Filter "Name = 'darts-caller.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $exePath }
  if ($existing) {
    Write-Host "[darts-caller] Already running (pid $($existing[0].ProcessId))."
    exit 0
  }

  $arguments = @(
    '-U', ('"' + $env:DARTS_CALLER_AUTODARTS_EMAIL.Replace('"', '\"') + '"'),
    '-P', ('"' + $env:DARTS_CALLER_AUTODARTS_PASSWORD.Replace('"', '\"') + '"'),
    '-B', ('"' + $env:DARTS_CALLER_AUTODARTS_BOARD_ID.Replace('"', '\"') + '"'),
    '-M', ('"' + $mediaPath.Replace('"', '\"') + '"')
  )
  if ($env:DARTS_CALLER_EXTRA_ARGS) {
    $arguments += $env:DARTS_CALLER_EXTRA_ARGS -split '\s+'
  }

  $process = Start-Process -FilePath $exePath -ArgumentList $arguments -WorkingDirectory (Split-Path $exePath) -PassThru
  Write-Host "[darts-caller] Started (pid $($process.Id))."
} catch {
  Complete-WithError "Start failed: $($_.Exception.Message)"
}
