'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCleanupPlan, buildCleanupPlan, clientCandidates } = require('./legacy-cleanup');

test('builds non-mutating cleanup proposals for markers and exact client links', () => {
  const state = {
    clients: [
      { id: 'client-1', firstName: 'Alex', surname: 'One' },
      { id: 'client-2', firstName: 'Alex', surname: 'Two' },
      { id: 'client-3', company: 'Exact Company' }
    ],
    jobs: [
      { id: 'job-1', name: 'Exact Company' },
      { id: 'job-2', name: 'Alex One' },
      { id: 'job-3', name: 'Alex' },
      { id: 'job-4', name: 'Nobody' },
      { id: 'job-5', name: 'Already Unified', createdVia: 'unified-v2', clientId: 'client-1' }
    ]
  };
  const before = JSON.stringify(state);

  const plan = buildCleanupPlan(state);

  assert.equal(JSON.stringify(state), before);
  assert.equal(plan.summary.legacyMarkersToAdd, 4);
  assert.equal(plan.summary.clientIdsToAdd, 2);
  assert.equal(plan.summary.ambiguousClientMatches, 0);
  assert.equal(plan.summary.unmatchedClientJobs, 2);
  assert.deepEqual(plan.proposedChanges.clientAssignments, [
    { jobId: 'job-1', clientId: 'client-3', match: 'exact-unique' },
    { jobId: 'job-2', clientId: 'client-1', match: 'exact-unique' }
  ]);
  assert.deepEqual(clientCandidates({ name: 'Alex One' }, state.clients).map(client => client.id), ['client-1']);
});

test('keeps ambiguous matches and partial jobs out of proposed writes', () => {
  const state = {
    clients: [
      { id: 'client-1', company: 'Same Name' },
      { id: 'client-2', company: 'Same Name' }
    ],
    jobs: [{
      id: 'job-1',
      name: 'Same Name',
      milestones: [{ id: 'milestone-1', partialState: 'paid' }],
      addOns: [{ id: 'add-on-1', partialState: 'remaining' }]
    }]
  };

  const plan = buildCleanupPlan(state);

  assert.deepEqual(plan.proposedChanges.clientAssignments, []);
  assert.deepEqual(plan.reviewRequired.ambiguousClientMatches, [{
    jobId: 'job-1',
    candidateClientIds: ['client-1', 'client-2']
  }]);
  assert.deepEqual(plan.reviewRequired.partialReview, [{
    jobId: 'job-1',
    itemCounts: { milestones: 1, revenueItems: 0, addOns: 1, subtractions: 0 }
  }]);
  assert.equal(plan.summary.partialItemsToReview, 2);
});

test('refuses to apply a plan before explicit implementation', () => {
  assert.throws(() => applyCleanupPlan({}), /not implemented/);
});
