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

  assert.equal(state.settings.historicalAdj, 123);
  assert.equal(state.jobs[0].jobType, 'hourly2');
  assert.equal(state.jobs[0].milestones[0].collected, true);
  assert.equal(state.jobs[0].partialCollections[0].id, 'legacy-id');
  assert.equal(state.settings.square, null);

  normalizeCurrentState(state, { clientColumnKeys: ['email'] });

  assert.deepEqual(state.settings.square, { functionBaseUrl: '', highValueConfirmAmount: 1000 });
  assert.equal(state.jobs[0].jobType, 'quoted');
});

test('keeps historical partial compatibility after retiring zero-count conversions', () => {
  const state = fixture();
  let nextId = 1;
  const result = migrateState(state, {
    idFactory: () => `generated-${nextId++}`,
    today: () => '2026-09-25',
    clientColumnKeys: ['email', 'phone']
  });

  assert.equal(result, state);
  assert.equal(state.settings.debtOriginal, 2256.58);
  assert.equal(state.settings.historicalAdj, 123);
  assert.deepEqual(state.settings.square, { functionBaseUrl: '', highValueConfirmAmount: 1000 });
  assert.deepEqual(state.settings.clientExpandCols, ['email', 'phone']);
  assert.equal(state.splitPayments[0].id, 'generated-2');
  assert.equal(state.splitPayments[0].date, '2026-09-25');
  assert.equal(state.debtPayments[0].linkedJobId, null);
  assert.equal(state.appointments[0].contactName, '');
  assert.deepEqual(state.clients[0].clientNotes, []);
  assert.equal(state.users[0].empShare, undefined);
  assert.deepEqual(state.users[0].clientPrefs, {});
  assert.equal(state.users[0].uiPrefs.theme, 'default');
  assert.equal(state.homewatch[0].employeeId, 'employee-1');
  assert.equal(state.homewatch[0].payments[0].billingState, 'none');
  assert.equal(state.homewatch[0].advances[0].splitEventId, '');
  assert.equal(state.jobs[0].jobType, 'quoted');
  assert.equal(state.jobs[0].employeeId, 'employee-1');
  assert.deepEqual(state.jobs[0].jobNotes, []);
  assert.equal(state.jobs[0].notes, 'Old job note');
  assert.equal(state.jobs[0].milestones[0].status, 'pending');
  assert.equal(state.jobs[0].milestones[0].collected, true);
  assert.equal(state.jobs[0].addOns[0].status, 'pending');
  assert.equal(state.jobs[0].addOns[0].collected, false);
  assert.equal(state.jobs[0].partialCollections[0].id, 'generated-1');
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

test('keeps client display defaults separate from each users personal preferences', () => {
  const state = {
    settings: {
      clientColumns: ['city'],
      clientExpandCols: ['email', 'phone'],
      clientQuickCols: ['lastVisit']
    },
    debtPayments: [],
    splitPayments: [],
    users: [{ id: 'admin-1', isAdmin: true, clientPrefs: { clientColumns: ['email'] } }],
    appointments: [],
    clients: [],
    homewatch: [],
    jobs: []
  };

  migrateState(state, { clientColumnKeys: ['email', 'phone', 'city', 'lastVisit'] });

  assert.deepEqual(state.settings.clientDefaults, {
    columns: ['city'],
    expandCols: ['email', 'phone'],
    quickCols: ['lastVisit']
  });
  assert.deepEqual(state.users[0].clientPrefs, { clientColumns: ['email'] });
});

test('normalizes Overview workspace notes without losing audience, completion, or pin state', () => {
  const state = {
    settings: {},
    dashboardNotes: [
      { text: ' Team follow-up ', audience: 'team', done: true, pinned: true, authorId: 'u1' },
      { text: '', audience: 'admin' },
      { text: 'Admin reminder', audience: 'admin', done: false, authorName: 'Ty' }
    ],
    debtPayments: [],
    splitPayments: [],
    users: [{ id: 'u1', name: 'Ty', isAdmin: true }],
    appointments: [],
    clients: [],
    homewatch: [],
    jobs: []
  };

  migrateState(state, { idFactory: () => 'note-id', today: () => '2026-09-25' });

  assert.deepEqual(state.dashboardNotes, [
    { text: 'Team follow-up', audience: 'team', done: true, pinned: true, authorId: 'u1', id: 'note-id', date: '2026-09-25', authorName: '' },
    { text: 'Admin reminder', audience: 'admin', done: false, pinned: false, authorName: 'Ty', id: 'note-id', date: '2026-09-25', authorId: '' }
  ]);
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
