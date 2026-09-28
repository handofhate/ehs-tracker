'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistory, describeAction } = require('./undo-redo-domain');

test('records snapshots and supports undo then redo with readable descriptions', () => {
  const history = createHistory();
  const before = { jobs: [{ id: 'job-1', name: 'Before' }] };
  const after = { jobs: [{ id: 'job-1', name: 'After' }] };
  history.recordSavedState(before);
  const undone = history.undo(after);
  assert.equal(undone.description, 'Renamed job to "After"');
  assert.deepEqual(undone.restored, before);
  const redone = history.redo(before);
  assert.equal(redone.description, 'Renamed job to "After"');
  assert.deepEqual(redone.restored, after);
});

test('limits undo history and clears redo history after a new save', () => {
  const history = createHistory({ max: 2 });
  history.recordSavedState({ value: 1 });
  history.recordSavedState({ value: 2 });
  history.recordSavedState({ value: 3 });
  assert.deepEqual(history.counts(), { undo: 2, redo: 0 });
  const undone = history.undo({ value: 4 });
  assert.equal(undone.restored.value, 3);
  assert.deepEqual(history.counts(), { undo: 1, redo: 1 });
  history.recordSavedState({ value: 3 });
  assert.deepEqual(history.counts(), { undo: 2, redo: 0 });
});

test('rolls back failed undo and redo operations without losing stack entries', () => {
  const history = createHistory();
  history.recordSavedState({ value: 'before' });
  const undone = history.undo({ value: 'after' });
  history.rollbackUndo(undone.previous);
  assert.deepEqual(history.counts(), { undo: 1, redo: 0 });
  const redoHistory = createHistory();
  redoHistory.recordSavedState({ value: 'before' });
  const change = redoHistory.undo({ value: 'after' });
  const redone = redoHistory.redo(change.restored);
  redoHistory.rollbackRedo(redone.next);
  assert.deepEqual(redoHistory.counts(), { undo: 0, redo: 1 });
});

test('describes key non-job changes without mutating snapshots', () => {
  assert.equal(describeAction({ clients: [] }, { clients: [{ id: 'c-1', firstName: 'Alex', surname: 'Example' }] }), 'Added client "Alex Example"');
  assert.equal(describeAction({ settings: { feeRate: 0.02 } }, { settings: { feeRate: 0.03 } }), 'Updated settings');
});
