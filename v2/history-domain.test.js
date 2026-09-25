const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClientHistory, jobsForClient, jobBelongsToClient } = require('./history-domain');

function mixedRecords() {
  return {
    client: {
      id: 'client-1',
      firstName: 'Alex',
      surname: 'Example',
      email: 'alex@example.test',
      clientNotes: [{ id: 'client-note-1', text: 'Prefers email', date: '2026-01-05' }]
    },
    jobs: [
      {
        id: 'unified-job',
        createdVia: 'unified-v2',
        clientId: 'client-1',
        name: 'Alex Example',
        date: '2026-09-01',
        quote: 200,
        quoteItems: [{ id: 'quote-1', label: 'Install', amount: 200 }],
        unifiedLines: [{ id: 'quote-1', type: 'fixed', label: 'Install', amount: 200 }],
        milestones: [{ id: 'milestone-1', label: 'Invoice', pct: 100, status: 'collected' }],
        jobNotes: [{ id: 'job-note-1', text: 'New workflow note', date: '2026-09-01' }],
        advances: [{ id: 'advance-1', amount: 50, date: '2026-09-02', payType: 'advance' }]
      },
      {
        id: 'legacy-job',
        name: 'Alex Example',
        date: '2025-05-01',
        quote: 100,
        quoteItems: [{ id: 'legacy-line', label: 'Old work', amount: 100 }],
        milestones: [{ id: 'legacy-milestone', label: 'Invoice', pct: 100, status: 'paid' }],
        jobNotes: [{ id: 'legacy-note', text: 'Legacy note', date: '2025-05-01' }],
        advances: [{ id: 'legacy-advance', amount: 25, date: '2025-05-02' }]
      },
      {
        id: 'other-client-job',
        clientId: 'client-2',
        name: 'Alex Example',
        date: '2026-10-01',
        quoteItems: [{ id: 'other-line', label: 'Other work', amount: 500 }]
      }
    ]
  };
}

test('matches direct-ID and legacy name-linked jobs in newest-first order', () => {
  const { client, jobs } = mixedRecords();
  const original = JSON.parse(JSON.stringify(jobs));
  const result = jobsForClient(jobs, client);

  assert.deepEqual(result.map(job => job.id), ['unified-job', 'legacy-job']);
  assert.equal(result[0].legacy, undefined);
  assert.equal(result[1].legacy, true);
  assert.equal(result[1].readOnly, true);
  assert.equal(result[1].unifiedLines[0].type, 'fixed');
  assert.deepEqual(jobs, original);
  assert.equal(jobBelongsToClient(jobs[2], client), false);
});

test('builds one client history with jobs, notes, payments, and employee pay', () => {
  const { client, jobs } = mixedRecords();
  const history = buildClientHistory({
    client,
    jobs,
    calculateJob: job => ({ contractTotal: job.quote || 0, legacy: !!job.legacy })
  });

  assert.equal(history.client.id, 'client-1');
  assert.deepEqual(history.jobs.map(job => job.id), ['unified-job', 'legacy-job']);
  assert.deepEqual(history.jobSummaries.map(summary => summary.calculations), [
    { contractTotal: 200, legacy: false },
    { contractTotal: 100, legacy: true }
  ]);
  assert.deepEqual(history.notes.map(note => note.id), ['client-note-1', 'job-note-1', 'legacy-note']);
  assert.deepEqual(history.payments.map(payment => ({ id: payment.id, amount: payment.amount })), [
    { id: 'milestone-1', amount: 200 },
    { id: 'legacy-milestone', amount: 100 }
  ]);
  assert.deepEqual(history.employeePay.map(payment => ({ id: payment.id, amount: payment.amount })), [
    { id: 'advance-1', amount: 50 },
    { id: 'legacy-advance', amount: 25 }
  ]);
  assert.ok(history.timeline.some(item => item.type === 'payment' && item.jobId === 'legacy-job'));
});

test('preserves partial collection and tip details as history events', () => {
  const { client } = mixedRecords();
  const job = {
    id: 'partial-job',
    clientId: client.id,
    name: 'Alex Example',
    date: '2026-08-01',
    createdVia: 'unified-v2',
    partialCollections: [{ id: 'partial-1', date: '2026-08-10', paymentTotal: 75, tipAmount: 10, note: 'Deposit' }]
  };
  const history = buildClientHistory({ client, jobs: [job] });

  assert.deepEqual(history.payments, [{
    id: 'partial-1',
    source: 'partial-collection',
    jobId: 'partial-job',
    label: 'Deposit',
    amount: 75,
    tipAmount: 10,
    date: '2026-08-10',
    item: job.partialCollections[0]
  }]);
});
