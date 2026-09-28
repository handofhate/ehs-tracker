(function attachTracker2PreviewFixtures(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2PreviewFixtures = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPreviewFixtures() {
  'use strict';

  // These records are deliberately kept outside the live Firestore state. They
  // are a stable, reviewable test dataset for the local Tracker 2.0 preview.
  const fixture = {
    clients: [
      { id: 'tracker2-preview-client-alpha', squareId: '', refId: '', firstName: 'Preview', surname: 'Payout Alpha', company: '', email: '', phone: '', address1: '', address2: '', city: '', state: '', postal: '', birthday: '', memo: '', emailSubStatus: '', firstVisit: '2026-09-28', lastVisit: '2026-09-28', txCount: 1, lifetimeSpend: '', clientNotes: [] },
      { id: 'tracker2-preview-client-beta', squareId: '', refId: '', firstName: 'Preview', surname: 'Payout Beta', company: '', email: '', phone: '', address1: '', address2: '', city: '', state: '', postal: '', birthday: '', memo: '', emailSubStatus: '', firstVisit: '2026-09-28', lastVisit: '2026-09-28', txCount: 1, lifetimeSpend: '', clientNotes: [] },
      { id: 'tracker2-preview-client-gamma', squareId: '', refId: '', firstName: 'Preview', surname: 'Payout Gamma', company: '', email: '', phone: '', address1: '', address2: '', city: '', state: '', postal: '', birthday: '', memo: '', emailSubStatus: '', firstVisit: '2026-09-28', lastVisit: '2026-09-28', txCount: 1, lifetimeSpend: '', clientNotes: [] }
    ],
    jobs: [
      makeJob({
        id: 'tracker2-preview-job-alpha',
        name: 'Preview Payout Alpha',
        clientId: 'tracker2-preview-client-alpha',
        lineId: 'tracker2-preview-line-alpha',
        milestoneId: 'tracker2-preview-milestone-alpha',
        amount: 1000,
        description: 'Completed fixed labor',
        workCompleted: true
      }),
      makeJob({
        id: 'tracker2-preview-job-beta',
        name: 'Preview Payout Beta',
        clientId: 'tracker2-preview-client-beta',
        lineId: 'tracker2-preview-line-beta',
        milestoneId: 'tracker2-preview-milestone-beta',
        amount: 600,
        description: 'Completed fixed labor',
        workCompleted: true
      }),
      makeJob({
        id: 'tracker2-preview-job-gamma',
        name: 'Preview Payout Gamma',
        clientId: 'tracker2-preview-client-gamma',
        lineId: 'tracker2-preview-line-gamma',
        milestoneId: 'tracker2-preview-milestone-gamma',
        amount: 350,
        description: 'Completed labor on hold',
        workCompleted: false
      })
    ],
    dashboardNotes: [
      {
        id: 'tracker2-preview-note-payout',
        text: 'Preview payout test data: Alpha and Beta are available for employee payment allocation. Gamma is intentionally on hold.',
        date: '2026-09-28',
        authorId: '',
        authorName: 'Tracker 2.0 Preview',
        audience: 'team',
        done: false,
        pinned: true
      },
      {
        id: 'tracker2-preview-note-undo',
        text: 'Use this preview to test payout edits, allocation changes, undo/redo, and the refresh-live-data behavior without touching Firestore.',
        date: '2026-09-27',
        authorId: '',
        authorName: 'Tracker 2.0 Preview',
        audience: 'team',
        done: false,
        pinned: false
      },
      {
        id: 'tracker2-preview-note-complete',
        text: 'Example completed preview note for testing the done state and strikethrough styling.',
        date: '2026-09-26',
        authorId: '',
        authorName: 'Tracker 2.0 Preview',
        audience: 'admin',
        done: true,
        pinned: false
      }
    ]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeJob({ id, name, clientId, lineId, milestoneId, amount, description, workCompleted }) {
    return {
      id,
      status: 'active',
      name,
      contactName: '',
      clientId,
      contactClientId: '',
      quote: amount,
      date: '2026-09-28',
      isItemized: true,
      quoteItems: [{ id: lineId, label: description, description, amount, status: 'pending', billingState: 'none', squarePaymentIds: [], reconcileStatus: 'none' }],
      milestones: [{ id: milestoneId, label: 'Invoice', pct: 100, status: 'pending', billingState: 'none', squarePaymentIds: [], reconcileStatus: 'none' }],
      addOns: [],
      subtractions: [],
      materials: [],
      workSummary: description,
      jobType: 'quoted',
      hourlyRate: 0,
      employeeId: '',
      createdVia: 'unified-v2',
      unifiedLines: [{ id: lineId, type: 'fixed', label: description, description, amount }],
      workCompleted,
      milestoneBasis: 'percent',
      advances: [],
      tips: [],
      fees: [],
      jobNotes: [],
      hours: [],
      partialCollections: [],
      repaymentMode: false,
      revenueItems: [],
      hourlyStatus: 'pending',
      hourlySquareInvoiceId: ''
    };
  }

  function mergeIntoState(input) {
    const state = clone(input || {});
    const appendMissing = (key, items) => {
      if (!Array.isArray(state[key])) state[key] = [];
      const existing = new Set(state[key].map(item => item?.id).filter(Boolean));
      items.forEach(item => {
        if (!existing.has(item.id)) state[key].push(clone(item));
      });
    };

    appendMissing('clients', fixture.clients);
    appendMissing('jobs', fixture.jobs);
    appendMissing('dashboardNotes', fixture.dashboardNotes);
    return state;
  }

  return Object.freeze({
    version: 1,
    fixture: Object.freeze(clone(fixture)),
    mergeIntoState
  });
});
