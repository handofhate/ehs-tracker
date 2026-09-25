'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const debt = require('./debt-feature');

const employee = { empShare: 0.66 };

test('uses normal shares when the one-off debt feature is inactive', () => {
  const job = { repaymentMode: true };
  const settings = { debtOriginal: 0, debtOwnerShare: 0.5 };

  assert.equal(debt.isActive(settings), false);
  assert.ok(Math.abs(debt.effectiveOwnerShare(job, employee, settings) - 0.34) < 0.000001);
  assert.ok(Math.abs(debt.debtContribution(job, 1000, employee, settings)) < 0.000001);
  assert.equal(debt.canToggleRepayment(job, settings), false);
});

test('uses the configured repayment split while the debt is active', () => {
  const job = { repaymentMode: true };
  const settings = { debtOriginal: 100, debtOwnerShare: 0.5 };

  assert.equal(debt.effectiveOwnerShare(job, employee, settings), 0.5);
  assert.ok(Math.abs(debt.debtContribution(job, 1000, employee, settings) - 160) < 0.000001);
  assert.equal(debt.canToggleRepayment(job, settings), true);
});
