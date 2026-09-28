'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSaveQueue } = require('./save-queue');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('coalesces rapid requests and persists the newest queued snapshot after the first save', async () => {
  const writes = [];
  const first = deferred();
  const queue = createSaveQueue({
    persist: async snapshot => {
      writes.push(snapshot);
      if (writes.length === 1) await first.promise;
    }
  });
  const initial = queue.request({ name: 'first' });
  const queuedOne = queue.request({ name: 'middle' });
  const queuedTwo = queue.request({ name: 'last' });
  assert.equal(initial.started, true);
  assert.equal(queuedOne.started, false);
  assert.equal(queuedTwo.started, false);
  first.resolve();
  assert.equal(await initial.promise, true);
  assert.deepEqual(writes, [{ name: 'first' }, { name: 'last' }]);
});

test('clones a queued snapshot so later caller mutations cannot change what is saved', async () => {
  const writes = [];
  const first = deferred();
  const queue = createSaveQueue({
    persist: async snapshot => {
      writes.push(snapshot);
      if (writes.length === 1) await first.promise;
    }
  });
  const active = queue.request({ name: 'active' });
  const next = { name: 'queued' };
  queue.request(next);
  next.name = 'mutated after queueing';
  first.resolve();
  await active.promise;
  assert.equal(writes[1].name, 'queued');
});

test('releases the queue after a failed save so a later request can run', async () => {
  const writes = [];
  let attempts = 0;
  const errors = [];
  const queue = createSaveQueue({
    persist: async snapshot => {
      writes.push(snapshot);
      attempts++;
      if (attempts === 1) throw new Error('temporary failure');
    },
    onError: error => errors.push(error.message)
  });
  const failed = queue.request({ name: 'failed' });
  assert.equal(await failed.promise, false);
  assert.equal(queue.isInFlight(), false);
  const recovered = queue.request({ name: 'recovered' });
  assert.equal(await recovered.promise, true);
  assert.deepEqual(writes, [{ name: 'failed' }, { name: 'recovered' }]);
  assert.deepEqual(errors, ['temporary failure']);
});
