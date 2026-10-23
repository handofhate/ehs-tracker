(function attachTracker2EmployeeAdvance(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2EmployeeAdvance = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEmployeeAdvanceDomain() {
  'use strict';

  function roundMoney(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    const rounded = Math.sign(number) * Math.round((Math.abs(number) + Number.EPSILON) * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function activeAdvances(state, employeeId = '') {
    return (state?.employeeAdvances || [])
      .filter(advance => !employeeId || advance.employeeId === employeeId);
  }

  function appliedAmount(advance, round = roundMoney) {
    return round((advance?.applications || []).reduce((sum, application) => sum + Number(application.amount || 0), 0));
  }

  function outstandingAmount(advance, round = roundMoney) {
    return Math.max(0, round(Number(advance?.amount || 0) - appliedAmount(advance, round)));
  }

  function balance(state, employeeId, round = roundMoney) {
    return round(activeAdvances(state, employeeId).reduce((sum, advance) => sum + outstandingAmount(advance, round), 0));
  }

  function totalAmount(state, employeeId, round = roundMoney) {
    return round(activeAdvances(state, employeeId).reduce((sum, advance) => sum + Number(advance.amount || 0), 0));
  }

  function sourceAppliedAmount(state, sourceKind, sourceId, round = roundMoney) {
    return round(activeAdvances(state).reduce((sum, advance) => sum +
      (advance.applications || [])
        .filter(application => application.sourceKind === sourceKind && application.sourceId === sourceId)
        .reduce((sourceSum, application) => sourceSum + Number(application.amount || 0), 0), 0));
  }

  function allocateToSources(advances, sources, round = roundMoney) {
    let remaining = Math.max(0, round(advances));
    return (sources || []).reduce((allocations, source) => {
      if (remaining <= 0.005) return allocations;
      const available = Math.max(0, Number(source.available || 0));
      if (available <= 0.005) return allocations;
      const amount = round(Math.min(available, remaining));
      if (amount > 0.005) {
        allocations.push({
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          amount
        });
        remaining = round(remaining - amount);
      }
      return allocations;
    }, []);
  }

  function applyToSources(records, allocations, { date = '', splitEventId = '', label = '', idFactory = () => '' } = {}) {
    const remainingBySource = new Map((allocations || []).map(item => [
      `${item.sourceKind}:${item.sourceId}`,
      Math.max(0, Number(item.amount || 0))
    ]));
    const applied = [];
    (records || []).forEach(advance => {
      let remaining = outstandingAmount(advance);
      if (remaining <= 0.005) return;
      for (const [key, requested] of remainingBySource.entries()) {
        if (remaining <= 0.005) break;
        if (requested <= 0.005) continue;
        const [sourceKind, ...sourceIdParts] = key.split(':');
        const sourceId = sourceIdParts.join(':');
        const amount = roundMoney(Math.min(remaining, requested));
        if (amount <= 0.005) continue;
        if (!Array.isArray(advance.applications)) advance.applications = [];
        advance.applications.push({
          id: idFactory(),
          date,
          label,
          sourceKind,
          sourceId,
          amount,
          splitEventId
        });
        applied.push({
          employeeAdvanceId: advance.id,
          sourceKind,
          sourceId,
          amount
        });
        remainingBySource.set(key, roundMoney(requested - amount));
        remaining = roundMoney(remaining - amount);
      }
    });
    return applied;
  }

  return Object.freeze({
    activeAdvances,
    allocateToSources,
    appliedAmount,
    applyToSources,
    balance,
    outstandingAmount,
    sourceAppliedAmount,
    totalAmount
  });
});
