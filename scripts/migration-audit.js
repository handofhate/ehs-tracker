'use strict';

const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { auditState } = require('../v2/migration-audit');

const repoRoot = path.resolve(__dirname, '..');
const port = Number(process.env.TRACKER2_PREVIEW_PORT || 8765);
const baseUrl = `http://127.0.0.1:${port}`;

function resolvePuppeteer() {
  const searchPaths = [
    process.cwd(),
    path.join(repoRoot, 'node_modules'),
    path.join(os.homedir(), 'node_modules')
  ];
  for (const searchPath of searchPaths) {
    try {
      return require(require.resolve('puppeteer', { paths: [searchPath] }));
    } catch (_) {}
  }
  throw new Error('Puppeteer is not installed. Install it locally or under the user node_modules folder first.');
}

async function previewIsReady() {
  try {
    const response = await fetch(`${baseUrl}/index.html`);
    return response.ok;
  } catch (_) {
    return false;
  }
}

function startPreviewServer() {
  const python = process.platform === 'win32'
    ? (spawnSync('py', ['--version'], { stdio: 'ignore' }).status === 0 ? 'py' : 'python')
    : 'python3';
  return spawn(python, ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: repoRoot,
    stdio: 'ignore',
    windowsHide: true
  });
}

async function waitForPreview(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await previewIsReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Preview server did not become ready at ${baseUrl}.`);
}

function printReport(report, legacyStoragePresent) {
  console.log('Tracker 2.0 migration audit (read-only)');
  console.log(`Source: ${baseUrl} -> Firestore jobtracker/state`);
  console.log('');
  console.log('Records:');
  Object.entries(report.topLevelCounts).forEach(([key, count]) => console.log(`  ${key}: ${count}`));
  console.log(`  browser localStorage jobtracker_v2: ${legacyStoragePresent ? 'present' : 'absent in this preview profile'}`);
  console.log('');
  console.log('Checks:');
  report.results.forEach(item => {
    const status = item.count === 0 ? 'ZERO ' : 'FOUND';
    console.log(`  ${status} [${item.category}] ${item.label}: ${item.count}`);
    if (item.count > 0 && item.samples.length) console.log(`         samples: ${item.samples.join(', ')}`);
  });
  console.log('');
  console.log(`Summary: ${report.nonZero.length} checks found records; ${report.zero.length} checks were zero.`);
}

async function main() {
  const puppeteer = resolvePuppeteer();
  let server = null;
  if (!(await previewIsReady())) server = startPreviewServer();

  try {
    await waitForPreview();
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => window.TRACKER_BUILD?.mode === 'local-preview', { timeout: 30000 });
      await page.waitForFunction(() => typeof DOC !== 'undefined' && !!firebase.auth().currentUser, { timeout: 30000 });

      const snapshot = await page.evaluate(async () => {
        const doc = await DOC.get();
        return {
          exists: doc.exists,
          data: doc.exists ? doc.data() : null,
          legacyStoragePresent: localStorage.getItem('jobtracker_v2') !== null
        };
      });
      if (!snapshot.exists) throw new Error('Firestore state document does not exist.');

      printReport(auditState(snapshot.data), snapshot.legacyStoragePresent);
    } finally {
      await browser.close();
    }
  } finally {
    if (server) server.kill();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
