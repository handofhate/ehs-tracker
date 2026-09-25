(function attachTracker2Persistence(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2Persistence = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPersistenceDomain() {
  'use strict';

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function createPersistenceBoundary({ mode = 'production', writeState } = {}) {
    const preview = mode === 'local-preview';
    if (typeof writeState !== 'function') throw new TypeError('writeState must be a function.');

    return Object.freeze({
      isPreview: preview,

      async save(next) {
        const snapshot = clone(next);
        if (preview) return { persisted: false, snapshot };
        await writeState(snapshot);
        return { persisted: true, snapshot };
      },

      async write(next) {
        if (preview) throw new Error('Blocked Firestore write from the local Tracker 2.0 preview.');
        return writeState(clone(next));
      },

      discard(latestServerState) {
        return latestServerState == null ? null : clone(latestServerState);
      }
    });
  }

  return Object.freeze({ createPersistenceBoundary });
});
