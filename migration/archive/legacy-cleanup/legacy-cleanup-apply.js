'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { applyCleanupPlan, buildCleanupPlan } = require('../v2/legacy-cleanup');

const repoRoot = path.resolve(__dirname, '..');
const port = Number(process.env.TRACKER2_PREVIEW_PORT || 8765);
const baseUrl = `http://127.0.0.1:${port}`;
const archiveRoot = path.resolve(repoRoot, '..', 'ehs-tracker-migration-archives');

const manualJobTargets = Object.freeze({
  'mlk780bg8o4k': 'Dean Griffin',
  'mlk7adx0ikac': 'Oscar Ortega',
  '51aa58dc-a3ae-4ce4-bd19-b4a710852a09': 'Oscar Ortega',
  '4849e828-af58-4277-bc4d-64485a0da963': 'Oscar Ortega',
  'a6a7c067-3331-48af-91e4-4f6b6de92152': 'Kip Holmes',
  '561318b6-cdb4-42ce-9ba7-ee97fff7d1dc': 'Oscar Ortega',
  '3f26678a-88e2-4c81-8ea0-eb2d57c86883': 'Oscar Ortega',
  'e1c773b8-0396-4fb7-ad3d-7c5981d73d37': 'Kip Holmes',
  'd84308a2-f65b-4c60-8dbd-1ed37a686f09': 'Kip Holmes',
  '6fdb97b0-ce13-4dcf-b117-1ee7fcd54a8e': 'Jamie Katz',
  '2c12245b-1733-4647-8759-c3edde9c51e4': 'Kip Holmes',
  '23705ea6-e251-48ae-b851-ab6b73b662ab': 'John Vinson',
  '38db209b-272f-4fb2-8ea0-70e5c074a747': 'Kip Holmes'
});

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

function fullName(client) {
  return [client?.firstName, client?.surname].filter(Boolean).join(' ').trim();
}

function findUniqueClient(clients, name) {
  const wanted = name.toLowerCase();
  const matches = clients.filter(client => fullName(client).toLowerCase() === wanted);
  if (matches.length !== 1) throw new Error(`Expected one existing client named ${name}; found ${matches.length}.`);
  return matches[0];
}

function makeJohnVinson() {
  return {
    id: randomUUID(),
    squareId: '',
    refId: '',
    firstName: 'John',
    surname: 'Vinson',
    company: '',
    email: '',
    phone: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    postal: '',
    birthday: '',
    memo: '',
    emailSubStatus: '',
    firstVisit: '',
    lastVisit: '',
    txCount: 0,
    lifetimeSpend: '',
    clientNotes: []
  };
}

function stable(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function protectedProjection(state, operations) {
  const copy = JSON.parse(JSON.stringify(state));
  const markerIds = new Set(operations.legacyMarkerJobIds);
  const assignmentIds = new Set(operations.clientAssignments.map(entry => entry.jobId));
  copy.jobs = (copy.jobs || []).map(job => {
    if (markerIds.has(job.id)) delete job.createdVia;
    if (assignmentIds.has(job.id)) delete job.clientId;
    return job;
  });
  copy.clients = (copy.clients || []).filter(client => client.id !== operations.newClient.id);
  return stable(copy);
}

function buildOperations(state) {
  const plan = buildCleanupPlan(state);
  if (plan.summary.legacyMarkersToAdd !== 100 ||
      plan.summary.clientIdsToAdd !== 78 ||
      plan.summary.ambiguousClientMatches !== 0 ||
      plan.summary.unmatchedClientJobs !== 13 ||
      plan.summary.partialJobsToReview !== 2 ||
      plan.summary.partialItemsToReview !== 12) {
    throw new Error(`Live data no longer matches the reviewed dry-run counts: ${JSON.stringify(plan.summary)}`);
  }

  const unmatchedIds = new Set(plan.reviewRequired.unmatchedClientJobs.map(entry => entry.jobId));
  const manualIds = new Set(Object.keys(manualJobTargets));
  if (unmatchedIds.size !== manualIds.size || [...unmatchedIds].some(id => !manualIds.has(id))) {
    throw new Error('The reviewed 13-job manual mapping no longer matches the live unmatched set.');
  }

  const clients = Array.isArray(state.clients) ? state.clients : [];
  const targetIds = new Map();
  ['Dean Griffin', 'Oscar Ortega', 'Kip Holmes', 'Jamie Katz'].forEach(name => {
    targetIds.set(name, findUniqueClient(clients, name).id);
  });
  const john = makeJohnVinson();
  if (clients.some(client => fullName(client).toLowerCase() === 'john vinson')) {
    throw new Error('John Vinson already exists; refusing to create a duplicate client.');
  }

  const manualAssignments = Object.entries(manualJobTargets).map(([jobId, targetName]) => {
    if (targetName === 'John Vinson') return { jobId, clientId: john.id, match: 'manual-new-client' };
    return { jobId, clientId: targetIds.get(targetName), match: 'manual' };
  });
  const clientAssignments = [...plan.proposedChanges.clientAssignments, ...manualAssignments];
  const operations = {
    legacyMarkerJobIds: plan.proposedChanges.legacyMarkerChanges.map(entry => entry.jobId),
    clientAssignments,
    newClient: john
  };
  const next = applyCleanupPlan(state, operations);
  if (protectedProjection(state, operations) !== protectedProjection(next, operations)) {
    throw new Error('Proposed cleanup changes would alter protected data.');
  }
  return { plan, operations, next };
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
        function stable(value) {
          if (value === undefined) return 'undefined';
          if (value === null || typeof value !== 'object') return JSON.stringify(value);
          if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
          return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
        }
        const doc = await DOC.get();
        const data = doc.exists ? doc.data() : null;
        return {
          exists: doc.exists,
          data,
          fingerprint: stable(data),
          archiveJson: JSON.stringify(data)
        };
      });
      if (!snapshot.exists) throw new Error('Firestore state document does not exist.');

      const { plan, operations, next } = buildOperations(snapshot.data);
      const archivePath = path.join(archiveRoot, `tracker-state-before-legacy-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.mkdirSync(archiveRoot, { recursive: true });
      fs.writeFileSync(archivePath, JSON.stringify({
        capturedAt: new Date().toISOString(),
        source: 'Firestore jobtracker/state',
        plan,
        operations,
        state: JSON.parse(snapshot.archiveJson)
      }, null, 2), { encoding: 'utf8', flag: 'wx' });

      const writeResult = await page.evaluate(async ({ expectedFingerprint, operations }) => {
        function stable(value) {
          if (value === undefined) return 'undefined';
          if (value === null || typeof value !== 'object') return JSON.stringify(value);
          if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
          return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
        }
        function protectedProjection(state) {
          const copy = JSON.parse(JSON.stringify(state));
          const markerIds = new Set(operations.legacyMarkerJobIds);
          const assignmentIds = new Set(operations.clientAssignments.map(entry => entry.jobId));
          copy.jobs = (copy.jobs || []).map(job => {
            if (markerIds.has(job.id)) delete job.createdVia;
            if (assignmentIds.has(job.id)) delete job.clientId;
            return job;
          });
          copy.clients = (copy.clients || []).filter(client => client.id !== operations.newClient.id);
          return stable(copy);
        }
        const latest = await DOC.get();
        if (!latest.exists) return { applied: false, reason: 'state document disappeared' };
        if (stable(latest.data()) !== expectedFingerprint) return { applied: false, reason: 'state changed after archive' };
        const current = latest.data();
        const markerIds = new Set(operations.legacyMarkerJobIds);
        const assignmentByJob = new Map(operations.clientAssignments.map(entry => [entry.jobId, entry.clientId]));
        const next = { ...current };
        next.jobs = (current.jobs || []).map(job => {
          const updated = { ...job };
          if (markerIds.has(updated.id)) updated.createdVia = 'legacy';
          if (assignmentByJob.has(updated.id)) updated.clientId = assignmentByJob.get(updated.id);
          return updated;
        });
        next.clients = [...(current.clients || [])];
        if (!next.clients.some(client => client.id === operations.newClient.id)) next.clients.push(operations.newClient);
        await DOC.set(next);
        const verified = await DOC.get();
        const data = verified.data();
        return {
          applied: true,
          protectedUnchanged: protectedProjection(current) === protectedProjection(data),
          markerCount: (data.jobs || []).filter(job => markerIds.has(job.id) && job.createdVia === 'legacy').length,
          linkedCount: (data.jobs || []).filter(job => assignmentByJob.has(job.id) && job.clientId === assignmentByJob.get(job.id)).length,
          johnExists: (data.clients || []).some(client => client.id === operations.newClient.id && client.firstName === 'John' && client.surname === 'Vinson')
        };
      }, { expectedFingerprint: snapshot.fingerprint, operations });

      if (!writeResult.applied) throw new Error(`No write performed: ${writeResult.reason}.`);
      if (!writeResult.protectedUnchanged || writeResult.markerCount !== operations.legacyMarkerJobIds.length || writeResult.linkedCount !== operations.clientAssignments.length || !writeResult.johnExists) {
        throw new Error(`Post-write verification failed: ${JSON.stringify(writeResult)}`);
      }
      console.log('Legacy cleanup applied successfully.');
      console.log(`  Legacy markers added/confirmed: ${writeResult.markerCount}`);
      console.log(`  Client links added/confirmed: ${writeResult.linkedCount}`);
      console.log('  New client created: John Vinson');
      console.log(`  Firestore write requests classified by browser monitor: ${writeRequests.length}`);
      if (!writeRequests.length) console.log('  Transport monitor did not classify the Firebase channel; read-back verification succeeded.');
      console.log(`  Local archive: ${archivePath}`);
      console.log('  Protected financial and unrelated data: unchanged');
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
