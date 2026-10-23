(function attachTracker2EmployeeLedger(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2EmployeeLedger = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEmployeeLedgerDomain() {
  'use strict';

  function collectAdvanceRows(state) {
    const rows = [];
    (state?.jobs || []).forEach(job => {
      (job.advances || []).forEach(advance => {
        if (advance.employeeAdvanceId) return;
        rows.push({
          sourceKind: 'job',
          sourceId: job.id,
          sourceName: job.name || 'Job',
          employeeId: job.employeeId || '',
          advance: advance || {}
        });
      });
    });
    (state?.homewatch || []).forEach(homewatch => {
      (homewatch.advances || []).forEach(advance => {
        if (advance.employeeAdvanceId) return;
        rows.push({
          sourceKind: 'hw',
          sourceId: homewatch.id,
          sourceName: homewatch.name || 'HomeWatch',
          employeeId: homewatch.employeeId || '',
          advance: advance || {}
        });
      });
    });
    (state?.employeeAdvances || []).filter(advance => advance?.splitEventId).forEach(advance => {
      rows.push({
        sourceKind: advance.sourceKind || 'employee',
        sourceId: advance.sourceId || advance.employeeId || '',
        sourceName: advance.sourceName || 'Employee advance',
        employeeId: advance.employeeId || '',
        employeeAdvanceId: advance.id || '',
        advance
      });
    });
    return rows;
  }

  function sourceNameFor(state, sourceKind, sourceId) {
    const collection = sourceKind === 'hw' ? (state?.homewatch || []) : (state?.jobs || []);
    return collection.find(source => source.id === sourceId)?.name || (sourceKind === 'hw' ? 'HomeWatch' : 'Job');
  }

  function buildLedgerFromStoredEvents(state) {
    const rows = [];
    const byEventId = {};
    (state?.splitPayments || []).forEach(event => {
      if (event?.id) byEventId[event.id] = event;
    });
    (state?.splitPayments || []).forEach(event => {
      const linkedAdvances = collectAdvanceRows(state)
        .filter(({ advance }) => String(advance.splitEventId || '') === String(event.id));
      const storedAllocations = event.allocations || [];
      const appliedAllocations = (event.advanceApplications || []).map(application => ({
        sourceKind: application.sourceKind || '',
        sourceId: application.sourceId || '',
        sourceName: application.sourceName || sourceNameFor(state, application.sourceKind, application.sourceId),
        amount: Number(application.amount || 0),
        payType: 'advance',
        advanceId: '',
        employeeAdvanceId: application.employeeAdvanceId || ''
      }));
      const hasStoredAdvanceIds = storedAllocations.some(allocation => allocation?.advanceId || allocation?.employeeAdvanceId);
      if (!linkedAdvances.length && !appliedAllocations.length && hasStoredAdvanceIds) return;
      const allocations = (linkedAdvances.length
        ? linkedAdvances.map(({ sourceKind, sourceId, sourceName, employeeAdvanceId, advance }) => ({
          sourceKind,
          sourceId,
          sourceName,
          amount: Number(advance.amount || 0),
          payType: advance.payType || '',
          advanceId: advance.id || '',
          employeeAdvanceId: employeeAdvanceId || advance.employeeAdvanceId || ''
        }))
        : storedAllocations.map(allocation => ({
          sourceKind: allocation.sourceKind || '',
          sourceId: allocation.sourceId || '',
          sourceName: allocation.sourceName || '',
          amount: Number(allocation.amount || 0),
          payType: allocation.payType || '',
          advanceId: allocation.advanceId || '',
          employeeAdvanceId: allocation.employeeAdvanceId || ''
        }))).concat(appliedAllocations);
      const total = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      rows.push({
        id: `stored:${event.id}`,
        source: 'stored',
        date: event.date || '',
        label: event.label || 'Split payment',
        mode: event.mode || 'split',
        employeeId: event.employeeId || '',
        total,
        allocations
      });
    });
    return { rows, byEventId };
  }

  function buildLedgerFromLegacy(state, byEventId = {}) {
    const groups = {};
    collectAdvanceRows(state).forEach(({ sourceKind, sourceId, sourceName, employeeId, employeeAdvanceId, advance }) => {
      if (employeeAdvanceId) return;
      const splitEventId = (advance.splitEventId || '').trim();
      if (splitEventId && byEventId[splitEventId]) return;
      const amount = Number(advance.amount || 0);
      if (Math.abs(amount) <= 0.005) return;
      const label = (advance.label || '').trim();
      const date = (advance.date || '').trim();
      if (!label) return;
      const key = `${date}||${label}`;
      if (!groups[key]) groups[key] = { date, label, allocations: [], employeeIds: new Set() };
      groups[key].allocations.push({ sourceKind, sourceId, sourceName, amount, payType: advance.payType || '', employeeAdvanceId: employeeAdvanceId || '' });
      if (employeeId) groups[key].employeeIds.add(employeeId);
    });
    const rows = [];
    Object.keys(groups).forEach(key => {
      const group = groups[key];
      const isLikelySplit = group.allocations.length > 1 || /^(split payment|pay out)/i.test(group.label);
      if (!isLikelySplit) return;
      const total = group.allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      const mode = /\(potential\)/i.test(group.label) ? 'potential' : 'split';
      const employeeId = group.employeeIds.size === 1 ? [...group.employeeIds][0] : '';
      rows.push({
        id: `legacy:${key}`,
        source: 'legacy',
        date: group.date,
        label: group.label,
        mode,
        employeeId,
        total,
        allocations: group.allocations
      });
    });
    return rows;
  }

  function getLedgerEntries(state) {
    const { rows: storedRows, byEventId } = buildLedgerFromStoredEvents(state);
    const all = [...storedRows, ...buildLedgerFromLegacy(state, byEventId)];
    all.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA === dateB) return (a.label || '').localeCompare(b.label || '');
      return dateB.localeCompare(dateA);
    });
    return all;
  }

  return Object.freeze({
    buildLedgerFromLegacy,
    buildLedgerFromStoredEvents,
    collectAdvanceRows,
    getLedgerEntries
  });
});
