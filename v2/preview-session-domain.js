(function attachTracker2PreviewSession(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2PreviewSession = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPreviewSessionDomain() {
  'use strict';

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function createPreviewSession({ persistence, cloneState = clone } = {}) {
    if (!persistence || typeof persistence.setServerSnapshot !== 'function' ||
      typeof persistence.receiveServerSnapshot !== 'function' ||
      typeof persistence.discard !== 'function') {
      throw new TypeError('A persistence boundary is required.');
    }
    let latestServerState = null;

    return Object.freeze({
      discard() {
        latestServerState = persistence.discard();
        return latestServerState == null ? null : cloneState(latestServerState);
      },
      isDirty() {
        return typeof persistence.isDirty === 'function' ? persistence.isDirty() : false;
      },
      latestSnapshot() {
        return latestServerState == null ? null : cloneState(latestServerState);
      },
      markDirty() {
        if (typeof persistence.markDirty === 'function') persistence.markDirty();
      },
      receiveServerSnapshot(next) {
        const update = persistence.receiveServerSnapshot(next);
        latestServerState = update.snapshot;
        return {
          ...update,
          snapshot: update.snapshot == null ? null : cloneState(update.snapshot)
        };
      },
      setServerSnapshot(next) {
        latestServerState = persistence.setServerSnapshot(next);
        return latestServerState == null ? null : cloneState(latestServerState);
      }
    });
  }

  return Object.freeze({ createPreviewSession });
});
