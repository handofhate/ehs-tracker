'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

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
  throw new Error('Puppeteer is not installed. Install it locally or under the user node_modules folder to run browser smoke tests.');
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

async function main() {
  const puppeteer = resolvePuppeteer();
  let server = null;
  if (!(await previewIsReady())) server = startPreviewServer();

  try {
    await waitForPreview();
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      const pageErrors = [];
      const failedResponses = [];
      const firestoreWriteRequests = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      page.on('response', response => {
        if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
          failedResponses.push(`${response.status()} ${response.url()}`);
        }
      });
      page.on('request', request => {
        const url = request.url();
        const method = request.method();
        if (url.includes('firestore.googleapis.com') &&
            (method === 'PATCH' || method === 'DELETE' || /:(commit|batchWrite|rollback)\b/.test(url))) {
          firestoreWriteRequests.push(`${method} ${url}`);
        }
      });

      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => window.TRACKER_BUILD?.mode === 'local-preview');
      await page.waitForFunction(() => !!window.Tracker2JobDomain);
      await page.waitForFunction(() => !!window.Tracker2Persistence);
      await page.waitForFunction(() => !!window.Tracker2History);
      await page.waitForFunction(() => document.body.innerText.includes('TRACKER 2.0 LOCAL PREVIEW'));
      await page.waitForFunction(() => {
        const overlay = document.getElementById('loginOverlay');
        return overlay && (overlay.style.display === 'flex' || document.body.innerText.includes('Authentication failed'));
      }, { timeout: 30000 });

      const result = await page.evaluate(() => {
        const domain = window.Tracker2JobDomain;
        const validation = domain.validateJobDraft({
          name: 'Browser smoke client',
          lines: [{ id: 'line-1', type: 'fixed', amount: 100 }]
        });
        const milestones = domain.buildMilestones({
          mode: 'custom',
          basis: 'percent',
          entries: [{ value: 100, label: 'Invoice' }],
          idFactory: () => 'browser-milestone-1'
        });
        return {
          title: document.title,
          previewMode: window.TRACKER_BUILD.mode,
          bannerVisible: document.body.innerText.includes('changes are temporary'),
          loginVisible: getComputedStyle(document.getElementById('loginOverlay')).display !== 'none',
          domainFunctions: ['validateJobDraft', 'buildCollections', 'buildMilestones', 'buildUnifiedJobRecord']
            .every(name => typeof domain[name] === 'function'),
          persistenceModule: typeof window.Tracker2Persistence.createPersistenceBoundary === 'function',
          previewPersistence: window.Tracker2Persistence.createPersistenceBoundary({ mode: 'local-preview', writeState: () => {} }).isPreview,
          historyModule: typeof window.Tracker2History.buildClientHistory === 'function',
          validationOk: validation.ok,
          milestoneOk: milestones.ok
        };
      });

      assert.equal(result.title, 'Job Tracker');
      assert.equal(result.previewMode, 'local-preview');
      assert.equal(result.bannerVisible, true);
      assert.equal(result.loginVisible, true);
      assert.equal(result.domainFunctions, true);
      assert.equal(result.persistenceModule, true);
      assert.equal(result.previewPersistence, true);
      assert.equal(result.historyModule, true);
      assert.equal(result.validationOk, true);
      assert.equal(result.milestoneOk, true);

      const fixtureResult = await page.evaluate(() => {
        const base = _cloneState(state);
        const fixtureJob = {
          id: 'browser-smoke-job',
          name: 'Browser Test Client',
          contactName: '',
          clientId: 'browser-smoke-client',
          contactClientId: '',
          quote: 125,
          date: '2026-01-01',
          isItemized: true,
          quoteItems: [{ id: 'browser-smoke-line', label: 'Initial work', description: 'Initial work', amount: 125 }],
          milestones: [{ id: 'browser-smoke-milestone', label: 'Invoice', pct: 100, status: 'pending' }],
          addOns: [],
          subtractions: [],
          materials: [],
          workSummary: 'Initial work',
          jobType: 'quoted',
          hourlyRate: 0,
          employeeId: 'browser-smoke-employee',
          createdVia: 'unified-v2',
          status: 'active',
          advances: [],
          tips: [],
          fees: [],
          jobNotes: [{
            id: 'browser-smoke-note',
            text: 'Original note',
            date: '2026-01-01',
            authorId: 'browser-smoke-admin',
            authorName: 'Smoke Admin',
            source: 'unified-job'
          }],
          hours: [],
          partialCollections: [],
          repaymentMode: false,
          revenueItems: [],
          hourlyStatus: 'pending',
          hourlySquareInvoiceId: '',
          workCompleted: true,
          milestoneBasis: 'percent',
          unifiedLines: [{
            id: 'browser-smoke-line',
            type: 'fixed',
            label: 'Initial work',
            description: 'Initial work',
            amount: 125
          }]
        };
        state = {
          ...base,
          settings: { ...base.settings, defaultMilestones: [], defaultMilestoneBasis: 'percent' },
          users: [
            { id: 'browser-smoke-admin', name: 'Smoke Admin', isAdmin: true },
            { id: 'browser-smoke-employee', name: 'Smoke Employee', isAdmin: false, empShare: 0.66 }
          ],
          clients: [{ id: 'browser-smoke-client', firstName: 'Browser', surname: 'Test Client', email: '', phone: '' }],
          jobs: [fixtureJob]
        };
        currentUser = { id: 'browser-smoke-admin', name: 'Smoke Admin', isAdmin: true };
        document.getElementById('loginOverlay').style.display = 'none';
        V2_PERSISTENCE.setServerSnapshot(state);
        previewLatestServerState = _cloneState(state);
        _lastSavedState = _cloneState(state);
        previewDirty = false;
        _clearPreviewHistory();
        openUnifiedJobModal(fixtureJob.id);
        return {
          modalOpen: !document.getElementById('unifiedJobModal').classList.contains('hidden'),
          clientName: document.getElementById('uj_clientName').value,
          initialDescription: document.getElementById('uj_desc_1').value,
          initialNote: document.getElementById('uj_notes').value
        };
      });

      assert.deepEqual(fixtureResult, {
        modalOpen: true,
        clientName: 'Browser Test Client',
        initialDescription: 'Initial work',
        initialNote: 'Original note'
      });

      await page.$eval('#uj_desc_1', element => {
        element.value = 'Temporary work';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.$eval('#uj_notes', element => {
        element.value = 'Temporary note';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.click('#uj_saveBtn');
      await page.waitForFunction(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return previewDirty &&
          document.getElementById('unifiedJobModal').classList.contains('hidden') &&
          job?.unifiedLines?.[0]?.description === 'Temporary work';
      });

      const changedResult = await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return {
          description: job.unifiedLines[0].description,
          note: job.jobNotes[0].text,
          dirty: previewDirty
        };
      });
      assert.deepEqual(changedResult, { description: 'Temporary work', note: 'Temporary note', dirty: true });

      await page.evaluate(() => discardPreviewChanges());
      await page.waitForFunction(() => !document.getElementById('confirmModal').classList.contains('hidden'));
      await page.click('#confirmModalOk');
      await page.waitForFunction(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return !previewDirty &&
          document.getElementById('confirmModal').classList.contains('hidden') &&
          job?.unifiedLines?.[0]?.description === 'Initial work';
      });

      const discardedResult = await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return {
          description: job.unifiedLines[0].description,
          note: job.jobNotes[0].text,
          dirty: previewDirty
        };
      });
      assert.deepEqual(discardedResult, { description: 'Initial work', note: 'Original note', dirty: false });
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedResponses, []);
      assert.deepEqual(firestoreWriteRequests, []);

      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => window.TRACKER_BUILD?.mode === 'local-preview');
      assert.equal(await page.evaluate(() => window.TRACKER_BUILD.storagePrefix), 'tracker2-preview-');
      console.log('Preview browser smoke check passed.');
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
