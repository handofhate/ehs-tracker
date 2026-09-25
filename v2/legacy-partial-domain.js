(function attachTracker2LegacyPartial(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2LegacyPartial = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLegacyPartialDomain() {
  'use strict';

  // Temporary historical boundary. These fields belong to the partial-payment
  // format that existed before partialCollections edit history was introduced.
  // Keep this module isolated so it can be removed after the retained records
  // are no longer needed.
  const LEGACY_PARTIAL_FIELDS = Object.freeze([
    'milestones',
    'revenueItems',
    'addOns',
    'subtractions'
  ]);

  function hasLegacyPartial(job) {
    if (!job || (job.partialCollections || []).length) return false;
    return LEGACY_PARTIAL_FIELDS.some(field => (
      Array.isArray(job[field]) && job[field].some(item => !!item?.partialState)
    ));
  }

  function allowsCurrentPartialCollection(job) {
    return !hasLegacyPartial(job);
  }

  return Object.freeze({
    LEGACY_PARTIAL_FIELDS,
    hasLegacyPartial,
    allowsCurrentPartialCollection
  });
});
