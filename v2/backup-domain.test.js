'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeState, parseBackup } = require('./backup-domain');

test('serializes the complete persistent state without changing it', () => {
  const state = {
    settings: { clientDefaults: { columns: ['email'] }, square: { highValueConfirmAmount: 1000 } },
    jobs: [{ id: 'job-1', jobNotes: [{ text: 'Keep this history' }] }],
    clients: [{ id: 'client-1', clientNotes: [{ text: 'Keep this note' }] }],
    users: [{ id: 'user-1', pin: '1234', clientPrefs: { clientQuickCols: ['email'] } }],
    homewatch: [{ id: 'hw-1', payments: [{ id: 'payment-1' }] }],
    appointments: [{ id: 'appt-1' }],
    debtPayments: [{ amount: 10 }],
    splitPayments: [{ amount: 5 }]
  };
  const before = JSON.stringify(state);

  const restored = parseBackup(serializeState(state));

  assert.deepEqual(restored, state);
  assert.equal(JSON.stringify(state), before);
});

test('rejects malformed or incomplete backup files', () => {
  assert.throws(() => parseBackup('{not json}'), /not valid JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ settings: {} })), /Invalid backup/);
  assert.throws(() => parseBackup(JSON.stringify({ jobs: [], settings: [] })), /Invalid backup/);
});
