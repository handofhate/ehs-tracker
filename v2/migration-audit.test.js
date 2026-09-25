'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditState, createAudit } = require('./migration-audit');

test('reports legacy and current-shape counts without mutating state', () => {
  const state = {
    settings: { historicalAdj: 10 },
    jobs: [
      {
        id: 'legacy-job',
        milestones: [{ id: 'milestone-1', partialState: 'paid' }],
        addOns: [{ id: 'add-on-1', collected: true }]
      },
      { id: 'current-job', createdVia: 'unified-v2', clientId: 'client-1' }
    ],
    clients: [{ id: 'client-1', clientNotes: 'old note' }],
    splitPayments: [{}],
    debtPayments: [],
    users: [],
    appointments: [],
    homewatch: []
  };
  const before = JSON.stringify(state);

  const report = auditState(state);

  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(report.topLevelCounts, {
    jobs: 2,
    clients: 1,
    homewatch: 0,
    users: 0,
    appointments: 0,
    splitPayments: 1,
    debtPayments: 0
  });
  assert.equal(report.results.find(item => item.id === 'settings.historicalAdj').count, 1);
  assert.equal(report.results.find(item => item.id === 'jobs.missingCreatedVia').count, 1);
  assert.equal(report.results.find(item => item.id === 'jobs.missingClientId').count, 1);
  assert.equal(report.results.find(item => item.id === 'jobItems.collectedBoolean').count, 1);
  assert.equal(report.results.find(item => item.id === 'jobItems.legacyPartialState').count, 1);
  assert.equal(report.results.find(item => item.id === 'splitPayments.missingIds').count, 1);
  assert.equal(report.nonZero.length > 0, true);
  assert.equal(report.zero.length > 0, true);
});

test('supports adding an isolated future audit without changing the defaults', () => {
  const futureAudit = createAudit({
    id: 'future.exampleCheck',
    label: 'Future example check',
    category: 'future',
    run: state => ({ count: Array.isArray(state?.example) ? state.example.length : 0, samples: [] })
  });

  const report = auditState({ example: [1, 2, 3] }, { audits: [futureAudit] });

  assert.deepEqual(report.results, [{
    id: 'future.exampleCheck',
    label: 'Future example check',
    category: 'future',
    count: 3,
    samples: []
  }]);
});
