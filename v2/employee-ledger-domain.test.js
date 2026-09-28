'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLedgerFromLegacy,
  buildLedgerFromStoredEvents,
  getLedgerEntries
} = require('./employee-ledger-domain');

test('reconstructs stored ledger allocations from linked advances and hides deleted ghost events', () => {
  const state = {
    jobs: [{ id: 'job-1', name: 'Job One', employeeId: 'emp', advances: [{ id: 'advance-1', amount: 25, date: '2026-09-28', splitEventId: 'event-1' }] }],
    splitPayments: [
      { id: 'event-1', date: '2026-09-28', label: 'Payment', total: 999, allocations: [{ sourceKind: 'job', sourceId: 'job-1', amount: 999, advanceId: 'advance-1' }] },
      { id: 'deleted-event', date: '2026-09-27', label: 'Deleted', total: 50, allocations: [{ sourceKind: 'job', sourceId: 'job-1', amount: 50, advanceId: 'deleted-advance' }] },
      { id: 'old-event', date: '2026-09-26', label: 'Old event', total: 10, allocations: [{ sourceKind: 'job', sourceId: 'job-1', amount: 10 }] }
    ]
  };
  const result = buildLedgerFromStoredEvents(state);
  assert.deepEqual(result.rows.map(row => row.id), ['stored:event-1', 'stored:old-event']);
  assert.equal(result.rows[0].total, 25);
  assert.equal(result.rows[0].allocations[0].advanceId, 'advance-1');
  assert.equal(result.byEventId['event-1'].label, 'Payment');
});

test('reconstructs legacy split rows without duplicating stored events', () => {
  const state = {
    jobs: [{
      id: 'job-1', name: 'Job One', employeeId: 'emp', advances: [
        { id: 'a-1', amount: 50, date: '2026-09-28', label: 'Split Payment', payType: '' },
        { id: 'a-2', amount: 25, date: '2026-09-28', label: 'Split Payment', payType: 'advance' },
        { id: 'a-3', amount: 10, date: '2026-09-27', label: 'Ordinary advance', payType: 'advance' },
        { id: 'a-4', amount: 5, date: '2026-09-26', label: 'Old stored', splitEventId: 'event-1' }
      ]
    }],
    splitPayments: [{ id: 'event-1', label: 'Stored event' }]
  };
  const result = buildLedgerFromLegacy(state, { 'event-1': state.splitPayments[0] });
  assert.deepEqual(result.map(row => ({ label: row.label, total: row.total, employeeId: row.employeeId })), [
    { label: 'Split Payment', total: 75, employeeId: 'emp' }
  ]);
});

test('labels potential legacy rows and leaves ambiguous employee groups unassigned', () => {
  const state = {
    jobs: [
      { id: 'job-1', name: 'One', employeeId: 'emp-1', advances: [{ amount: 40, date: '2026-09-01', label: 'Pay Out (Potential)' }] },
      { id: 'job-2', name: 'Two', employeeId: 'emp-2', advances: [{ amount: 60, date: '2026-09-01', label: 'Pay Out (Potential)' }] }
    ]
  };
  const [row] = buildLedgerFromLegacy(state);
  assert.equal(row.mode, 'potential');
  assert.equal(row.total, 100);
  assert.equal(row.employeeId, '');
});

test('combines stored and legacy rows in newest-first order without mutating state', () => {
  const state = {
    jobs: [{ id: 'job-1', name: 'Job', employeeId: 'emp', advances: [{ amount: 25, date: '2026-09-28', label: 'Split payment' }] }],
    splitPayments: [{ id: 'event-1', date: '2026-09-29', label: 'Stored', total: 10, allocations: [{ amount: 10 }] }]
  };
  const before = JSON.stringify(state);
  assert.deepEqual(getLedgerEntries(state).map(row => row.id), ['stored:event-1', 'legacy:2026-09-28||Split payment']);
  assert.equal(JSON.stringify(state), before);
});
