(function attachTracker2HistoricalBoundary(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2HistoricalBoundary = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHistoricalBoundary() {
  'use strict';

  const CURRENT_ORIGIN = 'unified-v2';
  const LEGACY_ORIGIN = 'legacy';

  function isCurrentJob(job) {
    return !!job && job.createdVia === CURRENT_ORIGIN;
  }

  // A record is historical unless it explicitly belongs to the Tracker 2.0
  // model. Treating unknown origins as historical keeps old data from entering
  // a new edit path accidentally.
  function isHistoricalJob(job) {
    return !!job && !isCurrentJob(job);
  }

  function boundaryForJob(job) {
    const historical = isHistoricalJob(job);
    return Object.freeze({
      origin: historical ? LEGACY_ORIGIN : CURRENT_ORIGIN,
      readOnly: historical,
      editable: !historical
    });
  }

  return Object.freeze({
    CURRENT_ORIGIN,
    LEGACY_ORIGIN,
    boundaryForJob,
    isCurrentJob,
    isHistoricalJob
  });
});
