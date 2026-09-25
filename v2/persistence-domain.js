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
    let latestServerState = null;
    let dirty = false;

    return Object.freeze({
      isPreview: preview,

      async save(next) {
        const snapshot = clone(next);
        if (preview) {
          dirty = true;
          return { persisted: false, snapshot };
        }
        await writeState(snapshot);
        latestServerState = clone(snapshot);
        dirty = false;
        return { persisted: true, snapshot };
      },

      async write(next) {
        if (preview) throw new Error('Blocked Firestore write from the local Tracker 2.0 preview.');
        return writeState(clone(next));
      },

      setServerSnapshot(next) {
        latestServerState = next == null ? null : clone(next);
        dirty = false;
        return latestServerState == null ? null : clone(latestServerState);
      },

      receiveServerSnapshot(next) {
        latestServerState = next == null ? null : clone(next);
        const apply = !preview || !dirty;
        if (apply) dirty = false;
        return {
          apply,
          changedWhileDirty: !apply,
          snapshot: latestServerState == null ? null : clone(latestServerState)
        };
      },

      markDirty() {
        dirty = true;
      },

      isDirty() {
        return dirty;
      },

      discard() {
        const restored = latestServerState == null ? null : clone(latestServerState);
        dirty = false;
        return restored;
      }
    });
  }

  return Object.freeze({ createPersistenceBoundary });
});
