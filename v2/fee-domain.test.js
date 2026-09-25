const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFeeConfig,
  forJob,
  forPayment,
  migrateStateFees
} = require('./fee-domain');

test('creates a fee snapshot from the current settings', () => {
  assert.deepEqual(createFeeConfig({ feeRate: 0.029, txnFee: 0.30 }, '2026-09-25'), {
    feeRate: 0.029,
    txnFee: 0.30,
    lockedAt: '2026-09-25',
    source: 'settings'
  });
});

test('prefers a locked job or payment snapshot over changed global settings', () => {
  const settings = { feeRate: 0.10, txnFee: 2 };
  assert.deepEqual(forJob({ feeConfig: { feeRate: 0.029, txnFee: 0.30, lockedAt: '2026-01-01' } }, settings), {
    feeRate: 0.029,
    txnFee: 0.30,
    lockedAt: '2026-01-01',
    source: 'settings'
  });
  assert.deepEqual(forPayment({ feeConfig: { feeRate: 0.029, txnFee: 0.30, lockedAt: '2026-01-01', source: 'migration' } }, settings), {
    feeRate: 0.029,
    txnFee: 0.30,
    lockedAt: '2026-01-01',
    source: 'migration'
  });
});

test('backfills jobs and HomeWatch payments once using the current rate', () => {
  const state = {
    settings: { feeRate: 0.029, txnFee: 0.30 },
    jobs: [{ id: 'job-1' }, { id: 'job-2', feeConfig: { feeRate: 0.025, txnFee: 0.25, lockedAt: '2026-01-01', source: 'settings' } }],
    homewatch: [{ payments: [{ id: 'payment-1' }] }]
  };
  const result = migrateStateFees(state, { today: () => '2026-09-25' });
  assert.equal(result.changed, true);
  assert.equal(result.jobsAdded, 1);
  assert.equal(result.paymentsAdded, 1);
  assert.deepEqual(state.jobs[0].feeConfig, {
    feeRate: 0.029,
    txnFee: 0.30,
    lockedAt: '2026-09-25',
    source: 'migration'
  });
  assert.equal(state.jobs[1].feeConfig.feeRate, 0.025);
  assert.equal(state.settings.feeSnapshotVersion, 1);
  const second = migrateStateFees(state, { today: () => '2026-09-26' });
  assert.equal(second.changed, false);
});
