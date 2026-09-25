const test = require('node:test');
const assert = require('node:assert/strict');
const { createPersistenceBoundary } = require('./persistence-domain');

test('preview save returns a local snapshot without calling the writer', async () => {
  const writes = [];
  const boundary = createPersistenceBoundary({
    mode: 'local-preview',
    writeState: snapshot => writes.push(snapshot)
  });
  const state = { jobs: [{ id: 'job-1', name: 'Temporary' }] };
  const result = await boundary.save(state);

  state.jobs[0].name = 'Mutated input';
  assert.equal(boundary.isPreview, true);
  assert.equal(result.persisted, false);
  assert.equal(result.snapshot.jobs[0].name, 'Temporary');
  assert.deepEqual(writes, []);
});

test('preview blocks direct writes', async () => {
  const boundary = createPersistenceBoundary({ mode: 'local-preview', writeState: () => {} });

  await assert.rejects(
    boundary.write({ jobs: [] }),
    /Blocked Firestore write from the local Tracker 2\.0 preview/
  );
});

test('production save and write clone data before sending it to the writer', async () => {
  const writes = [];
  const boundary = createPersistenceBoundary({
    mode: 'production',
    writeState: async snapshot => { writes.push(snapshot); return 'written'; }
  });
  const state = { jobs: [{ id: 'job-1', name: 'Original' }] };
  const saveResult = await boundary.save(state);
  state.jobs[0].name = 'Changed after save';
  const writeResult = await boundary.write(state);

  assert.equal(boundary.isPreview, false);
  assert.equal(saveResult.persisted, true);
  assert.equal(writeResult, 'written');
  assert.equal(writes[0].jobs[0].name, 'Original');
  assert.equal(writes[1].jobs[0].name, 'Changed after save');
});

test('discard returns a cloned live snapshot and handles an unavailable snapshot', () => {
  const boundary = createPersistenceBoundary({ mode: 'local-preview', writeState: () => {} });
  const latest = { jobs: [{ id: 'job-1', name: 'Live' }] };
  const restored = boundary.discard(latest);
  latest.jobs[0].name = 'Changed source';

  assert.equal(restored.jobs[0].name, 'Live');
  assert.equal(boundary.discard(null), null);
});
