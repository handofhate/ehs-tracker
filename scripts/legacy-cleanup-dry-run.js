'use strict';

const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { buildCleanupPlan } = require('../v2/legacy-cleanup');

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

function printSamples(label, items) {
  if (items.length) console.log(`  ${label}: ${items.map(item => item.jobId || item).join(', ')}`);
}

function printPlan(plan, legacyStoragePresent, writeRequests) {
  console.log('Tracker 2.0 legacy cleanup dry-run');
  console.log('READ ONLY: no Firestore write mode exists in this command.');
  console.log(`Source: ${baseUrl} -> Firestore jobtracker/state`);
  console.log('');
  console.log(`Records: ${plan.sourceCounts.jobs} jobs, ${plan.sourceCounts.clients} clients`);
  console.log(`Legacy localStorage key: ${legacyStoragePresent ? 'present in preview profile' : 'absent in preview profile'}`);
  console.log('');
  console.log('Proposed changes:');
  console.log(`  Add explicit createdVia: legacy: ${plan.summary.legacyMarkersToAdd}`);
  console.log(`  Add exact unique clientId links: ${plan.summary.clientIdsToAdd}`);
  printSamples('sample marker jobs', plan.samples.legacyMarkerChanges);
  printSamples('sample client links', plan.samples.clientAssignments);
  console.log('');
  console.log('Requires review and will not be changed:');
  console.log(`  Ambiguous client matches: ${plan.summary.ambiguousClientMatches}`);
  console.log(`  Jobs with no client match: ${plan.summary.unmatchedClientJobs}`);
  console.log(`  Jobs with legacy partial state: ${plan.summary.partialJobsToReview}`);
  console.log(`  Legacy partial items: ${plan.summary.partialItemsToReview}`);
  printSamples('sample ambiguous jobs', plan.samples.ambiguousClientMatches);
  printSamples('sample unmatched jobs', plan.samples.unmatchedClientJobs);
  printSamples('sample partial jobs', plan.samples.partialReview);
  console.log('');
  console.log(`Firestore write requests observed: ${writeRequests.length}`);
  if (writeRequests.length) {
    writeRequests.forEach(request => console.log(`  UNEXPECTED WRITE: ${request}`));
    throw new Error('Dry-run observed a Firestore write request. No changes were approved or applied.');
  }
  console.log('Dry-run complete; live data was not changed.');
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
      const writeRequests = [];
      page.on('request', request => {
        const url = request.url();
        const method = request.method();
        if (url.includes('firestore.googleapis.com') &&
            (method === 'PATCH' || method === 'DELETE' || /:(commit|batchWrite|rollback)\b/.test(url))) {
          writeRequests.push(`${method} ${url}`);
        }
      });
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
      printPlan(buildCleanupPlan(snapshot.data), snapshot.legacyStoragePresent, writeRequests);
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
