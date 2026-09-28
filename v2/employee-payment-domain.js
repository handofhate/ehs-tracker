(function attachTracker2EmployeePayment(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2EmployeePayment = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEmployeePaymentDomain() {
  'use strict';

  function roundMoney(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    const rounded = Math.sign(number) * Math.round((Math.abs(number) + Number.EPSILON) * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function buildPaymentRows({ jobs = [], homewatch = [], employeeId, isHistoricalJob = () => false, calcJob, calcHW }) {
    if (!employeeId) return [];
    if (typeof calcJob !== 'function' || typeof calcHW !== 'function') {
      throw new Error('Employee payment rows require job and recurring-service calculators.');
    }
    const rows = [];
    jobs.filter(job => !isHistoricalJob(job) && job.employeeId === employeeId).forEach(job => {
      const calculation = calcJob(job);
      rows.push({
        id: 'sp_job_' + job.id,
        label: job.name || 'Job',
        kind: 'job',
        currentBalance: Number(calculation.empBalance || 0),
        potentialBalance: Number(calculation.potentialEmpBalance || 0)
      });
    });
    homewatch.filter(item => item.employeeId === employeeId).forEach(item => {
      const calculation = calcHW(item);
      rows.push({
        id: 'sp_hw_' + item.id,
        label: item.name || 'Recurring Service',
        kind: 'hw',
        currentBalance: Number(calculation.empBalance || 0),
        potentialBalance: Number(calculation.potentialEmpBalance || 0)
      });
    });
    return rows;
  }

  function paymentPlan(rows, moneyRound = roundMoney) {
    const normalizedRows = (rows || []).map(row => ({
      ...row,
      payoutTarget: moneyRound(row.potentialBalance)
    }));
    return {
      rows: normalizedRows,
      payoutTotal: moneyRound(normalizedRows.reduce((sum, row) => sum + row.payoutTarget, 0))
    };
  }

  function splitAllocation(amount, owed, payType, moneyRound = roundMoney) {
    const payment = Number(amount || 0);
    const balance = Math.max(0, Number(owed || 0));
    if (payment > balance + 0.005 && balance > 0.005 && payType !== 'adjustment') {
      return [
        { amount: moneyRound(balance), payType: payType === 'final' ? 'final' : '' },
        { amount: moneyRound(payment - balance), payType: 'advance' }
      ];
    }
    return [{ amount: payment, payType }];
  }

  return Object.freeze({
    buildPaymentRows,
    paymentPlan,
    splitAllocation
  });
});
