'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasLegacyPartial,
  allowsCurrentPartialCollection
} = require('./legacy-partial-domain');

test('detects old split partial state without mutating the job', () => {
  const job = {
    id: 'legacy-job',
    milestones: [{ id: 'paid', partialState: 'paid' }, { id: 'remaining', partialState: 'remaining' }],
    partialCollections: []
  };
  const before = JSON.stringify(job);

  assert.equal(hasLegacyPartial(job), true);
  assert.equal(allowsCurrentPartialCollection(job), false);
  assert.equal(JSON.stringify(job), before);
});

test('allows current partial collections for new and fully normalized jobs', () => {
  assert.equal(allowsCurrentPartialCollection({ createdVia: 'unified-v2', partialCollections: [] }), true);
  assert.equal(allowsCurrentPartialCollection({ milestones: [{ partialState: '' }], partialCollections: [] }), true);
  assert.equal(allowsCurrentPartialCollection({ milestones: [{ partialState: 'paid' }], partialCollections: [{ id: 'current' }] }), true);
});
