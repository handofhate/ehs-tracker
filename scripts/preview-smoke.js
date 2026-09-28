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
const previewUrl = `${baseUrl}/index.html?trackerMode=preview`;

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

      await page.goto(previewUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => window.TRACKER_BUILD?.mode === 'local-preview');
      await page.waitForFunction(() => !!window.Tracker2JobDomain);
      await page.waitForFunction(() => !!window.Tracker2Fees);
      await page.waitForFunction(() => !!window.Tracker2State);
      await page.waitForFunction(() => !!window.Tracker2Persistence);
      await page.waitForFunction(() => !!window.Tracker2History);
      await page.waitForFunction(() => !!window.Tracker2ActivityHistory);
      await page.waitForFunction(() => !!window.Tracker2DebtFeature);
      await page.waitForFunction(() => !!window.Tracker2Financial);
      await page.waitForFunction(() => !!window.Tracker2Billing);
      await page.waitForFunction(() => !!window.Tracker2Backup);
      await page.waitForFunction(() => !!window.Tracker2HistoricalBoundary);
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
          duotoneStylesheet: !!document.querySelector('link[href*="@phosphor-icons/web@2.1.1/src/duotone/style.css"]'),
          bannerVisible: document.body.innerText.includes('changes are temporary'),
          loginVisible: getComputedStyle(document.getElementById('loginOverlay')).display !== 'none',
          domainFunctions: ['validateJobDraft', 'buildCollections', 'buildMilestones', 'buildUnifiedJobRecord']
            .every(name => typeof domain[name] === 'function'),
          feeModule: typeof window.Tracker2Fees.migrateStateFees === 'function' &&
            typeof window.Tracker2Fees.createFeeConfig === 'function',
          stateModule: typeof window.Tracker2State.migrateState === 'function',
          persistenceModule: typeof window.Tracker2Persistence.createPersistenceBoundary === 'function',
          saveQueueModule: typeof window.Tracker2SaveQueue.createSaveQueue === 'function',
          undoRedoModule: typeof window.Tracker2UndoRedo.createHistory === 'function' &&
            typeof window.Tracker2UndoRedo.describeAction === 'function',
          previewSessionModule: typeof window.Tracker2PreviewSession.createPreviewSession === 'function',
          previewPersistence: window.Tracker2Persistence.createPersistenceBoundary({ mode: 'local-preview', writeState: () => {} }).isPreview,
          historyModule: typeof window.Tracker2History.buildClientHistory === 'function',
          activityHistoryModule: typeof window.Tracker2ActivityHistory.buildActivityEvents === 'function' &&
            typeof window.Tracker2ActivityHistory.appendActivityEvents === 'function',
          activityHistoryButton: !!document.getElementById('activityHistoryBtn'),
          activityHistoryModal: !!document.getElementById('activityHistoryModal'),
          debtModule: typeof window.Tracker2DebtFeature.isActive === 'function',
          financialModule: typeof window.Tracker2Financial.calcJob === 'function',
          billingModule: typeof window.Tracker2Billing.getJobBillingSummary === 'function' &&
            typeof window.Tracker2Billing.jobBillingEntries === 'function',
          overviewModule: typeof window.Tracker2Overview.recentEmployeePay === 'function' &&
            typeof window.Tracker2Overview.employeePaySummary === 'function' &&
            typeof window.Tracker2Overview.visibleDashboardNotes === 'function',
          employeePaymentModule: typeof window.Tracker2EmployeePayment.buildPaymentRows === 'function' &&
            typeof window.Tracker2EmployeePayment.splitAllocation === 'function',
          employeeLedgerModule: typeof window.Tracker2EmployeeLedger.getLedgerEntries === 'function' &&
            typeof window.Tracker2EmployeeLedger.buildLedgerFromStoredEvents === 'function',
          backupModule: typeof window.Tracker2Backup.serializeState === 'function' &&
            typeof window.Tracker2Backup.parseBackup === 'function',
          historicalBoundaryModule: typeof window.Tracker2HistoricalBoundary.isHistoricalJob === 'function' &&
            typeof window.Tracker2HistoricalBoundary.boundaryForJob === 'function',
          validationOk: validation.ok,
          milestoneOk: milestones.ok
        };
      });

      assert.equal(result.title, 'Job Tracker');
      assert.equal(result.previewMode, 'local-preview');
      assert.equal(result.duotoneStylesheet, true);
      assert.equal(result.bannerVisible, true);
      assert.equal(result.loginVisible, true);
      assert.equal(result.domainFunctions, true);
      assert.equal(result.feeModule, true);
      assert.equal(result.stateModule, true);
      assert.equal(result.persistenceModule, true);
      assert.equal(result.saveQueueModule, true);
      assert.equal(result.undoRedoModule, true);
      assert.equal(result.previewSessionModule, true);
      assert.equal(result.previewPersistence, true);
      assert.equal(result.historyModule, true);
      assert.equal(result.activityHistoryModule, true);
      assert.equal(result.activityHistoryButton, true);
      assert.equal(result.activityHistoryModal, true);
      assert.equal(result.debtModule, true);
      assert.equal(result.financialModule, true);
      assert.equal(result.billingModule, true);
      assert.equal(result.overviewModule, true);
      assert.equal(result.employeePaymentModule, true);
      assert.equal(result.employeeLedgerModule, true);
      assert.equal(result.backupModule, true);
      assert.equal(result.historicalBoundaryModule, true);
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
          milestones: [{ id: 'browser-smoke-milestone', label: 'Invoice', amount: 125, status: 'pending' }],
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
          milestoneBasis: 'amount',
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
          homewatch: [],
          splitPayments: [],
          jobs: [fixtureJob],
          dashboardNotes: [
            { id: 'browser-smoke-dashboard-note-1', text: 'Smoke note one', date: '2026-01-01', authorId: 'browser-smoke-admin', authorName: 'Smoke Admin' },
            { id: 'browser-smoke-dashboard-note-2', text: 'Smoke note two', date: '2026-01-02', authorId: 'browser-smoke-admin', authorName: 'Smoke Admin' },
            { id: 'browser-smoke-dashboard-note-3', text: 'Smoke note three', date: '2026-01-03', authorId: 'browser-smoke-employee', authorName: 'Smoke Employee' }
          ]
        };
        currentUser = { id: 'browser-smoke-admin', name: 'Smoke Admin', isAdmin: true };
        document.getElementById('loginOverlay').style.display = 'none';
        previewSession.setServerSnapshot(state);
        _lastSavedState = _cloneState(state);
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

      const activitySaveResult = await page.evaluate(async () => {
        closeModal('unifiedJobModal');
        const baseline = _cloneState(state);
        state.jobs[0].name = 'Activity History Test Client';
        await save();
        const savedEvent = state.activityHistory?.at(-1);
        const savedEventRecorded = savedEvent?.objectType === 'job' && savedEvent?.eventType === 'updated';
        await undoAction();
        const undoEventRecorded = state.activityHistory?.some(event => String(event.actionLabel || '').startsWith('Undo:'));
        await redoAction();
        const redoEventRecorded = state.activityHistory?.some(event => String(event.actionLabel || '').startsWith('Redo:'));
        const redone = state.jobs[0].name === 'Activity History Test Client';
        await undoAction();
        const restored = state.jobs[0].name === baseline.jobs[0].name;
        state = baseline;
        previewSession.setServerSnapshot(state);
        _clearPreviewHistory();
        renderAll();
        return { savedEventRecorded, undoEventRecorded, redoEventRecorded, redone, restored };
      });
      assert.deepEqual(activitySaveResult, { savedEventRecorded: true, undoEventRecorded: true, redoEventRecorded: true, redone: true, restored: true });

      const queuedSaveResult = await page.evaluate(async () => {
        const baseline = _cloneState(state);
        state.jobs[0].name = 'Queued First Change';
        const firstSave = save();
        state.jobs[0].name = 'Queued Final Change';
        const secondSave = save();
        await Promise.all([firstSave, secondSave]);
        const finalSnapshotName = _lastSavedState.jobs[0].name;
        state = baseline;
        previewSession.setServerSnapshot(state);
        _clearPreviewHistory();
        renderAll();
        return { finalSnapshotName, queuedFinalStateSaved: finalSnapshotName === 'Queued Final Change' };
      });
      assert.deepEqual(queuedSaveResult, { finalSnapshotName: 'Queued Final Change', queuedFinalStateSaved: true });

      const realtimeBoundaryResult = await page.evaluate(async () => {
        const baseline = _cloneState(state);
        previewSession.setServerSnapshot(baseline);
        state.jobs[0].name = 'Temporary local edit';
        await save();
        const remote = _cloneState(baseline);
        remote.jobs[0].name = 'Remote live update';
        const update = previewSession.receiveServerSnapshot(remote);
        const localEditHeld = state.jobs[0].name === 'Temporary local edit';
        window.__smokeRealtimeBaseline = baseline;
        discardPreviewChanges();
        return { changedWhileDirty: update.changedWhileDirty, appliedWhileDirty: update.apply, localEditHeld };
      });
      await page.waitForFunction(() => !document.getElementById('confirmModal').classList.contains('hidden'));
      assert.deepEqual(realtimeBoundaryResult, { changedWhileDirty: true, appliedWhileDirty: false, localEditHeld: true });
      await page.click('#confirmModalOk');
      await page.waitForFunction(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return !previewSession.isDirty() && job?.name === 'Remote live update';
      });
      await page.evaluate(() => {
        state = window.__smokeRealtimeBaseline;
        delete window.__smokeRealtimeBaseline;
        previewSession.setServerSnapshot(state);
        _clearPreviewHistory();
        renderAll();
      });

      const backupRoundTripResult = await page.evaluate(() => {
        const before = _cloneState(state);
        const text = V2_BACKUP.serializeState(state);
        const restored = V2_BACKUP.parseBackup(text);
        return {
          exact: JSON.stringify(restored) === JSON.stringify(before),
          jobCount: restored.jobs.length,
          userCount: restored.users.length,
          noteCount: restored.dashboardNotes.length
        };
      });
      assert.deepEqual(backupRoundTripResult, { exact: true, jobCount: 1, userCount: 2, noteCount: 3 });

      const historicalBoundaryResult = await page.evaluate(() => {
        closeModal('unifiedJobModal');
        const currentJob = _cloneState(state.jobs[0]);
        const legacyJob = _cloneState(currentJob);
        legacyJob.id = 'browser-smoke-legacy-job';
        legacyJob.name = 'Browser Historical Client';
        legacyJob.createdVia = 'legacy';
        legacyJob.jobNotes = [{
          id: 'browser-smoke-legacy-note',
          text: 'Historical note remains visible',
          date: '2025-01-01'
        }];
        state.jobs = [currentJob, legacyJob];
        renderAll();
        editJob(legacyJob.id);
        const editBlocked = document.getElementById('unifiedJobModal').classList.contains('hidden') &&
          document.getElementById('alertModalMsg').textContent.includes('historical Tracker 1.0 record');
        closeModal('alertModal');
        openNotes('job', legacyJob.id);
        const notesReadOnly = document.body.innerText.includes('Historical read-only') &&
          document.querySelectorAll('#notesList .note-actions').length === 0;
        closeModal('notesModal');
        const clientHistory = clientJobHistorySection(state.clients[0]);
        const combinedClientHistory = clientHistory.includes('Job history (2)') &&
          clientHistory.includes('Browser Historical Client') &&
          clientHistory.includes('Historical');
        state.jobs = [currentJob];
        renderAll();
        return { editBlocked, notesReadOnly, combinedClientHistory };
      });
      assert.deepEqual(historicalBoundaryResult, { editBlocked: true, notesReadOnly: true, combinedClientHistory: true });

      const workspaceResult = await page.evaluate(() => {
        renderAll();
        switchTab('overview', document.querySelector('.tabs .tab[data-tab="overview"]'));
        openSettings();
        const settingsLabels = [...document.querySelectorAll('#settingsModal .settings-nav-btn')].map(btn => btn.textContent.trim());
        closeModal('settingsModal');
        return {
          overviewActive: document.getElementById('tab-overview').classList.contains('active'),
          attentionWidget: !!document.getElementById('summaryCards'),
          notesWidget: !!document.getElementById('overviewNotes'),
          activityLayout: (() => {
            const card = document.querySelector('#summaryCards .summary-card:first-child');
            return !!card && card.querySelector('.summary-label')?.textContent.trim() === 'Active Jobs' &&
              card.querySelector('.attention-secondary-block .summary-label')?.textContent.trim() === 'Recurring Services' &&
              !card.querySelector('.attention-secondary-block .summary-value')?.classList.contains('orange');
          })(),
          invoiceLayout: (() => {
            const card = document.querySelector('#summaryCards .summary-card:nth-child(2)');
            return !!card && card.querySelector('.summary-value.orange')?.textContent.includes('(') &&
              card.querySelector('.invoice-pending-label')?.textContent.trim() === 'Pending Invoices' &&
              card.querySelector('.invoice-pending-block .summary-value.orange')?.textContent.includes('(') &&
              card.querySelector('.invoice-pending-label')?.classList.contains('summary-label');
          })(),
          employeeHeaderControls: document.querySelectorAll('#summaryCards .summary-card-header .summary-card-select').length === 3,
          recentPayFilterPosition: (() => {
            const card = [...document.querySelectorAll('#summaryCards .summary-card')].find(item => item.querySelector('.summary-label')?.textContent.trim() === 'Recent Pay');
            const controls = card?.querySelector('.summary-card-header-controls');
            return !!card && controls?.querySelectorAll('.summary-card-select').length === 2 &&
              card.querySelector('.summary-card-header')?.nextElementSibling?.classList.contains('summary-value');
          })(),
          newJobUsesUnified: document.getElementById('newJobBtn')?.getAttribute('onclick') === 'openUnifiedJobModal()',
          activityHistoryEntry: (() => {
            openActivityHistory();
            const modal = document.getElementById('activityHistoryModal');
            const visible = modal && !modal.classList.contains('hidden');
            const intro = modal?.innerText.includes('audit trail');
            closeModal('activityHistoryModal');
            return visible && intro;
          })(),
          settingsLabels
        };
      });
      assert.equal(workspaceResult.overviewActive, true);
      assert.equal(workspaceResult.attentionWidget, true);
      assert.equal(workspaceResult.notesWidget, true);
      assert.equal(workspaceResult.activityLayout, true);
      assert.equal(workspaceResult.invoiceLayout, true);
      assert.equal(workspaceResult.employeeHeaderControls, true);
      assert.equal(workspaceResult.recentPayFilterPosition, true);
      assert.equal(workspaceResult.newJobUsesUnified, true);
      assert.equal(workspaceResult.activityHistoryEntry, true);
      assert.deepEqual(workspaceResult.settingsLabels, [
        'Appearance', 'Client display', 'Job defaults', 'Team & permissions',
        'Financial rules', 'Square integration', 'Data & backup', 'Temporary tools'
      ]);

      const employeePaymentEntryResult = await page.evaluate(() => {
        closeModal('unifiedJobModal');
        openEmployeePayment();
        const owedFlow = {
          modalOpen: !document.getElementById('splitPayModal').classList.contains('hidden'),
          defaultAmount: document.getElementById('sp_total')?.value,
          defaultDescription: document.getElementById('sp_label')?.value,
          otherEligibleWorkCollapsed: (() => {
            const details = document.getElementById('sp_otherAllocations');
            return !details || !details.open;
          })(),
          topClearButton: !!document.getElementById('sp_totalClearBtn'),
          clearButtonCount: document.querySelectorAll('#splitPayModal .sp-clear-btn').length,
          allocationRowCount: document.querySelectorAll('#splitPayModal .sp-alloc-input').length,
          employeeSelector: !!document.getElementById('sp_employee'),
        };
        closeModal('splitPayModal');
        openEmployeePaymentForSource('job', 'browser-smoke-job');
        const sourceFlow = {
          sourceRowCount: document.querySelectorAll('#splitPayModal .sp-alloc-input').length,
          sourceRowId: document.querySelector('#splitPayModal .sp-alloc-input')?.id,
          selectedEmployee: document.getElementById('sp_employee')?.value
        };
        closeModal('splitPayModal');
        openUnifiedJobModal('browser-smoke-job');
        return { owedFlow, sourceFlow };
      });
      assert.equal(employeePaymentEntryResult.owedFlow.modalOpen, true);
      assert.equal(employeePaymentEntryResult.owedFlow.defaultAmount, '0.00');
      assert.equal(employeePaymentEntryResult.owedFlow.defaultDescription, '');
      assert.equal(employeePaymentEntryResult.owedFlow.otherEligibleWorkCollapsed, true);
      assert.equal(employeePaymentEntryResult.owedFlow.topClearButton, true);
      assert.equal(employeePaymentEntryResult.owedFlow.clearButtonCount, employeePaymentEntryResult.owedFlow.allocationRowCount + 1);
      assert.equal(employeePaymentEntryResult.owedFlow.employeeSelector, true);
      assert.equal(employeePaymentEntryResult.sourceFlow.sourceRowCount, 1);
      assert.equal(employeePaymentEntryResult.sourceFlow.sourceRowId, 'sp_job_browser-smoke-job');
      assert.equal(employeePaymentEntryResult.sourceFlow.selectedEmployee, 'browser-smoke-employee');

      const paymentAllocationResult = await page.evaluate(() => {
        const owedJob = _cloneState(state.jobs[0]);
        owedJob.id = 'browser-smoke-owed-job';
        owedJob.name = 'Browser Owed Job';
        owedJob.quote = 500;
        owedJob.quoteItems = [{ ...owedJob.quoteItems[0], id: 'browser-smoke-owed-line', amount: 500 }];
        owedJob.milestones = [{ ...owedJob.milestones[0], id: 'browser-smoke-owed-milestone', amount: 500 }];
        owedJob.unifiedLines = [{ ...owedJob.unifiedLines[0], id: 'browser-smoke-owed-line', amount: 500 }];
        const advanceJob = _cloneState(owedJob);
        advanceJob.id = 'browser-smoke-advance-job';
        advanceJob.name = 'Browser Advance Job';
        advanceJob.quote = 250;
        advanceJob.quoteItems = [{ ...advanceJob.quoteItems[0], id: 'browser-smoke-advance-line', amount: 250 }];
        advanceJob.milestones = [{ ...advanceJob.milestones[0], id: 'browser-smoke-advance-milestone', amount: 250 }];
        advanceJob.unifiedLines = [{ ...advanceJob.unifiedLines[0], id: 'browser-smoke-advance-line', amount: 250 }];
        advanceJob.workCompleted = false;
        const completedJob = _cloneState(owedJob);
        completedJob.id = 'browser-smoke-completed-job';
        completedJob.name = 'Browser Completed Job';
        completedJob.status = 'complete';
        state.jobs = [state.jobs[0], owedJob, advanceJob, completedJob];

        openEmployeePayment({ employeeId: 'browser-smoke-employee' });
        let owedInputs = [...document.querySelectorAll('.sp-alloc-input')]
          .filter(input => Number(input.dataset.owed || 0) > 0.005);
        const maxOwedJob = owedInputs[0];
        fillSplitPayMax();
        const maxOwedResult = {
          total: document.getElementById('sp_total').value,
          amount: maxOwedJob.value,
          type: document.getElementById(maxOwedJob.id + '_type')?.value,
          completedJobHidden: !document.getElementById('sp_job_browser-smoke-completed-job')
        };
        const firstMaxTotal = document.getElementById('sp_total').value;
        closeModal('splitPayModal');
        openEmployeePayment({ employeeId: 'browser-smoke-employee' });
        const reopenedBeforeMax = document.getElementById('sp_total').value;
        fillSplitPayMax();
        const reopenedAfterMax = document.getElementById('sp_total').value;
        owedInputs = [...document.querySelectorAll('.sp-alloc-input')]
          .filter(input => Number(input.dataset.owed || 0) > 0.005);
        owedInputs.forEach(input => { input.value = ''; _inferSplitPayType(input); });
        updateSplitTotals();
        document.getElementById('sp_total').value = '100.00';
        owedInputs[0].value = '50.00';
        _inferSplitPayType(owedInputs[0]);
        maxAlloc(owedInputs[1].id);
        const partialAllocation = {
          total: document.getElementById('sp_total').value,
          first: owedInputs[0].value,
          second: owedInputs[1].value,
          firstType: document.getElementById(owedInputs[0].id + '_type')?.value,
          secondType: document.getElementById(owedInputs[1].id + '_type')?.value,
          remaining: document.getElementById('sp_totals').textContent.split(/\n/).map(line => line.trim()).filter(Boolean).join('\n')
        };
        owedInputs[0].value = '1000.00';
        _inferSplitPayType(owedInputs[0]);
        updateSplitTotals();
        const overBalanceType = document.getElementById(owedInputs[0].id + '_type')?.value;
        const overBalanceBreakdown = document.getElementById(owedInputs[0].id + '_breakdown')?.textContent;
        document.getElementById(owedInputs[0].id + '_type').value = 'final';
        updateSplitTotals();
        const finalOverBalanceBreakdown = document.getElementById(owedInputs[0].id + '_breakdown')?.textContent;

        document.querySelectorAll('.sp-alloc-input').forEach(input => { input.value = ''; _inferSplitPayType(input); });
        updateSplitTotals();
        document.getElementById('sp_total').value = (Number(owedInputs[0].dataset.owed) + 100).toFixed(2);
        maxAlloc(owedInputs[0].id);
        const firstExtraAllocation = owedInputs[0].value;
        maxAlloc(owedInputs[0].id);
        const extraAllocation = {
          amount: owedInputs[0].value,
          type: document.getElementById(owedInputs[0].id + '_type')?.value,
          firstClickAmount: firstExtraAllocation,
          owedAmount: Number(owedInputs[0].dataset.owed || 0).toFixed(2)
        };

        document.querySelectorAll('.sp-alloc-input').forEach(input => { input.value = ''; _inferSplitPayType(input); });
        updateSplitTotals();
        document.getElementById('sp_total').value = '-100.00';
        maxAlloc(owedInputs[0].id);
        const negativeAllocation = {
          amount: owedInputs[0].value,
          type: document.getElementById(owedInputs[0].id + '_type')?.value,
          breakdown: document.getElementById(owedInputs[0].id + '_breakdown')?.textContent
        };

        document.querySelectorAll('.sp-alloc-input').forEach(input => { input.value = ''; _inferSplitPayType(input); });
        updateSplitTotals();
        document.getElementById('sp_total').value = '100.00';
        const zeroBalanceInput = [...document.querySelectorAll('.sp-alloc-input')]
          .find(input => Math.abs(Number(input.dataset.owed || 0)) < 0.005);
        maxAlloc(zeroBalanceInput.id);
        const advanceAllocation = {
          zeroBalanceAmount: zeroBalanceInput.value,
          zeroBalanceType: document.getElementById(zeroBalanceInput.id + '_type')?.value,
          remaining: document.getElementById('sp_totals').textContent.split(/\n/).map(line => line.trim()).filter(Boolean).join('\n')
        };
        closeModal('splitPayModal');
        return {
          maxOwedResult,
          firstMaxTotal,
          reopenedBeforeMax,
          reopenedAfterMax,
          partialAllocation,
          overBalanceType,
          overBalanceBreakdown,
          finalOverBalanceBreakdown,
          extraAllocation,
          negativeAllocation,
          advanceAllocation,
          splitPayment: _splitEmployeePaymentAllocation(1000, 500, 'advance')
        };
      });
      assert.equal(paymentAllocationResult.maxOwedResult.type, '');
      assert.equal(paymentAllocationResult.maxOwedResult.completedJobHidden, true);
      assert.notEqual(paymentAllocationResult.maxOwedResult.total, '0.00');
      assert.equal(paymentAllocationResult.reopenedBeforeMax, '0.00');
      assert.equal(paymentAllocationResult.reopenedAfterMax, paymentAllocationResult.firstMaxTotal);
      assert.deepEqual(paymentAllocationResult.partialAllocation, {
        total: '100.00',
        first: '50.00',
        second: '50.00',
        firstType: '',
        secondType: '',
        remaining: 'Total $100.00\nAllocated $100.00\nRemaining $0.00'
      });
      assert.equal(paymentAllocationResult.overBalanceType, '');
      assert.match(paymentAllocationResult.overBalanceBreakdown, /General.*Advance/);
      assert.match(paymentAllocationResult.finalOverBalanceBreakdown, /Final Pay.*Advance/);
      assert.equal(paymentAllocationResult.extraAllocation.firstClickAmount, paymentAllocationResult.extraAllocation.owedAmount);
      assert.equal(Number(paymentAllocationResult.extraAllocation.amount), Number(paymentAllocationResult.extraAllocation.owedAmount) + 100);
      assert.equal(paymentAllocationResult.extraAllocation.type, '');
      assert.equal(paymentAllocationResult.negativeAllocation.amount, '-100.00');
      assert.equal(paymentAllocationResult.negativeAllocation.type, 'adjustment');
      assert.equal(paymentAllocationResult.negativeAllocation.breakdown, '');
      assert.deepEqual(paymentAllocationResult.splitPayment, [
        { amount: 500, payType: '' },
        { amount: 500, payType: 'advance' }
      ]);
      assert.equal(paymentAllocationResult.advanceAllocation.zeroBalanceAmount, '100.00');
      assert.equal(paymentAllocationResult.advanceAllocation.zeroBalanceType, 'advance');
      assert.match(paymentAllocationResult.advanceAllocation.remaining, /Remaining\s*\$0\.00/);

      const employeeOverviewResult = await page.evaluate(() => {
        const employee = state.users.find(user => !user.isAdmin);
        currentUser = { id: employee.id, name: employee.name, isAdmin: false };
        applyUserView();
        renderAll();
        const cards = [...document.querySelectorAll('#empSummaryCards .summary-card')];
        const invoiceCard = cards.find(card => card.querySelector('.summary-label')?.textContent.trim() === 'Outstanding Invoices');
        const recentPayCard = cards.find(card => card.querySelector('.summary-label')?.textContent.trim() === 'Recent Pay');
        const result = {
          invoiceCardVisible: !!invoiceCard,
          invoiceCardHasPendingSection: !!invoiceCard?.querySelector('.invoice-pending-label'),
          recentPayFilterInHeader: !!recentPayCard?.querySelector('.summary-card-header > .summary-card-select'),
          recentPayValueBelowHeader: recentPayCard?.querySelector('.summary-card-header')?.nextElementSibling?.classList.contains('summary-value') === true
        };
        currentUser = { id: 'browser-smoke-admin', name: 'Smoke Admin', isAdmin: true };
        applyUserView();
        renderAll();
        return result;
      });
      assert.deepEqual(employeeOverviewResult, {
        invoiceCardVisible: true,
        invoiceCardHasPendingSection: true,
        recentPayFilterInHeader: true,
        recentPayValueBelowHeader: true
      });

      const overviewNoteResult = await page.evaluate(() => {
        state.dashboardNotes = [];
        openOverviewNoteForm();
        document.getElementById('overviewNoteText').value = 'Browser smoke workspace note';
        toggleOverviewNoteToggle('overviewNotePinned');
        saveOverviewNote();
        const note = state.dashboardNotes[0];
        openOverviewNote(note.id);
        const openedText = document.getElementById('overviewNoteModalText').value;
        const modalPinnedBeforeEdit = document.getElementById('overviewNoteModalPinned').classList.contains('on');
        startOverviewNoteEdit();
        document.getElementById('overviewNoteModalText').value = 'Edited workspace note';
        toggleOverviewNoteToggle('overviewNoteModalPinned');
        saveOverviewNoteEdit();
        const modalStaysOpenAfterSave = !document.getElementById('overviewNoteModal').classList.contains('hidden') &&
          document.getElementById('overviewNoteModalText').readOnly;
        closeModal('overviewNoteModal');
        const expandedSavedText = state.dashboardNotes[0]?.text;
        document.querySelector('.overview-note-item button[title="Edit note"]')?.click();
        document.getElementById('overviewNoteModalText').value = 'Workspace-origin edited note';
        saveOverviewNoteEdit();
        return {
          openedText,
          savedText: expandedSavedText,
          modalPinnedBeforeEdit,
          savedPinned: state.dashboardNotes[0]?.pinned,
          modalStaysOpenAfterSave,
          workspaceOriginEditCloses: document.getElementById('overviewNoteModal').classList.contains('hidden'),
          workspaceOriginSavedText: state.dashboardNotes[0]?.text
        };
      });
      assert.deepEqual(overviewNoteResult, {
        openedText: 'Browser smoke workspace note',
        savedText: 'Edited workspace note',
        modalPinnedBeforeEdit: true,
        savedPinned: false,
        modalStaysOpenAfterSave: true,
        workspaceOriginEditCloses: true,
        workspaceOriginSavedText: 'Workspace-origin edited note'
      });

      const themeResult = await page.evaluate(() => {
        const inspect = theme => {
          applyTheme(theme);
          return {
            bodyClass: document.body.className,
            background: getComputedStyle(document.body).getPropertyValue('--bg').trim(),
            activeControls: document.querySelectorAll(`[data-theme-option="${theme}"].active`).length
          };
        };
        const result = {
          default: inspect('default'),
          highContrast: inspect('highContrast'),
          simple: inspect('simple')
        };
        applyTheme('default');
        return result;
      });
      assert.equal(themeResult.default.bodyClass.includes('high-contrast'), false);
      assert.equal(themeResult.default.bodyClass.includes('simple-theme'), false);
      assert.equal(themeResult.highContrast.bodyClass.includes('high-contrast'), true);
      assert.equal(themeResult.simple.bodyClass.includes('simple-theme'), true);
      assert.notEqual(themeResult.default.background, themeResult.simple.background);
      assert.equal(themeResult.default.activeControls > 0, true);
      assert.equal(themeResult.highContrast.activeControls > 0, true);
      assert.equal(themeResult.simple.activeControls > 0, true);

      const feeProtection = await page.evaluate(() => {
        const before = state.settings.feeRate;
        openSettings();
        document.getElementById('s_feeRate').value = '3.1';
        saveSettings();
        return {
          unchanged: state.settings.feeRate === before,
          confirmation: document.getElementById('confirmModalMsg').textContent,
          visible: !document.getElementById('confirmModal').classList.contains('hidden')
        };
      });
      assert.equal(feeProtection.unchanged, true);
      assert.equal(feeProtection.visible, true);
        assert.match(feeProtection.confirmation, /new jobs and new HomeWatch payments/i);
        assert.match(feeProtection.confirmation, /locked fee snapshots/i);
      await page.evaluate(() => {
        closeModal('confirmModal');
        closeModal('settingsModal');
      });

      await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        openPartialCollect(job.id);
        document.getElementById('pc_total').value = '40.00';
        setPartialAlloc(0, '40.00');
        document.getElementById('pc_note').value = 'Deposit';
        savePartialCollect();
      });
      await page.waitForFunction(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return job?.partialCollections?.length === 1 &&
          job.milestones?.some(item => item.partialState === 'paid') &&
          document.getElementById('partialCollectModal').classList.contains('hidden');
      });
      const dollarPartialResult = await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        const history = Tracker2History.paymentHistoryForJob(job);
        const paid = job.milestones.find(item => item.partialState === 'paid');
        const note = job.jobNotes.find(item => item.partialCollectionId === job.partialCollections[0].id);
        return {
          paymentTotal: job.partialCollections[0].paymentTotal,
          paidAmount: paid?.amount,
          history: history.map(item => ({ source: item.source, amount: item.amount })),
          linkedNote: !!note,
          dirty: previewSession.isDirty()
        };
      });
      assert.deepEqual(dollarPartialResult, {
        paymentTotal: 40,
        paidAmount: 40,
        history: [{ source: 'partial-collection', amount: 40 }],
        linkedNote: true,
        dirty: true
      });

      const dollarPartialId = await page.evaluate(() => state.jobs.find(item => item.id === 'browser-smoke-job').partialCollections[0].id);
      await page.evaluate(partialId => deletePartialCollection('browser-smoke-job', partialId), dollarPartialId);
      await page.waitForFunction(() => !document.getElementById('confirmModal').classList.contains('hidden'));
      await page.click('#confirmModalOk');
      await page.waitForFunction(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return job?.partialCollections?.length === 0 &&
          job?.milestones?.length === 1 &&
          job.milestones[0].status === 'pending' &&
          !job.jobNotes.some(item => item.partialCollectionId);
      });

      await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        openPartialCollect(job.id);
        document.getElementById('pc_mode').value = 'percent';
        onPartialModeChange();
        togglePartialInclude(0);
        document.getElementById('pc_percent').value = '50';
        updatePartialCollectTotals();
        document.getElementById('pc_note').value = 'Half payment';
        savePartialCollect();
      });
      await page.waitForFunction(() => state.jobs.find(item => item.id === 'browser-smoke-job')?.partialCollections?.length === 1);
      const percentPartialResult = await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        const history = Tracker2History.paymentHistoryForJob(job);
        return {
          mode: job.partialCollections[0].mode,
          partialPercent: job.partialCollections[0].partialPercent,
          paymentTotal: job.partialCollections[0].paymentTotal,
          historyCount: history.length,
          historySource: history[0]?.source
        };
      });
      assert.deepEqual(percentPartialResult, {
        mode: 'percent',
        partialPercent: 50,
        paymentTotal: 62.5,
        historyCount: 1,
        historySource: 'partial-collection'
      });

      await page.evaluate(() => {
        openSplitPay();
        document.getElementById('sp_total').value = '25.00';
        const allocation = document.getElementById('sp_job_browser-smoke-job');
        allocation.value = '25.00';
        updateSplitTotals();
        saveSplitPay();
      });
      await page.waitForFunction(() => state.splitPayments?.length === 1 && state.jobs[0].advances?.length === 1);
      const payoutLedgerInitial = await page.evaluate(() => {
        const rows = _getSplitLedgerEntries();
        return { total: rows[0]?.total, allocation: rows[0]?.allocations?.[0]?.amount };
      });
      assert.deepEqual(payoutLedgerInitial, { total: 25, allocation: 25 });

      await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        const advance = job.advances[0];
        openAddItem(job.id, 'advance', advance.id);
        document.getElementById('ai_amount').value = '10.00';
        saveItem();
      });
      await page.waitForFunction(() => state.jobs[0].advances[0].amount === 10);
      const payoutLedgerEdited = await page.evaluate(() => {
        const rows = _getSplitLedgerEntries();
        return { total: rows[0]?.total, allocation: rows[0]?.allocations?.[0]?.amount };
      });
      assert.deepEqual(payoutLedgerEdited, { total: 10, allocation: 10 });

      await page.evaluate(() => removeItem('browser-smoke-job', 'advances', 0));
      await page.waitForFunction(() => _getSplitLedgerEntries().length === 0);

      const signedPayDisplay = await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        job.advances = [
          { id: 'browser-smoke-advance', label: 'Advance', amount: 100, date: '2026-01-02', payType: 'advance' },
          { id: 'browser-smoke-adjustment', label: 'Advance reversal', amount: -100, date: '2026-01-03', payType: 'adjustment' }
        ];
        const html = jobDetail(job, calcJob(job));
        return {
          hasDoubleNegative: html.includes('--$100.00'),
          hasReversalAmount: html.includes('>-$100.00<'),
          hasNetPaidLabel: html.includes('Net paid out'),
          netAdvanceAmount: calcJob(job).advancesPaid
        };
      });
      assert.deepEqual(signedPayDisplay, {
        hasDoubleNegative: false,
        hasReversalAmount: true,
        hasNetPaidLabel: true,
        netAdvanceAmount: 0
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
        return previewSession.isDirty() &&
          document.getElementById('unifiedJobModal').classList.contains('hidden') &&
          job?.unifiedLines?.[0]?.description === 'Temporary work';
      });

      const changedResult = await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return {
          description: job.unifiedLines[0].description,
          note: job.jobNotes[0].text,
          dirty: previewSession.isDirty()
        };
      });
      assert.deepEqual(changedResult, { description: 'Temporary work', note: 'Temporary note', dirty: true });

      await page.evaluate(() => discardPreviewChanges());
      await page.waitForFunction(() => !document.getElementById('confirmModal').classList.contains('hidden'));
      await page.click('#confirmModalOk');
      await page.waitForFunction(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return !previewSession.isDirty() &&
          document.getElementById('confirmModal').classList.contains('hidden') &&
          job?.unifiedLines?.[0]?.description === 'Initial work';
      });

      const discardedResult = await page.evaluate(() => {
        const job = state.jobs.find(item => item.id === 'browser-smoke-job');
        return {
          description: job.unifiedLines[0].description,
          note: job.jobNotes[0].text,
          dirty: previewSession.isDirty()
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
