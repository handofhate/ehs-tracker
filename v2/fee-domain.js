(function attachTracker2Fees(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2Fees = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFeeDomain() {
  'use strict';

  const SNAPSHOT_VERSION = 1;
  const DEFAULT_FEE_RATE = 0.026;
  const DEFAULT_TXN_FEE = 0.30;

  function numberOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampRate(value) {
    return Math.min(1, Math.max(0, numberOr(value, DEFAULT_FEE_RATE)));
  }

  function clampTxnFee(value) {
    return Math.max(0, numberOr(value, DEFAULT_TXN_FEE));
  }

  function createFeeConfig(settings = {}, lockedAt = '', source = 'settings') {
    return {
      feeRate: clampRate(settings.feeRate),
      txnFee: clampTxnFee(settings.txnFee),
      lockedAt: String(lockedAt || ''),
      source: String(source || 'settings')
    };
  }

  function isFeeConfig(value) {
    return !!value && Number.isFinite(Number(value.feeRate)) && Number.isFinite(Number(value.txnFee));
  }

  function normalizeFeeConfig(value, fallback, { lockedAt = '', source = 'migration' } = {}) {
    const base = isFeeConfig(fallback) ? fallback : createFeeConfig({}, lockedAt, source);
    const raw = value && typeof value === 'object' ? value : {};
    return {
      feeRate: clampRate(raw.feeRate === undefined ? base.feeRate : raw.feeRate),
      txnFee: clampTxnFee(raw.txnFee === undefined ? base.txnFee : raw.txnFee),
      lockedAt: String(raw.lockedAt || base.lockedAt || lockedAt || ''),
      source: String(raw.source || base.source || source)
    };
  }

  function forJob(job, settings = {}) {
    return isFeeConfig(job?.feeConfig)
      ? normalizeFeeConfig(job.feeConfig, createFeeConfig(settings))
      : createFeeConfig(settings, '', 'settings-fallback');
  }

  function forPayment(payment, settings = {}) {
    return isFeeConfig(payment?.feeConfig)
      ? normalizeFeeConfig(payment.feeConfig, createFeeConfig(settings))
      : createFeeConfig(settings, '', 'settings-fallback');
  }

  function migrateStateFees(state, { today = () => '' } = {}) {
    if (!state || typeof state !== 'object') return { state, changed: false, jobsAdded: 0, paymentsAdded: 0 };
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    const current = createFeeConfig(state.settings, today(), 'migration');
    let changed = false;
    let jobsAdded = 0;
    let paymentsAdded = 0;

    (state.jobs || []).forEach(job => {
      if (!isFeeConfig(job?.feeConfig)) {
        job.feeConfig = { ...current };
        jobsAdded++;
        changed = true;
      } else {
        const normalized = normalizeFeeConfig(job.feeConfig, current, { lockedAt: today(), source: 'migration' });
        if (JSON.stringify(normalized) !== JSON.stringify(job.feeConfig)) {
          job.feeConfig = normalized;
          changed = true;
        }
      }
    });

    (state.homewatch || []).forEach(homewatch => {
      (homewatch?.payments || []).forEach(payment => {
        if (!isFeeConfig(payment?.feeConfig)) {
          payment.feeConfig = { ...current };
          paymentsAdded++;
          changed = true;
        } else {
          const normalized = normalizeFeeConfig(payment.feeConfig, current, { lockedAt: today(), source: 'migration' });
          if (JSON.stringify(normalized) !== JSON.stringify(payment.feeConfig)) {
            payment.feeConfig = normalized;
            changed = true;
          }
        }
      });
    });

    if (state.settings.feeSnapshotVersion !== SNAPSHOT_VERSION) {
      state.settings.feeSnapshotVersion = SNAPSHOT_VERSION;
      changed = true;
    }
    return { state, changed, jobsAdded, paymentsAdded };
  }

  return Object.freeze({
    SNAPSHOT_VERSION,
    createFeeConfig,
    forJob,
    forPayment,
    isFeeConfig,
    migrateStateFees,
    normalizeFeeConfig
  });
});
