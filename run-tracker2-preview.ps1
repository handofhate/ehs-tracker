$ErrorActionPreference = 'Stop'

$port = 8765
$serverCommand = Get-Command py -ErrorAction SilentlyContinue
if (-not $serverCommand) {
  $serverCommand = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $serverCommand) {
  throw 'Python was not found. Install Python or run a local web server for this folder.'
}

$alreadyListening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $alreadyListening) {
  Start-Process -FilePath $serverCommand.Source `
    -ArgumentList @('-m', 'http.server', [string]$port, '--bind', '127.0.0.1') `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden | Out-Null
}

$previewUrl = "http://127.0.0.1:$port/index.html?trackerMode=preview"
Start-Process $previewUrl
Write-Host "Tracker 2.0 local preview: $previewUrl"
