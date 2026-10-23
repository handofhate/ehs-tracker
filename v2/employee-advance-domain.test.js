'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allocateToSources,
  applyToSources,
  balance,
  sourceAppliedAmount
} = require('./employee-advance-domain');

test('calculates an employee advance balance independently of its optional job reference', () => {
  const state = {
    employeeAdvances: [{
      id: 'advance-1', employeeId: 'emp', amount: 200,
      sourceKind: 'job', sourceId: 'job-old',
      applications: [{ id: 'application-1', sourceKind: 'job', sourceId: 'job-new', amount: 50 }]
    }]
  };
  assert.equal(balance(state, 'emp'), 150);
  assert.equal(sourceAppliedAmount(state, 'job', 'job-new'), 50);
});

test('allocates an outstanding advance across multiple job balances', () => {
  assert.deepEqual(allocateToSources(200, [
    { sourceKind: 'job', sourceId: 'job-1', available: 80 },
    { sourceKind: 'job', sourceId: 'job-2', available: 300 }
  ]), [
    { sourceKind: 'job', sourceId: 'job-1', amount: 80 },
    { sourceKind: 'job', sourceId: 'job-2', amount: 120 }
  ]);
});

test('applies advances to selected sources without changing the advance total', () => {
  const records = [{ id: 'advance-1', employeeId: 'emp', amount: 200, applications: [] }];
  const applied = applyToSources(records, [
    { sourceKind: 'job', sourceId: 'job-1', amount: 100 },
    { sourceKind: 'job', sourceId: 'job-2', amount: 50 }
  ], { date: '2026-10-23', splitEventId: 'event-1', idFactory: () => 'application-id' });
  assert.deepEqual(applied, [
    { employeeAdvanceId: 'advance-1', sourceKind: 'job', sourceId: 'job-1', amount: 100 },
    { employeeAdvanceId: 'advance-1', sourceKind: 'job', sourceId: 'job-2', amount: 50 }
  ]);
  assert.equal(balance({ employeeAdvances: records }, 'emp'), 50);
  assert.equal(records[0].applications[1].splitEventId, 'event-1');
});
