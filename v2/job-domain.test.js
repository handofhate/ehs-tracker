const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyProtectedEdits,
  buildCollections,
  buildMilestones,
  buildUnifiedJobRecord,
  normalizeLegacyJob,
  validateJobDraft
} = require('./job-domain');

function ids() {
  let n = 0;
  return () => `test-${++n}`;
}

test('validates a normal fixed-labor draft', () => {
  const result = validateJobDraft({
    name: 'Client',
    lines: [{ id: 'line-1', type: 'fixed', amount: 250 }]
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('reports all basic draft validation failures', () => {
  const result = validateJobDraft({
    name: '',
    lines: [{ id: 'line-1', type: 'material', amount: 0, reimbursementAmount: 0, billClient: true }]
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'Please enter a client name.',
    'Materials need a reimbursement / cost amount greater than $0.',
    'Billed materials need a client charge greater than $0, or turn off billing for that material.'
  ]);
});

test('allows internal materials without a client charge', () => {
  const result = validateJobDraft({
    name: 'Client',
    lines: [{ id: 'material-1', type: 'material', amount: 0, reimbursementAmount: 40, billClient: false }]
  });
  assert.equal(result.ok, true);
});

test('protects financially locked hourly jobs from new non-hourly lines', () => {
  const result = validateJobDraft({
    name: 'Client',
    existingJob: { jobType: 'hourly', unifiedLines: [{ id: 'old-hour', type: 'hourly' }] },
    financialLocked: true,
    lines: [
      { id: 'old-hour', type: 'hourly', amount: 100 },
      { id: 'new-credit', type: 'credit', amount: 10 }
    ]
  });
  assert.deepEqual(result.errors, ['Hourly jobs can add hours or materials only.']);
});

test('protected edits preserve billed material amounts while allowing settlement changes', () => {
  const existing = {
    id: 'job-locked',
    date: '2026-09-01',
    unifiedLines: [
      { id: 'material-1', type: 'material', label: 'Part', amount: 100, reimbursementAmount: 80, who: 'owner', billClient: true },
      { id: 'labor-1', type: 'fixed', label: 'Labor', amount: 200 }
    ],
    materials: [{
      id: 'material-1', label: 'Part', amount: 80, clientAmount: 100,
      reimbursementAmount: 80, costAmount: 80, who: 'owner', billClient: true
    }],
    addOns: [{ id: 'charge-1', sourceItemId: 'material-1', chargeType: 'materials', amount: 100 }],
    quoteItems: [{ id: 'labor-1', label: 'Labor', amount: 200 }],
    jobNotes: []
  };
  const changes = [];
  const syncs = [];
  const next = applyProtectedEdits({
    job: existing,
    lines: [
      { id: 'material-1', type: 'material', label: 'Part', description: 'Updated part', amount: 50, reimbursementAmount: 90, who: 'emp', billClient: false },
      { id: 'labor-1', type: 'fixed', label: 'Labor', description: 'Updated labor', amount: 1 },
      { id: 'new-labor', type: 'fixed', label: 'Extra labor', description: 'New addition', amount: 40 }
    ],
    contactName: 'Manager',
    notes: 'Settlement adjustment',
    isMaterialBillingLocked: (_job, id) => id === 'material-1',
    recordMaterialChange: (material, before) => changes.push({ material, before }),
    syncMaterialCharge: (job, material) => syncs.push({ job, material }),
    idFactory: ids()
  });

  const material = next.materials.find(item => item.id === 'material-1');
  assert.equal(next.unifiedLines.find(line => line.id === 'material-1').amount, 100);
  assert.equal(next.unifiedLines.find(line => line.id === 'material-1').billClient, true);
  assert.equal(material.reimbursementAmount, 90);
  assert.equal(material.who, 'emp');
  assert.equal(material.clientAmount, 100);
  assert.equal(material.billClient, true);
  assert.equal(next.unifiedLines.find(line => line.id === 'new-labor').unifiedAddition, true);
  assert.equal(next.addOns.find(item => item.id === 'new-labor').amount, 40);
  assert.equal(next.jobNotes[0].text, 'Settlement adjustment');
  assert.equal(changes.length, 1);
  assert.equal(syncs.length, 1);
  assert.equal(existing.materials[0].reimbursementAmount, 80);
});

test('builds a new unified job without mutating its inputs', () => {
  const collections = {
    quoteItems: [{ id: 'labor-1', label: 'Install', amount: 300 }],
    materials: [{ id: 'mat-1', label: 'Part', amount: 25, reimbursementAmount: 25, who: 'owner', billClient: true }],
    addOns: [{ id: 'charge-1', label: 'Part', amount: 25, chargeType: 'materials' }],
    subtractions: []
  };
  const lines = [
    { id: 'labor-1', type: 'fixed', label: 'Install', description: 'Install', amount: 300 },
    { id: 'mat-1', type: 'material', label: 'Part', description: 'Part', amount: 25, reimbursementAmount: 25, who: 'owner', billClient: true }
  ];
  const inputCollections = JSON.parse(JSON.stringify(collections));
  const inputLines = JSON.parse(JSON.stringify(lines));
  const job = buildUnifiedJobRecord({
    draft: {
      name: 'Client',
      contactName: 'Manager',
      date: '2026-09-25',
      clientId: 'client-1',
      employeeId: 'employee-1',
      workCompleted: true,
      jobType: 'quoted',
      milestoneBasis: 'percent',
      notes: 'Install details',
      lines,
      author: { id: 'admin-1', name: 'Admin' }
    },
    collections,
    milestones: [{ id: 'milestone-1', label: 'Invoice', pct: 100, status: 'pending' }],
    idFactory: ids()
  });

  assert.equal(job.id, 'test-1');
  assert.equal(job.createdVia, 'unified-v2');
  assert.equal(job.quote, 300);
  assert.equal(job.clientId, 'client-1');
  assert.equal(job.employeeId, 'employee-1');
  assert.equal(job.workSummary, 'Install, Part');
  assert.equal(job.jobNotes[0].source, 'unified-job');
  assert.equal(job.jobNotes[0].text, 'Install details');
  assert.deepEqual(collections, inputCollections);
  assert.deepEqual(lines, inputLines);
});

test('preserves an existing job identity and unrelated history when rebuilding', () => {
  const existing = {
    id: 'job-1',
    status: 'complete',
    advances: [{ id: 'advance-1', amount: 20 }],
    jobNotes: [{ id: 'note-1', text: 'Old note', date: '2026-09-01', source: 'unified-job' }]
  };
  const job = buildUnifiedJobRecord({
    existingJob: existing,
    draft: {
      name: 'Renamed Client',
      date: '2026-09-25',
      clientId: 'client-1',
      employeeId: 'employee-1',
      notes: 'Updated note',
      primaryNoteId: 'note-1',
      lines: [{ id: 'line-1', type: 'fixed', description: 'Work', amount: 100 }]
    },
    collections: { quoteItems: [{ id: 'line-1', label: 'Work', amount: 100 }] },
    idFactory: ids()
  });

  assert.equal(job.id, 'job-1');
  assert.equal(job.status, 'complete');
  assert.deepEqual(job.advances, [{ id: 'advance-1', amount: 20 }]);
  assert.equal(job.jobNotes[0].text, 'Updated note');
});

test('normalizes legacy jobs into read-only unified views without mutating them', () => {
  const legacy = {
    id: 'legacy-1',
    name: 'Old Client',
    quoteItems: [{ id: 'q-1', label: 'Quoted work', amount: 200 }],
    addOns: [{ id: 'a-1', label: 'Hours', amount: 50, isHours: true, hours: 2, rate: 25 }],
    materials: [{ id: 'm-1', label: 'Part', amount: 30, billClient: false }],
    subtractions: [{ id: 's-1', label: 'Credit', amount: 10 }]
  };
  const normalized = normalizeLegacyJob(legacy);

  assert.equal(normalized.createdVia, 'legacy');
  assert.equal(normalized.legacy, true);
  assert.equal(normalized.readOnly, true);
  assert.deepEqual(normalized.unifiedLines.map(line => line.type), ['fixed', 'hourly', 'material', 'credit']);
  assert.equal(legacy.unifiedLines, undefined);
});

test('builds unified collections while preserving prior billing history and unrelated additions', () => {
  const existing = {
    unifiedLines: [
      { id: 'labor-1', type: 'fixed' },
      { id: 'material-1', type: 'material' }
    ],
    quoteItems: [{ id: 'labor-1', label: 'Install', amount: 300, status: 'paid' }],
    materials: [{ id: 'material-1', label: 'Part', amount: 80, reimbursementAmount: 80, who: 'owner' }],
    addOns: [
      { id: 'charge-1', sourceItemId: 'material-1', chargeType: 'materials', amount: 100, status: 'collected' },
      { id: 'old-addition', label: 'Legacy addition', amount: 15, status: 'paid' }
    ],
    subtractions: [{ id: 'old-credit', label: 'Legacy credit', amount: 5, status: 'collected' }]
  };
  const before = JSON.parse(JSON.stringify(existing));
  const collections = buildCollections({
    job: existing,
    date: '2026-09-25',
    lines: [
      { id: 'labor-1', type: 'fixed', label: 'Install updated', description: 'Updated install', amount: 350 },
      { id: 'material-1', type: 'material', label: 'Part', description: 'Part', amount: 120, reimbursementAmount: 90, who: 'employee', billClient: true },
      { id: 'hour-1', type: 'hourly', label: 'Extra time', description: 'Extra time', amount: 50, hours: 2, rate: 25 },
      { id: 'credit-1', type: 'credit', label: 'Courtesy credit', description: 'Credit', amount: 20 }
    ],
    idFactory: ids()
  });

  assert.equal(collections.quoteItems[0].amount, 350);
  assert.equal(collections.quoteItems[0].status, 'paid');
  assert.equal(collections.materials[0].reimbursementAmount, 90);
  assert.equal(collections.addOns.find(item => item.sourceItemId === 'material-1').id, 'charge-1');
  assert.equal(collections.addOns.find(item => item.id === 'hour-1').chargeType, 'hourly');
  assert.equal(collections.addOns.find(item => item.id === 'old-addition').status, 'paid');
  assert.equal(collections.subtractions.find(item => item.id === 'credit-1').status, 'pending');
  assert.deepEqual(existing, before);
});

test('omits client-facing material charges for hourly-only jobs', () => {
  const collections = buildCollections({
    hourlyOnly: true,
    date: '2026-09-25',
    lines: [{ id: 'material-1', type: 'material', label: 'Part', amount: 100, reimbursementAmount: 75, billClient: true }],
    idFactory: ids()
  });

  assert.equal(collections.materials.length, 1);
  assert.equal(collections.addOns.length, 0);
});

test('builds single and custom milestone schedules with stable statuses', () => {
  const single = buildMilestones({
    mode: 'single',
    basis: 'amount',
    target: 450,
    existing: [{ id: 'milestone-1', label: 'Old invoice', amount: 200, status: 'collected' }],
    idFactory: ids()
  });
  assert.deepEqual(single.milestones[0], {
    id: 'milestone-1',
    label: 'Invoice',
    amount: 450,
    pct: 100,
    status: 'collected'
  });

  const custom = buildMilestones({
    mode: 'custom',
    basis: 'percent',
    entries: [
      { value: 25, label: 'Start', preset: { id: 'start-1', status: 'collected' } },
      { value: 75, label: 'Finish', preset: {} }
    ],
    idFactory: ids()
  });
  assert.deepEqual(custom.milestones.map(item => ({ id: item.id, label: item.label, pct: item.pct, status: item.status })), [
    { id: 'start-1', label: 'Start', pct: 25, status: 'collected' },
    { id: 'test-1', label: 'Finish', pct: 75, status: 'pending' }
  ]);
});

test('rejects custom milestone schedules that do not reach their target', () => {
  const result = buildMilestones({
    mode: 'custom',
    basis: 'amount',
    target: 100,
    entries: [{ value: 40, label: 'Deposit' }],
    idFactory: ids()
  });

  assert.equal(result.ok, false);
  assert.equal(result.milestones, null);
  assert.deepEqual(result.error, { basis: 'amount', total: 40, expected: 100 });
});
