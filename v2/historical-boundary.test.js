'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CURRENT_ORIGIN,
  LEGACY_ORIGIN,
  boundaryForJob,
  isCurrentJob,
  isHistoricalJob
} = require('./historical-boundary');

test('treats explicitly unified jobs as current and editable', () => {
  const job = { id: 'current-job', createdVia: CURRENT_ORIGIN };
  assert.equal(isCurrentJob(job), true);
  assert.equal(isHistoricalJob(job), false);
  assert.deepEqual(boundaryForJob(job), { origin: CURRENT_ORIGIN, readOnly: false, editable: true });
});

test('treats legacy jobs as historical and read-only', () => {
  const job = { id: 'legacy-job', createdVia: LEGACY_ORIGIN };
  assert.equal(isCurrentJob(job), false);
  assert.equal(isHistoricalJob(job), true);
  assert.deepEqual(boundaryForJob(job), { origin: LEGACY_ORIGIN, readOnly: true, editable: false });
});

test('treats missing or unknown origins as historical for safety', () => {
  assert.equal(isHistoricalJob({ id: 'missing-origin' }), true);
  assert.equal(isHistoricalJob({ id: 'unknown-origin', createdVia: 'future-version' }), true);
});

test('does not mutate the job while describing its boundary', () => {
  const job = { id: 'legacy-job', createdVia: LEGACY_ORIGIN, name: 'Old work' };
  const before = JSON.stringify(job);
  boundaryForJob(job);
  assert.equal(JSON.stringify(job), before);
});
