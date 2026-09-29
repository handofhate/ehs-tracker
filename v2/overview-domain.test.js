'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  billingTotals,
  employeeOverviewSummary,
  employeePaySummary,
  recentEmployeePay,
  visibleDashboardNotes
} = require('./overview-domain');

const calcJob = job => ({ potentialEmpBalance: job.balance || 0 });
const calcHW = item => ({ potentialEmpBalance: item.balance || 0 });

test('summarizes only active job billing for the Overview invoice card', () => {
  const jobs = [
    { id: 'active', status: 'active' },
    { id: 'complete', status: 'complete' }
  ];
  const summaries = {
    active: { pending: { count: 2, total: 80 }, invoiced: { count: 1, total: 120 } },
    complete: { pending: { count: 9, total: 90 }, invoiced: { count: 9, total: 900 } }
  };
  assert.deepEqual(billingTotals(jobs, job => summaries[job.id]), {
    pendingCount: 2,
    pendingTotal: 80,
    invoicedCount: 1,
    invoicedTotal: 120
  });
});

test('calculates admin pay owed with job credits and recurring-service inclusion', () => {
  const result = employeePaySummary({
    jobs: [
      { employeeId: 'emp', balance: 100 },
      { employeeId: 'emp', balance: -25 },
      { employeeId: 'emp', status: 'complete', balance: 500 }
    ],
    homewatch: [{ employeeId: 'emp', balance: 40 }],
    employeeId: 'emp',
    include: { jobs: true, homewatch: false },
    calcJob,
    calcHW
  });
  assert.deepEqual(result, { jobPay: 100, jobCredit: 25, jobNet: 75, recurringBalance: 40, owedTotal: 75 });
});

test('builds the employee Overview counts and potential owed total', () => {
  const result = employeeOverviewSummary({
    jobs: [{ employeeId: 'emp', balance: 100 }, { employeeId: 'other', balance: 50 }],
    homewatch: [
      { employeeId: 'emp', balance: 25, status: 'active' },
      { employeeId: 'emp', balance: 10, status: 'paused' }
    ],
    employeeId: 'emp',
    calcJob,
    calcHW
  });
  assert.deepEqual({
    activeJobs: result.activeJobs.length,
    activeHomewatch: result.activeHomewatch.length,
    pausedHomewatch: result.pausedHomewatch.length,
    potentialOwed: result.potentialOwed
  }, { activeJobs: 1, activeHomewatch: 1, pausedHomewatch: 1, potentialOwed: 135 });
});

test('counts recent employee pay using a stable date window', () => {
  const state = {
    jobs: [{ employeeId: 'emp', advances: [{ date: '2026-09-28', amount: 30 }, { date: '2026-08-01', amount: 40 }] }],
    homewatch: [{ employeeId: 'emp', advances: [{ date: '2026-09-01', amount: 20 }] }]
  };
  assert.equal(recentEmployeePay(state, 'emp', '30', new Date('2026-09-28T12:00:00Z')), 50);
  assert.equal(recentEmployeePay(state, 'emp', 'all', new Date('2026-09-28T12:00:00Z')), 90);
});

test('counts recent employee pay from the local calendar date after UTC rolls over', () => {
  const state = {
    jobs: [{
      employeeId: 'emp',
      advances: [
        { date: '2026-09-27', amount: 40 },
        { date: '2026-09-28', amount: 50 }
      ]
    }],
    homewatch: []
  };
  const referenceDate = new Date(2026, 8, 28, 20, 0, 0);
  assert.equal(recentEmployeePay(state, 'emp', '1', referenceDate), 90);
});

test('filters admin notes and sorts pinned notes before newest notes without mutating input', () => {
  const notes = [
    { id: 'old', date: '2026-09-01', pinned: false, audience: 'team' },
    { id: 'admin', date: '2026-09-28', pinned: false, audience: 'admin' },
    { id: 'pinned-old', date: '2026-09-01', pinned: true, audience: 'team' },
    { id: 'pinned-new', date: '2026-09-28', pinned: true, audience: 'team' }
  ];
  const original = notes.slice();
  assert.deepEqual(visibleDashboardNotes(notes, { userId: 'emp', isAdmin: false }).map(note => note.id), [
    'pinned-new', 'pinned-old', 'old'
  ]);
  assert.deepEqual(notes, original);
  assert.equal(visibleDashboardNotes(notes, { userId: 'admin', isAdmin: true }).length, 4);
});
