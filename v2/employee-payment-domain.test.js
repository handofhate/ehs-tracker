'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentRows, paymentPlan, splitAllocation } = require('./employee-payment-domain');

const calcJob = job => ({ empBalance: job.current, potentialEmpBalance: job.potential });
const calcHW = item => ({ empBalance: item.current, potentialEmpBalance: item.potential });

test('builds employee payment rows while excluding historical jobs', () => {
  const rows = buildPaymentRows({
    jobs: [
      { id: 'current-job', name: 'Current Job', employeeId: 'emp', current: 25, potential: 50 },
      { id: 'legacy-job', name: 'Legacy Job', employeeId: 'emp', current: 100, potential: 100 },
      { id: 'other-job', name: 'Other Job', employeeId: 'other', current: 80, potential: 80 }
    ],
    homewatch: [{ id: 'service-1', name: 'Service', employeeId: 'emp', current: 10, potential: 15 }],
    employeeId: 'emp',
    isHistoricalJob: job => job.id === 'legacy-job',
    calcJob,
    calcHW
  });
  assert.deepEqual(rows, [
    { id: 'sp_job_current-job', label: 'Current Job', kind: 'job', currentBalance: 25, potentialBalance: 50 },
    { id: 'sp_hw_service-1', label: 'Service', kind: 'hw', currentBalance: 10, potentialBalance: 15 }
  ]);
});

test('builds a rounded payment plan and total from payment rows', () => {
  const result = paymentPlan([
    { id: 'one', potentialBalance: 10.126 },
    { id: 'two', potentialBalance: -2.125 }
  ]);
  assert.deepEqual(result, {
    rows: [
      { id: 'one', potentialBalance: 10.126, payoutTarget: 10.13 },
      { id: 'two', potentialBalance: -2.125, payoutTarget: -2.13 }
    ],
    payoutTotal: 8
  });
});

test('splits an over-balance payment into owed and advance records', () => {
  assert.deepEqual(splitAllocation(1000, 500, 'advance'), [
    { amount: 500, payType: '' },
    { amount: 500, payType: 'advance' }
  ]);
  assert.deepEqual(splitAllocation(1000, 500, 'final'), [
    { amount: 500, payType: 'final' },
    { amount: 500, payType: 'advance' }
  ]);
});

test('does not split adjustments or zero-balance advances', () => {
  assert.deepEqual(splitAllocation(-100, 500, 'adjustment'), [{ amount: -100, payType: 'adjustment' }]);
  assert.deepEqual(splitAllocation(100, 0, ''), [{ amount: 100, payType: '' }]);
});

test('keeps ordinary payments as one record when they do not exceed owed balance', () => {
  assert.deepEqual(splitAllocation(100, 500, 'final'), [{ amount: 100, payType: 'final' }]);
});
