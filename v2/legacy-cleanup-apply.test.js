'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCleanupPlan } = require('./legacy-cleanup');

test('applies only approved markers, links, and a new client without mutating input', () => {
  const state = {
    clients: [{ id: 'client-1', firstName: 'Existing' }],
    jobs: [
      { id: 'job-1', name: 'Old', quote: 100 },
      { id: 'job-2', name: 'Linked', quote: 200 }
    ]
  };
  const before = JSON.stringify(state);
  const next = applyCleanupPlan(state, {
    legacyMarkerJobIds: ['job-1', 'job-2'],
    clientAssignments: [
      { jobId: 'job-1', clientId: 'client-1', match: 'exact-unique' },
      { jobId: 'job-2', clientId: 'client-2', match: 'manual' }
    ],
    newClient: { id: 'client-2', firstName: 'New', surname: 'Client' }
  });

  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(next.jobs, [
    { id: 'job-1', name: 'Old', quote: 100, createdVia: 'legacy', clientId: 'client-1' },
    { id: 'job-2', name: 'Linked', quote: 200, createdVia: 'legacy', clientId: 'client-2' }
  ]);
  assert.deepEqual(next.clients, [
    { id: 'client-1', firstName: 'Existing' },
    { id: 'client-2', firstName: 'New', surname: 'Client' }
  ]);
});

test('is idempotent when the approved changes are already present', () => {
  const state = {
    clients: [{ id: 'client-1', firstName: 'Existing' }],
    jobs: [{ id: 'job-1', createdVia: 'legacy', clientId: 'client-1' }]
  };

  const next = applyCleanupPlan(state, {
    legacyMarkerJobIds: ['job-1'],
    clientAssignments: [{ jobId: 'job-1', clientId: 'client-1' }]
  });

  assert.deepEqual(next, state);
});
