(function attachTracker2Billing(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./financial-domain'));
  } else {
    root.Tracker2Billing = factory(root.Tracker2Financial);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBillingDomain(financial) {
  'use strict';

  if (!financial) throw new Error('Tracker 2.0 financial domain is required.');

  function roundMoney(value) {
    return typeof financial.roundMoney === 'function'
      ? financial.roundMoney(value)
      : Math.round((Number(value) || 0) * 100) / 100;
  }

  function billingBucket(status, item) {
    const value = status || item?.status || 'pending';
    if (value === 'collected' || item?.billingState === 'paid') return 'paid';
    if (value === 'invoiced' || item?.squareInvoiceId || item?.hourlySquareInvoiceId) return 'invoiced';
    return 'pending';
  }

  function addBillingRow(summary, status, amount, item = null) {
    const value = roundMoney(amount);
    if (Math.abs(value) < 0.005) return;
    const bucket = billingBucket(status, item);
    summary[bucket].count += 1;
    summary[bucket].total = roundMoney(summary[bucket].total + value);
  }

  function getJobBillingSummary(job, calc = null) {
    const summary = {
      pending: { count: 0, total: 0 },
      invoiced: { count: 0, total: 0 },
      paid: { count: 0, total: 0 }
    };
    const result = calc || financial.calcJob(job);
    if (financial.jobType(job) === 'hourly') {
      addBillingRow(summary, job.hourlyStatus || 'pending', result.contractTotal || 0, {
        status: job.hourlyStatus || 'pending',
        squareInvoiceId: job.hourlySquareInvoiceId || ''
      });
      return summary;
    }
    (job.milestones || []).forEach(item => addBillingRow(summary, item.status || 'pending', financial.milestoneAmount(job, item), item));
    (job.revenueItems || []).forEach(item => addBillingRow(summary, item.status || 'pending', Number(item.amount || 0), item));
    (job.addOns || []).forEach(item => addBillingRow(summary, item.status || 'pending', item.amount || 0, item));
    (job.subtractions || []).forEach(item => addBillingRow(summary, item.status || 'pending', -(item.amount || 0), item));
    return summary;
  }

  function jobBillingEntries(job, calc = null) {
    if (!job) return [];
    if (financial.jobType(job) === 'hourly') {
      const amount = (calc || financial.calcJob(job)).contractTotal || 0;
      return Math.abs(Number(amount)) >= 0.005 ? [{ item: job, hourly: true, amount }] : [];
    }
    return [
      ...(job.milestones || []).map(item => ({ item, amount: financial.milestoneAmount(job, item) })),
      ...(job.revenueItems || []).map(item => ({ item, amount: Number(item.amount || 0) })),
      ...(job.addOns || []).map(item => ({ item, amount: Number(item.amount || 0) })),
      ...(job.subtractions || []).map(item => ({ item, amount: -Number(item.amount || 0) }))
    ].filter(entry => Math.abs(Number(entry.amount || 0)) >= 0.005);
  }

  return Object.freeze({
    billingBucket,
    getJobBillingSummary,
    jobBillingEntries
  });
});
