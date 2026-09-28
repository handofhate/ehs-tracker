(function attachTracker2SaveQueue(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2SaveQueue = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSaveQueueDomain() {
  'use strict';

  function cloneValue(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function createSaveQueue({ persist, clone = cloneValue, onStart, onSaved, onError, onFinish } = {}) {
    if (typeof persist !== 'function') throw new TypeError('persist must be a function.');
    let inFlight = false;
    let queued = null;

    async function run(request) {
      inFlight = true;
      if (typeof onStart === 'function') onStart(request.options);
      try {
        const result = await persist(clone(request.snapshot), request.options);
        if (typeof onSaved === 'function') onSaved(result, request.options);
        return true;
      } catch (error) {
        if (typeof onError === 'function') onError(error, request.options);
        return false;
      } finally {
        inFlight = false;
        if (typeof onFinish === 'function') onFinish(request.options);
        if (queued) {
          const next = queued;
          queued = null;
          await run(next);
        }
      }
    }

    return Object.freeze({
      isInFlight: () => inFlight,
      isQueued: () => !!queued,
      request(snapshot, options = {}) {
        if (inFlight) {
          queued = { snapshot: clone(snapshot), options: { ...options } };
          return { started: false, promise: Promise.resolve(false) };
        }
        return { started: true, promise: run({ snapshot, options: { ...options } }) };
      }
    });
  }

  return Object.freeze({ createSaveQueue });
});
