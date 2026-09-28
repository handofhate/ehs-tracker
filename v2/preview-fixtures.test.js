const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIntoState, fixture } = require('./preview-fixtures');

test('preview fixtures add stable payout jobs and overview notes without replacing live records', () => {
  const live = {
    jobs: [{ id: 'live-job', name: 'Live job' }],
    clients: [{ id: 'live-client', firstName: 'Live' }],
    dashboardNotes: [{ id: 'live-note', text: 'Live note' }]
  };
  const merged = mergeIntoState(live);

  assert.equal(merged.jobs.length, 4);
  assert.equal(merged.clients.length, 4);
  assert.equal(merged.dashboardNotes.length, 4);
  assert.equal(merged.jobs.find(job => job.id === 'live-job').name, 'Live job');
  assert.equal(merged.jobs.find(job => job.id === 'tracker2-preview-job-gamma').workCompleted, false);
  assert.equal(merged.dashboardNotes.find(note => note.id === 'tracker2-preview-note-payout').pinned, true);
  assert.equal(live.jobs.length, 1);
});

test('preview fixture merge is idempotent', () => {
  const once = mergeIntoState({ jobs: [], clients: [], dashboardNotes: [] });
  const twice = mergeIntoState(once);
  assert.deepEqual(twice, once);
  assert.equal(fixture.jobs.length, 3);
});
