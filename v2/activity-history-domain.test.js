'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendActivityEvents, buildActivityEvents } = require('./activity-history-domain');

function ids() {
  let next = 1;
  return () => `event-${next++}`;
}

test('records meaningful create, update, delete, and settings events without logging activity history itself', () => {
  const before = {
    settings: { feeRate: 0.026 },
    activityHistory: [{ id: 'old-event' }],
    jobs: [{ id: 'job-1', name: 'Old name', quote: 500 }],
    clients: [{ id: 'client-1', firstName: 'Existing' }]
  };
  const after = {
    settings: { feeRate: 0.03 },
    activityHistory: [{ id: 'old-event' }, { id: 'new-event' }],
    jobs: [{ id: 'job-1', name: 'New name', quote: 650 }],
    clients: [{ id: 'client-2', firstName: 'New client' }]
  };

  const events = buildActivityEvents({ before, after, actor: { id: 'admin-1', name: 'Ty' }, idFactory: ids(), occurredAt: '2026-09-28T12:00:00.000Z' });

  assert.deepEqual(events.map(event => `${event.eventType}:${event.objectType}:${event.objectId}`), [
    'updated:job:job-1',
    'created:client:client-2',
    'deleted:client:client-1',
    'updated:settings:settings'
  ]);
  assert.equal(events[0].actorName, 'Ty');
  assert.deepEqual(events[0].changes.map(change => change.field), ['name', 'quote']);
  assert.equal(events.some(event => event.category === 'activityHistory'), false);
});

test('keeps only the newest activity events when the history limit is reached', () => {
  const result = appendActivityEvents([{ id: 'one' }, { id: 'two' }], [{ id: 'three' }, { id: 'four' }], 3);
  assert.deepEqual(result.map(event => event.id), ['two', 'three', 'four']);
});

test('does not create events for identical state snapshots', () => {
  assert.deepEqual(buildActivityEvents({ before: { jobs: [{ id: 'job-1', name: 'Same' }] }, after: { jobs: [{ id: 'job-1', name: 'Same' }] }, idFactory: ids() }), []);
});
