'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPersistenceBoundary } = require('./persistence-domain');
const { createPreviewSession } = require('./preview-session-domain');

function makeSession() {
  const persistence = createPersistenceBoundary({ mode: 'local-preview', writeState: () => {} });
  return createPreviewSession({ persistence });
}

test('keeps the newest server snapshot underneath dirty preview edits until discard', async () => {
  const session = makeSession();
  session.setServerSnapshot({ jobs: [{ id: 'job-1', name: 'Live v1' }] });
  await sessionPersistence(session, { jobs: [{ id: 'job-1', name: 'Temporary edit' }] });
  const update = session.receiveServerSnapshot({ jobs: [{ id: 'job-1', name: 'Live v2' }] });
  assert.equal(update.apply, false);
  assert.equal(update.changedWhileDirty, true);
  assert.equal(session.latestSnapshot().jobs[0].name, 'Live v2');
  assert.equal(session.isDirty(), true);
  assert.equal(session.discard().jobs[0].name, 'Live v2');
  assert.equal(session.isDirty(), false);
});

async function sessionPersistence(session, state) {
  // Marking through the session mirrors the app's save completion callback.
  session.markDirty();
  return state;
}

test('applies clean server snapshots and clones exposed snapshots', () => {
  const session = makeSession();
  const source = { jobs: [{ id: 'job-1', name: 'Live' }] };
  const stored = session.setServerSnapshot(source);
  stored.jobs[0].name = 'Changed caller copy';
  source.jobs[0].name = 'Changed source';
  assert.equal(session.latestSnapshot().jobs[0].name, 'Live');
  const update = session.receiveServerSnapshot({ jobs: [{ id: 'job-1', name: 'Live v2' }] });
  assert.equal(update.apply, true);
  assert.equal(session.latestSnapshot().jobs[0].name, 'Live v2');
});

test('returns null safely when no server snapshot exists', () => {
  const session = makeSession();
  assert.equal(session.latestSnapshot(), null);
  assert.equal(session.discard(), null);
  assert.equal(session.isDirty(), false);
});
