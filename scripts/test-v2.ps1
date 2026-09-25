$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  Write-Host 'Checking JavaScript syntax...'
  node --check app.js
  if ($LASTEXITCODE -ne 0) { throw 'app.js syntax check failed.' }
  node --check v2/job-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/job-domain.js syntax check failed.' }
  node --check v2/fee-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/fee-domain.js syntax check failed.' }
  node --check v2/state-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/state-domain.js syntax check failed.' }
  node --check v2/migration-audit.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/migration-audit.js syntax check failed.' }
  node --check scripts/migration-audit.js
  if ($LASTEXITCODE -ne 0) { throw 'scripts/migration-audit.js syntax check failed.' }
  node --check v2/persistence-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/persistence-domain.js syntax check failed.' }
  node --check v2/history-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/history-domain.js syntax check failed.' }
  node --check v2/debt-feature.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/debt-feature.js syntax check failed.' }
  node --check v2/financial-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/financial-domain.js syntax check failed.' }
  node --check v2/legacy-partial-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/legacy-partial-domain.js syntax check failed.' }
  node --check v2/backup-domain.js
  if ($LASTEXITCODE -ne 0) { throw 'v2/backup-domain.js syntax check failed.' }

  Write-Host 'Running Tracker 2.0 domain tests...'
  npm test --prefix v2
  if ($LASTEXITCODE -ne 0) { throw 'Tracker 2.0 domain tests failed.' }

  Write-Host 'Running local preview browser smoke test...'
  node scripts/preview-smoke.js
  if ($LASTEXITCODE -ne 0) { throw 'Local preview browser smoke test failed.' }

  if (Test-Path -LiteralPath 'functions/package.json') {
    Write-Host 'Running local Square/backend helper tests...'
    npm test --prefix functions
    if ($LASTEXITCODE -ne 0) { throw 'Local Square/backend helper tests failed.' }
  } else {
    Write-Host 'Skipping functions tests (local functions package not present).'
  }

  Write-Host 'Checking edited files for valid UTF-8...'
  & $PSScriptRoot\check-utf8.ps1 -Paths @(
    'app.js',
    'index.html',
    'v2/job-domain.js',
    'v2/job-domain.test.js',
    'v2/fee-domain.js',
    'v2/fee-domain.test.js',
    'v2/state-domain.js',
    'v2/state-domain.test.js',
    'v2/migration-audit.js',
    'v2/migration-audit.test.js',
    'scripts/migration-audit.js',
    'scripts/preview-smoke.js',
    'v2/persistence-domain.js',
    'v2/persistence-domain.test.js',
    'v2/history-domain.js',
    'v2/history-domain.test.js',
    'v2/debt-feature.js',
    'v2/debt-feature.test.js',
    'v2/financial-domain.js',
    'v2/financial-domain.test.js',
    'v2/legacy-partial-domain.js',
    'v2/legacy-partial-domain.test.js',
    'v2/backup-domain.js',
    'v2/backup-domain.test.js',
    'v2/package.json'
  )

  Write-Host 'Tracker 2.0 preview checks passed.' -ForegroundColor Green
} finally {
  Pop-Location
}
