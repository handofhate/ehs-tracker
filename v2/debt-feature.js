(function attachTracker2DebtFeature(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2DebtFeature = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDebtFeature() {
  'use strict';

  // This is a deliberately isolated one-off startup-debt feature. When the
  // debt is retired, this module and its small app call sites can be removed.
  function clampShare(value, fallback = 0.5) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  }

  function isActive(settings = {}) {
    // Missing debtOriginal is treated as active for direct domain callers that
    // predate the normalized state shape. Normal app state always has it.
    return settings.debtOriginal === undefined || Number(settings.debtOriginal || 0) > 0;
  }

  function effectiveOwnerShare(job, employee = null, settings = {}) {
    const normalOwnerShare = 1 - (employee?.empShare ?? 0.66);
    if (!job?.repaymentMode || !isActive(settings)) return normalOwnerShare;
    return clampShare(settings.debtOwnerShare);
  }

  function debtContribution(job, profitPool, employee = null, settings = {}) {
    if (!job?.repaymentMode || !isActive(settings)) return 0;
    const normalOwnerShare = 1 - (employee?.empShare ?? 0.66);
    return Math.max(0, Number(profitPool || 0) * (effectiveOwnerShare(job, employee, settings) - normalOwnerShare));
  }

  function canToggleRepayment(job, settings = {}) {
    return !!job && isActive(settings);
  }

  return Object.freeze({
    canToggleRepayment,
    clampShare,
    debtContribution,
    effectiveOwnerShare,
    isActive
  });
});
