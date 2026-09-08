param(
  [switch]$ForceUpdate = $false,
  [switch]$Strict = $false
)

$ErrorActionPreference = 'Stop'

function Complete-WithError($message) {
  if ($Strict) { throw $message }
  Write-Warning $message
  exit 0
}

try {
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
  $installDir = Join-Path $repoRoot 'tools\darts-caller'
  $exePath = Join-Path $installDir 'darts-caller.exe'
  $versionPath = Join-Path $installDir 'version.txt'
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null

  $releaseApi = if ($env:DARTS_CALLER_RELEASE_API) {
    $env:DARTS_CALLER_RELEASE_API
  } else {
    'https://api.github.com/repos/lbormann/darts-caller/releases/latest'
  }
  $assetName = if ($env:DARTS_CALLER_ASSET_NAME) { $env:DARTS_CALLER_ASSET_NAME } else { 'darts-caller.exe' }

  Write-Host '[darts-caller] Checking latest release...'
  $release = Invoke-RestMethod -Uri $releaseApi -Headers @{ 'User-Agent' = 'Dartcounter-Setup' }
  $tag = [string]$release.tag_name
  $installedTag = if (Test-Path $versionPath) { (Get-Content $versionPath -Raw).Trim() } else { '' }

  if (-not $ForceUpdate -and (Test-Path $exePath) -and $installedTag -eq $tag) {
    Write-Host "[darts-caller] Already installed ($tag)."
    exit 0
  }

  $asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
  if (-not $asset) { Complete-WithError "Release asset '$assetName' was not found." }

  $tempFile = Join-Path $env:TEMP 'dartcounter-darts-caller.exe'
  Write-Host "[darts-caller] Downloading $assetName ($tag)..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempFile -Headers @{ 'User-Agent' = 'Dartcounter-Setup' }
  Move-Item -Force -Path $tempFile -Destination $exePath
  Set-Content -Path $versionPath -Value $tag -NoNewline
  Write-Host "[darts-caller] Installed at $exePath"
} catch {
  Complete-WithError "Setup failed: $($_.Exception.Message)"
}
