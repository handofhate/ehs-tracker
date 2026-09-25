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
      page.on('pageerror', error => pageErrors.push(String(error)));
      page.on('response', response => {
        if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
          failedResponses.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => window.TRACKER_BUILD?.mode === 'local-preview');
      await page.waitForFunction(() => !!window.Tracker2JobDomain);
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
          validationOk: validation.ok,
          milestoneOk: milestones.ok
        };
      });

      assert.equal(result.title, 'Job Tracker');
      assert.equal(result.previewMode, 'local-preview');
      assert.equal(result.bannerVisible, true);
      assert.equal(result.loginVisible, true);
      assert.equal(result.domainFunctions, true);
      assert.equal(result.validationOk, true);
      assert.equal(result.milestoneOk, true);
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(failedResponses, []);

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
