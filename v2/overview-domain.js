(function attachTracker2Overview(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2Overview = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOverviewDomain() {
  'use strict';

  function defaultRoundMoney(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    const rounded = Math.sign(number) * Math.round((Math.abs(number) + Number.EPSILON) * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function recentEmployeePay(state, employeeId, timeframe, referenceDate = new Date(), roundMoney = defaultRoundMoney) {
    let cutoffStr = null;
    if (timeframe !== 'all') {
      const date = new Date(referenceDate);
      date.setDate(date.getDate() - parseInt(timeframe));
      cutoffStr = date.toISOString().slice(0, 10);
    }
    const inWindow = date => !cutoffStr || (date && date >= cutoffStr);
    let total = 0;
    (state?.jobs || []).filter(job => job.employeeId === employeeId).forEach(job => {
      (job.advances || []).forEach(advance => {
        if (inWindow(advance.date)) total += advance.amount || 0;
      });
    });
    (state?.homewatch || []).filter(homewatch => homewatch.employeeId === employeeId).forEach(homewatch => {
      (homewatch.advances || []).forEach(advance => {
        if (inWindow(advance.date)) total += advance.amount || 0;
      });
    });
    return roundMoney(total);
  }

  function billingTotals(jobs, getJobBillingSummary) {
    if (typeof getJobBillingSummary !== 'function') throw new Error('Overview billing summaries require a billing function.');
    return (jobs || [])
      .filter(job => job.status !== 'complete')
      .reduce((sum, job) => {
        const billing = getJobBillingSummary(job);
        return {
          pendingCount: sum.pendingCount + billing.pending.count,
          pendingTotal: sum.pendingTotal + billing.pending.total,
          invoicedCount: sum.invoicedCount + billing.invoiced.count,
          invoicedTotal: sum.invoicedTotal + billing.invoiced.total
        };
      }, { pendingCount: 0, pendingTotal: 0, invoicedCount: 0, invoicedTotal: 0 });
  }

  function employeePaySummary({ jobs = [], homewatch = [], employeeId, include = {}, calcJob, calcHW, roundMoney = defaultRoundMoney }) {
    if (typeof calcJob !== 'function' || typeof calcHW !== 'function') {
      throw new Error('Employee pay summaries require job and recurring-service calculators.');
    }
    const activeJobs = jobs.filter(job => job.status !== 'complete' && job.employeeId === employeeId);
    const employeeHomewatch = homewatch.filter(item => item.employeeId === employeeId);
    const jobPay = roundMoney(activeJobs.reduce((sum, job) => sum + Math.max(0, calcJob(job).potentialEmpBalance), 0));
    const jobCredit = roundMoney(activeJobs.reduce((sum, job) => sum + Math.max(0, -calcJob(job).potentialEmpBalance), 0));
    const jobNet = roundMoney(jobPay - jobCredit);
    const recurringBalance = roundMoney(employeeHomewatch.reduce((sum, item) => sum + calcHW(item).potentialEmpBalance, 0));
    const owedTotal = roundMoney((include.jobs ? jobNet : 0) + (include.homewatch ? recurringBalance : 0));
    return { jobPay, jobCredit, jobNet, recurringBalance, owedTotal };
  }

  function employeeOverviewSummary({ jobs = [], homewatch = [], employeeId, calcJob, calcHW, roundMoney = defaultRoundMoney }) {
    if (typeof calcJob !== 'function' || typeof calcHW !== 'function') {
      throw new Error('Employee Overview summaries require job and recurring-service calculators.');
    }
    const employeeJobs = jobs.filter(job => job.status !== 'complete' && job.employeeId === employeeId);
    const employeeHomewatch = homewatch.filter(item => item.employeeId === employeeId);
    const activeHomewatch = employeeHomewatch.filter(item => item.status !== 'paused');
    const pausedHomewatch = employeeHomewatch.filter(item => item.status === 'paused');
    const owed = employeeJobs.reduce((sum, job) => sum + calcJob(job).potentialEmpBalance, 0) +
      employeeHomewatch.reduce((sum, item) => sum + calcHW(item).potentialEmpBalance, 0);
    return {
      activeJobs: employeeJobs,
      activeHomewatch,
      pausedHomewatch,
      allHomewatch: employeeHomewatch,
      potentialOwed: roundMoney(owed)
    };
  }

  function visibleDashboardNotes(notes, { userId, isAdmin } = {}) {
    return (notes || [])
      .filter(note => note.audience !== 'admin' || !!isAdmin)
      .slice()
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) ||
        String(b.date || '').localeCompare(String(a.date || '')) ||
        String(b.id || '').localeCompare(String(a.id || '')));
  }

  return Object.freeze({
    billingTotals,
    employeeOverviewSummary,
    employeePaySummary,
    recentEmployeePay,
    visibleDashboardNotes
  });
});
