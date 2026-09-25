const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcHomewatch,
  calcJob,
  calcSplit,
  isCollectedBillingItem,
  milestoneAmount
} = require('./financial-domain');

const settings = { feeRate: 0.1, txnFee: 2, debtOwnerShare: 0.5 };
const employee = { id: 'employee-1', empShare: 0.66 };

test('calculates split fees and shares with rounding', () => {
  assert.deepEqual(calcSplit(100, { empShare: 0.66, feeRate: 0.1, txnFee: 2, txnCount: 1 }), {
    totalFees: 12,
    netRevenue: 88,
    empOwed: 58.08,
    ownerOwed: 29.92
  });
});

test('calculates quoted jobs with collected billing, pending balance, materials, tips, and advances', () => {
  const job = {
    id: 'job-1',
    quote: 1000,
    milestones: [{ id: 'milestone-1', pct: 100, status: 'paid' }],
    addOns: [{ id: 'addon-1', amount: 100, status: 'pending' }],
    subtractions: [{ id: 'credit-1', amount: 20, status: 'pending' }],
    materials: [
      { who: 'owner', costAmount: 100, chargeAmount: 0 },
      { who: 'emp', costAmount: 50, chargeAmount: 0 }
    ],
    tips: [{ amount: 10 }],
    advances: [{ amount: 100 }],
    fees: [{ amount: 5 }],
    workCompleted: true,
    jobType: 'quoted',
    repaymentMode: false
  };
  const result = calcJob(job, { employee, settings, debtPayments: [{ linkedJobId: 'job-1', amount: 20 }] });

  assert.equal(result.contractTotal, 1080);
  assert.equal(result.collectedGross, 1000);
  assert.equal(result.pendingGross, 80);
  assert.equal(result.totalFees, 107);
  assert.equal(result.netRevenue, 893);
  assert.equal(result.totalMats, 150);
  assert.equal(result.profitPool, 743);
  assert.equal(result.empTotalOwed, 550.38);
  assert.equal(result.advancesPaid, 100);
  assert.equal(result.linkedDebtPaid, 20);
  assert.equal(result.empBalance, 430.38);
  assert.equal(result.outstanding, 80);
  assert.equal(result.projectedGross, 1080);
  assert.equal(result.projectedFees, 117);
  assert.equal(result.potentialEmpBalance, 476.58);
});

test('uses amount-based milestones and recognizes paid billing states', () => {
  const job = { quote: 500, milestoneBasis: 'amount' };
  const milestone = { amount: 125, billingState: 'paid' };
  assert.equal(milestoneAmount(job, milestone), 125);
  assert.equal(isCollectedBillingItem(milestone), true);
  assert.equal(isCollectedBillingItem({ status: 'pending' }), false);
});

test('holds employee pay while preserving owner-side financial calculations', () => {
  const job = {
    id: 'held-job',
    quote: 1000,
    milestones: [{ pct: 100, status: 'collected' }],
    tips: [{ amount: 25 }],
    advances: [{ amount: 50 }],
    fees: [],
    materials: [],
    addOns: [],
    subtractions: [],
    workCompleted: false,
    jobType: 'quoted'
  };
  const result = calcJob(job, { employee, settings: { feeRate: 0, txnFee: 0 }, debtPayments: [] });

  assert.equal(result.ownerProfit, 340);
  assert.equal(result.empTotalOwed, 0);
  assert.equal(result.potentialEmpTotalOwed, 0);
  assert.equal(result.empBalance, -50);
});

test('calculates hourly jobs from logged hours, hourly additions, and material charges', () => {
  const job = {
    id: 'hourly-job',
    jobType: 'hourly',
    hourlyRate: 50,
    hours: [{ hours: 3 }],
    addOns: [{ isHours: true, amount: 100, status: 'pending' }],
    materials: [{ who: 'owner', costAmount: 15, chargeAmount: 20 }],
    hourlyStatus: 'paid',
    fees: [],
    tips: [],
    advances: [],
    subtractions: []
  };
  const result = calcJob(job, { employee, settings, debtPayments: [] });

  assert.equal(result.contractTotal, 270);
  assert.equal(result.collectedGross, 270);
  assert.equal(result.pendingGross, 0);
  assert.equal(result.totalFees, 29);
  assert.equal(result.totalHours, 3);
  assert.equal(result.totalMats, 15);
  assert.equal(result.empBalance, 149.16);
});

test('calculates repayment-mode debt contribution with the adjusted owner share', () => {
  const job = {
    id: 'repayment-job',
    quote: 1000,
    milestones: [{ pct: 100, status: 'collected' }],
    addOns: [], subtractions: [], materials: [], tips: [], advances: [], fees: [],
    workCompleted: true,
    repaymentMode: true,
    jobType: 'quoted'
  };
  const result = calcJob(job, {
    employee,
    settings: { feeRate: 0, txnFee: 0, debtOwnerShare: 0.5 },
    debtPayments: []
  });

  assert.equal(result.empProfit, 500);
  assert.equal(result.ownerProfit, 500);
  assert.equal(result.debtContribution, 160);
});

test('calculates homewatch balances using collected and pending payments', () => {
  const homewatch = {
    id: 'hw-1',
    payments: [
      { amount: 100, status: 'collected' },
      { amount: 50, status: 'pending' }
    ],
    advances: [{ amount: 20 }]
  };
  const result = calcHomewatch(homewatch, {
    employee,
    settings,
    debtPayments: [{ linkedHWId: 'hw-1', amount: 10 }]
  });

  assert.equal(result.collectedGross, 100);
  assert.equal(result.pendingGross, 50);
  assert.equal(result.totalFees, 12);
  assert.equal(result.empOwed, 58.08);
  assert.equal(result.empBalance, 28.08);
  assert.equal(result.potentialEmpBalance, 56.46);
});
