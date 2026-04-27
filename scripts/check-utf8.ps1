param(
  [string[]]$Paths = @("app.js", "index.html", "firebase.json", "DEPLOY_CHECKLIST.md", "SQUARE_INTEGRATION.md", "SQUARE_TEST_SCENARIOS.md")
)

$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$failed = @()

foreach ($rel in $Paths) {
  $full = Join-Path (Get-Location) $rel
  if (-not (Test-Path -LiteralPath $full)) { continue }
  try {
    $bytes = [System.IO.File]::ReadAllBytes($full)
    [void]$utf8Strict.GetString($bytes)
  } catch {
    $failed += $rel
  }
}

if ($failed.Count -gt 0) {
  Write-Error ("Non-UTF8 files detected: " + ($failed -join ", "))
  exit 1
}

Write-Output "UTF-8 check passed."

