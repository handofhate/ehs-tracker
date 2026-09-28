'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getJobBillingSummary, jobBillingEntries } = require('./billing-domain');

test('summarizes quoted billing lines without mixing credits into positive counts', () => {
  const job = {
    quote: 500,
    jobType: 'quoted',
    milestones: [{ id: 'm-1', pct: 100, status: 'collected' }],
    addOns: [{ id: 'a-1', amount: 75, status: 'invoiced' }],
    subtractions: [{ id: 'c-1', amount: 25, status: 'pending' }]
  };
  const summary = getJobBillingSummary(job, { contractTotal: 550 });

  assert.deepEqual(summary, {
    pending: { count: 1, total: -25 },
    invoiced: { count: 1, total: 75 },
    paid: { count: 1, total: 500 }
  });
});

test('uses one hourly billing entry for the calculated hourly contract total', () => {
  const job = { jobType: 'hourly', hourlyStatus: 'invoiced', hourlySquareInvoiceId: 'invoice-1' };
  const calc = { contractTotal: 270 };

  assert.deepEqual(getJobBillingSummary(job, calc), {
    pending: { count: 0, total: 0 },
    invoiced: { count: 1, total: 270 },
    paid: { count: 0, total: 0 }
  });
  assert.deepEqual(jobBillingEntries(job, calc), [{ item: job, hourly: true, amount: 270 }]);
});

test('treats Square-paid billing state as collected even when the legacy status is pending', () => {
  const job = {
    quote: 100,
    milestones: [{ id: 'm-1', pct: 100, status: 'pending', billingState: 'paid' }]
  };
  assert.equal(getJobBillingSummary(job, { contractTotal: 100 }).paid.total, 100);
});
