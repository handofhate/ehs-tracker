(function attachTracker2ActivityHistory(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2ActivityHistory = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createActivityHistoryDomain() {
  'use strict';

  const MAX_EVENTS = 500;

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function summarizeValue(value) {
    if (value === undefined) return '(none)';
    if (value === null) return '(none)';
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
    if (typeof value === 'object') return '(changed)';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    const text = String(value);
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  }

  function fieldLabel(key) {
    return String(key || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, value => value.toUpperCase());
  }

  function changedFields(before = {}, after = {}) {
    const ignored = new Set(['id', 'pin', 'createdAt', 'updatedAt', 'activityHistory']);
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...keys]
      .filter(key => !ignored.has(key) && !sameValue(before?.[key], after?.[key]))
      .slice(0, 16)
      .map(field => ({
        field,
        label: fieldLabel(field),
        before: summarizeValue(before?.[field]),
        after: summarizeValue(after?.[field])
      }));
  }

  const COLLECTIONS = Object.freeze([
    { key: 'jobs', type: 'job', label: 'job', name: item => item?.name || item?.id || 'Job' },
    { key: 'clients', type: 'client', label: 'client', name: item => [item?.firstName, item?.surname].filter(Boolean).join(' ') || item?.company || item?.id || 'Client' },
    { key: 'homewatch', type: 'recurring-service', label: 'recurring service', name: item => item?.name || item?.clientName || item?.id || 'Recurring service' },
    { key: 'splitPayments', type: 'employee-payment', label: 'employee payment', name: item => item?.label || item?.id || 'Employee payment' },
    { key: 'debtPayments', type: 'debt-payment', label: 'debt payment', name: item => item?.label || item?.id || 'Debt payment' },
    { key: 'appointments', type: 'appointment', label: 'appointment', name: item => item?.clientName || item?.title || item?.id || 'Appointment' },
    { key: 'users', type: 'user', label: 'user', name: item => item?.name || item?.id || 'User' },
    { key: 'dashboardNotes', type: 'workspace-note', label: 'workspace note', name: item => item?.text || item?.id || 'Workspace note' }
  ]);

  function recordMap(state, key) {
    return new Map((Array.isArray(state?.[key]) ? state[key] : [])
      .filter(item => item && item.id)
      .map(item => [item.id, item]));
  }

  function makeEvent({ idFactory, occurredAt, actor, collection, eventType, item, previous, actionLabel }) {
    const changes = eventType === 'updated' ? changedFields(previous, item) : [];
    const name = collection.name(item || previous);
    const verb = eventType === 'created' ? 'Created' : eventType === 'deleted' ? 'Deleted' : 'Updated';
    return {
      id: idFactory(),
      occurredAt,
      actorId: actor?.id || '',
      actorName: actor?.name || 'Tracker',
      eventType,
      category: collection.key,
      objectType: collection.type,
      objectId: item?.id || previous?.id || '',
      objectLabel: String(name),
      summary: `${verb} ${collection.label} "${String(name)}"`,
      actionLabel: actionLabel || '',
      changes: clone(changes)
    };
  }

  function buildActivityEvents({
    before = {},
    after = {},
    actor = {},
    occurredAt = new Date().toISOString(),
    idFactory = () => globalThis.crypto.randomUUID(),
    actionLabel = ''
  } = {}) {
    const events = [];
    COLLECTIONS.forEach(collection => {
      const previous = recordMap(before, collection.key);
      const current = recordMap(after, collection.key);
      current.forEach((item, id) => {
        if (!previous.has(id)) {
          events.push(makeEvent({ idFactory, occurredAt, actor, collection, eventType: 'created', item, actionLabel }));
        } else if (!sameValue(previous.get(id), item)) {
          events.push(makeEvent({ idFactory, occurredAt, actor, collection, eventType: 'updated', item, previous: previous.get(id), actionLabel }));
        }
      });
      previous.forEach((item, id) => {
        if (!current.has(id)) {
          events.push(makeEvent({ idFactory, occurredAt, actor, collection, eventType: 'deleted', previous: item, actionLabel }));
        }
      });
    });

    if (!sameValue(before.settings || {}, after.settings || {})) {
      events.push({
        id: idFactory(),
        occurredAt,
        actorId: actor?.id || '',
        actorName: actor?.name || 'Tracker',
        eventType: 'updated',
        category: 'settings',
        objectType: 'settings',
        objectId: 'settings',
        objectLabel: 'Tracker settings',
        summary: 'Updated Tracker settings',
        actionLabel: actionLabel || '',
        changes: clone(changedFields(before.settings || {}, after.settings || {}))
      });
    }
    return events;
  }

  function appendActivityEvents(history, events, limit = MAX_EVENTS) {
    const current = Array.isArray(history) ? history : [];
    const additions = Array.isArray(events) ? events : [];
    return [...current, ...additions].slice(-Math.max(1, Number(limit) || MAX_EVENTS));
  }

  return Object.freeze({
    MAX_EVENTS,
    appendActivityEvents,
    buildActivityEvents,
    changedFields,
    clone,
    summarizeValue
  });
});
