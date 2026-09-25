'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateState, normalizeCurrentState, normalizeLegacyState } = require('./state-domain');

function fixture() {
  return {
    settings: {
      historicalAdj: 123,
      empShare: 0.7,
      defaultMilestoneBasis: 'invalid',
      square: null
    },
    debtPayments: [{}],
    splitPayments: [{}],
    users: [{ id: 'employee-1', name: 'Employee', isAdmin: false }],
    appointments: [{}],
    clients: [{ id: 'client-1', clientNotes: 'Old note' }],
    homewatch: [{ id: 'hw-1', payments: [{}], advances: [{}] }],
    jobs: [{
      id: 'job-1',
      date: '2026-01-01',
      jobType: 'hourly2',
      notes: 'Old job note',
      milestones: [{ id: 'milestone-1', collected: true }],
      addOns: [{ id: 'add-on-1', collected: false }],
      partialCollections: [{}]
    }]
  };
}

test('exposes separate legacy and current normalization passes', () => {
  const state = fixture();
  normalizeLegacyState(state, { idFactory: () => 'legacy-id', today: () => '2026-09-25' });

  assert.equal(state.settings.debtOriginal, 123);
  assert.equal(state.jobs[0].jobType, 'hourly');
  assert.equal(state.jobs[0].milestones[0].status, 'collected');
  assert.equal(state.settings.square, null);

  normalizeCurrentState(state, { clientColumnKeys: ['email'] });

  assert.deepEqual(state.settings.square, { functionBaseUrl: '', highValueConfirmAmount: 1000 });
  assert.equal(state.jobs[0].jobType, 'hourly');
});

test('normalizes legacy state in place while preserving migration behavior', () => {
  const state = fixture();
  let nextId = 1;
  const result = migrateState(state, {
    idFactory: () => `generated-${nextId++}`,
    today: () => '2026-09-25',
    clientColumnKeys: ['email', 'phone']
  });

  assert.equal(result, state);
  assert.equal(state.settings.debtOriginal, 123);
  assert.equal(state.settings.historicalAdj, undefined);
  assert.deepEqual(state.settings.square, { functionBaseUrl: '', highValueConfirmAmount: 1000 });
  assert.deepEqual(state.settings.clientExpandCols, ['email', 'phone']);
  assert.equal(state.splitPayments[0].id, 'generated-3');
  assert.equal(state.splitPayments[0].date, '2026-09-25');
  assert.equal(state.debtPayments[0].linkedJobId, null);
  assert.equal(state.appointments[0].contactName, '');
  assert.deepEqual(state.clients[0].clientNotes, [{
    id: 'generated-1',
    text: 'Old note',
    date: '2026-09-25',
    authorId: '',
    authorName: 'Admin'
  }]);
  assert.equal(state.users[0].empShare, 0.7);
  assert.deepEqual(state.users[0].clientPrefs, {});
  assert.equal(state.users[0].uiPrefs.theme, 'default');
  assert.equal(state.homewatch[0].employeeId, 'employee-1');
  assert.equal(state.homewatch[0].payments[0].billingState, 'none');
  assert.equal(state.homewatch[0].advances[0].splitEventId, '');
  assert.equal(state.jobs[0].jobType, 'hourly');
  assert.equal(state.jobs[0].employeeId, 'employee-1');
  assert.deepEqual(state.jobs[0].jobNotes, [{
    id: 'generated-2',
    text: 'Old job note',
    date: '2026-01-01'
  }]);
  assert.equal(state.jobs[0].notes, undefined);
  assert.equal(state.jobs[0].milestones[0].status, 'collected');
  assert.equal(state.jobs[0].milestones[0].collected, undefined);
  assert.equal(state.jobs[0].addOns[0].status, 'pending');
  assert.equal(state.jobs[0].addOns[0].collected, undefined);
  assert.equal(state.jobs[0].partialCollections[0].id, 'generated-4');
  assert.equal(state.jobs[0].partialCollections[0].snapshotBefore.revenueItems.length, 0);
});

test('does not replace existing normalized values', () => {
  const state = {
    settings: {
      empName: 'Ty',
      debtOriginal: 500,
      debtOwnerShare: 0.4,
      txnFee: 0.25,
      defaultMilestones: [{ label: 'Deposit', pct: 50 }],
      defaultMilestoneBasis: 'amount',
      square: { functionBaseUrl: 'https://example.test', highValueConfirmAmount: 2000 },
      owedSummaryInclude: { jobs: false, homewatch: true, potential: false },
      clientColumns: ['city'],
      clientExpandCols: ['email'],
      clientQuickCols: ['phone']
    },
    debtPayments: [{ linkedJobId: 'job-1', linkedHWId: null }],
    splitPayments: [{ id: 'split-1', date: '2026-01-01', label: 'Existing', total: 10, mode: 'split', employeeId: 'employee-1', allocations: [], createdAt: '2026-01-01' }],
    users: [{ id: 'employee-1', name: 'Employee', isAdmin: false, empShare: 0.55, clientPrefs: { compact: true }, uiPrefs: { theme: 'simple' } }],
    appointments: [{ contactName: 'Contact', endTime: '12:00' }],
    clients: [{ id: 'client-1', clientNotes: [{ id: 'note-1', text: 'Existing' }] }],
    homewatch: [],
    jobs: [{
      id: 'job-1',
      employeeId: 'employee-1',
      jobType: 'quoted',
      hourlyRate: 25,
      workCompleted: false,
      milestoneBasis: 'amount',
      hourlyStatus: 'complete',
      hourlySquareInvoiceId: 'invoice-1',
      repaymentMode: true,
      contactName: 'Contact',
      jobNotes: [],
      hours: [],
      advances: [],
      tips: [],
      milestones: [],
      addOns: [],
      revenueItems: [],
      subtractions: [],
      isItemized: true,
      quoteItems: [],
      partialCollections: []
    }]
  };

  migrateState(state, { idFactory: () => 'unexpected', today: () => 'unexpected', clientColumnKeys: ['unexpected'] });

  assert.equal(state.settings.debtOriginal, 500);
  assert.equal(state.settings.defaultMilestoneBasis, 'amount');
  assert.deepEqual(state.settings.square, { functionBaseUrl: 'https://example.test', highValueConfirmAmount: 2000 });
  assert.deepEqual(state.settings.owedSummaryInclude, { jobs: false, homewatch: true, potential: false });
  assert.deepEqual(state.settings.clientColumns, ['city']);
  assert.deepEqual(state.settings.clientExpandCols, ['email']);
  assert.deepEqual(state.settings.clientQuickCols, ['phone']);
  assert.equal(state.splitPayments[0].id, 'split-1');
  assert.equal(state.users[0].uiPrefs.theme, 'simple');
  assert.deepEqual(state.clients[0].clientNotes, [{ id: 'note-1', text: 'Existing' }]);
  assert.equal(state.jobs[0].jobType, 'quoted');
  assert.equal(state.jobs[0].workCompleted, false);
  assert.equal(state.jobs[0].milestoneBasis, 'amount');
});

test('seeds the default admin when no users exist', () => {
  const state = {
    settings: {},
    debtPayments: [],
    splitPayments: [],
    users: [],
    appointments: [],
    clients: [],
    homewatch: [],
    jobs: []
  };

  migrateState(state, { clientColumnKeys: [] });

  assert.deepEqual(state.users, [{ id: 'admin_default', name: 'Ty', pin: '1234', isAdmin: true, clientPrefs: {}, uiPrefs: { theme: 'default' } }]);
});
