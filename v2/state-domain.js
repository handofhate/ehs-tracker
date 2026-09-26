(function attachTracker2State(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2State = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStateDomain() {
  'use strict';

  const DEFAULT_OWED_INCLUDE = Object.freeze({ jobs: true, homewatch: true, potential: true });
  const DEFAULT_CLIENT_COLUMNS = Object.freeze(['email', 'phone', 'city', 'lastVisit', 'lifetimeSpend']);
  const DEFAULT_CLIENT_QUICK_COLUMNS = Object.freeze([
    'email', 'phone', 'address1', 'city', 'state', 'postal', 'birthday',
    'txCount', 'lifetimeSpend', 'firstVisit', 'lastVisit'
  ]);

  function sanitizeTheme(theme) {
    return ['default', 'highContrast', 'simple'].includes(theme) ? theme : 'default';
  }

  function normalizeOwedInclude(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      jobs: src.jobs !== undefined ? !!src.jobs : DEFAULT_OWED_INCLUDE.jobs,
      homewatch: src.homewatch !== undefined ? !!src.homewatch : DEFAULT_OWED_INCLUDE.homewatch,
      potential: src.potential !== undefined ? !!src.potential : DEFAULT_OWED_INCLUDE.potential
    };
  }

  function normalizeLegacyPartialState(job, options = {}) {
    const idFactory = options.idFactory || (() => 'generated-id');
    const today = options.today || (() => '');

    (job.milestones || []).forEach(m => {
      if (m.partialState === undefined) m.partialState = '';
      if (m.partialGroupId === undefined) m.partialGroupId = '';
      if (m.partialParentLabel === undefined) m.partialParentLabel = '';
      if (m.partialParentPct === undefined) m.partialParentPct = 0;
      if (m.partialParentAmount === undefined) m.partialParentAmount = 0;
      if (m.partialMode === undefined) m.partialMode = '';
      if (m.partialPercent === undefined) m.partialPercent = 0;
      if (m.partialDate === undefined) m.partialDate = '';
    });
    (job.addOns || []).forEach(a => {
      if (a.partialState === undefined) a.partialState = '';
      if (a.partialGroupId === undefined) a.partialGroupId = '';
      if (a.partialParentAmount === undefined) a.partialParentAmount = 0;
      if (a.partialParentLabel === undefined) a.partialParentLabel = '';
      if (a.partialMode === undefined) a.partialMode = '';
      if (a.partialPercent === undefined) a.partialPercent = 0;
      if (a.partialDate === undefined) a.partialDate = '';
    });
    (job.revenueItems || []).forEach(r => {
      if (r.partialState === undefined) r.partialState = '';
      if (r.partialGroupId === undefined) r.partialGroupId = '';
      if (r.partialParentAmount === undefined) r.partialParentAmount = 0;
      if (r.partialParentLabel === undefined) r.partialParentLabel = '';
      if (r.partialMode === undefined) r.partialMode = '';
      if (r.partialPercent === undefined) r.partialPercent = 0;
      if (r.partialDate === undefined) r.partialDate = '';
    });
    (job.subtractions || []).forEach(a => {
      if (a.partialState === undefined) a.partialState = '';
      if (a.partialGroupId === undefined) a.partialGroupId = '';
      if (a.partialParentAmount === undefined) a.partialParentAmount = 0;
      if (a.partialParentLabel === undefined) a.partialParentLabel = '';
      if (a.partialMode === undefined) a.partialMode = '';
      if (a.partialPercent === undefined) a.partialPercent = 0;
      if (a.partialDate === undefined) a.partialDate = '';
    });
    if (!job.partialCollections) job.partialCollections = [];
    (job.partialCollections || []).forEach(p => {
      if (!p.id) p.id = idFactory();
      if (p.date === undefined) p.date = job.date || today();
      if (p.note === undefined) p.note = '';
      if (p.mode === undefined) p.mode = 'dollar';
      if (p.partialPercent === undefined) p.partialPercent = 0;
      if (p.paymentTotal === undefined) p.paymentTotal = 0;
      if (p.tipAmount === undefined) p.tipAmount = 0;
      if (p.autoSub === undefined) p.autoSub = false;
      if (!p.presetByKey || typeof p.presetByKey !== 'object') p.presetByKey = {};
      if (!p.snapshotBefore || typeof p.snapshotBefore !== 'object') {
        p.snapshotBefore = {
          milestones: JSON.parse(JSON.stringify(job.milestones || [])),
          revenueItems: JSON.parse(JSON.stringify(job.revenueItems || [])),
          addOns: JSON.parse(JSON.stringify(job.addOns || [])),
          subtractions: JSON.parse(JSON.stringify(job.subtractions || []))
        };
      }
      if (!Array.isArray(p.snapshotBefore.revenueItems)) {
        p.snapshotBefore.revenueItems = JSON.parse(JSON.stringify(job.revenueItems || []));
      }
      if (p.createdAt === undefined) p.createdAt = '';
    });
  }

  function normalizeLegacyState(s, options = {}) {
    (s.jobs || []).forEach(job => normalizeLegacyPartialState(job, options));
    return s;
  }

  function normalizeCurrentState(s, options = {}) {
    const idFactory = options.idFactory || (() => 'generated-id');
    const today = options.today || (() => '');
    const clientColumnKeys = Array.isArray(options.clientColumnKeys)
      ? options.clientColumnKeys
      : [];
    const normalizeInclude = options.normalizeOwedInclude || normalizeOwedInclude;
    const sanitizeUserTheme = options.sanitizeTheme || sanitizeTheme;

    if (!s.settings.empName) s.settings.empName = 'Employee';
    if (s.settings.debtOriginal === undefined) s.settings.debtOriginal = 2256.58;
    if (s.settings.debtOwnerShare === undefined) s.settings.debtOwnerShare = 0.50;
    if (s.settings.feeRate === undefined) s.settings.feeRate = 0.026;
    if (s.settings.txnFee === undefined) s.settings.txnFee = 0.30;
    if (!Array.isArray(s.settings.feeChangeLog)) s.settings.feeChangeLog = [];
    if (!s.settings.defaultMilestones) s.settings.defaultMilestones = [];
    if (s.settings.defaultMilestoneBasis !== 'amount') s.settings.defaultMilestoneBasis = 'percent';
    if (!s.settings.square || typeof s.settings.square !== 'object') s.settings.square = {};
    if (s.settings.square.functionBaseUrl === undefined) s.settings.square.functionBaseUrl = '';
    if (s.settings.square.highValueConfirmAmount === undefined) s.settings.square.highValueConfirmAmount = 1000;
    s.settings.owedSummaryInclude = normalizeInclude(s.settings.owedSummaryInclude);
    if (!s.debtPayments) s.debtPayments = [];
    if (!s.splitPayments) s.splitPayments = [];
    (s.splitPayments || []).forEach(p => {
      if (!p.id) p.id = idFactory();
      if (p.date === undefined) p.date = today();
      if (p.label === undefined) p.label = 'Split payment';
      if (p.total === undefined) p.total = 0;
      if (p.mode === undefined) p.mode = 'split';
      if (p.employeeId === undefined) p.employeeId = '';
      if (!Array.isArray(p.allocations)) p.allocations = [];
      if (p.createdAt === undefined) p.createdAt = '';
    });
    (s.debtPayments).forEach(p => {
      if (p.linkedJobId === undefined) p.linkedJobId = null;
      if (p.linkedHWId  === undefined) p.linkedHWId  = null;
    });
    if (!s.users) s.users = [];
    if (!s.appointments) s.appointments = [];
    (s.appointments || []).forEach(a => {
      if (a.contactName === undefined) a.contactName = '';
      if (a.endTime === undefined) a.endTime = '';
    });
    if (!s.clients) s.clients = [];
    (s.clients || []).forEach(c => {
      if (!Array.isArray(c.clientNotes)) {
        c.clientNotes = [];
      }
    });
    if (!Array.isArray(s.dashboardNotes)) s.dashboardNotes = [];
    s.dashboardNotes = s.dashboardNotes
      .filter(note => note && typeof note === 'object' && String(note.text || '').trim())
      .map(note => {
        const { important: legacyImportant, ...noteWithoutLegacyFlag } = note;
        return {
        ...noteWithoutLegacyFlag,
        id: note.id || idFactory(),
        text: String(note.text || '').trim(),
        date: note.date === undefined ? today() : String(note.date || ''),
        authorId: note.authorId === undefined ? '' : String(note.authorId || ''),
        authorName: note.authorName === undefined ? '' : String(note.authorName || ''),
        audience: note.audience === 'admin' ? 'admin' : 'team',
        done: !!note.done,
        pinned: !!(note.pinned || legacyImportant)
      }; });
    if (!s.settings.clientColumns) s.settings.clientColumns = [...DEFAULT_CLIENT_COLUMNS];
    if (!s.settings.clientExpandCols) s.settings.clientExpandCols = [...clientColumnKeys];
    if (!s.settings.clientQuickCols) s.settings.clientQuickCols = [...DEFAULT_CLIENT_QUICK_COLUMNS];
    const cleanClientKeys = (keys, fallback) => {
      if (!Array.isArray(keys)) return [...fallback];
      const allowed = new Set(clientColumnKeys);
      return keys.filter(key => allowed.has(key));
    };
    if (!s.settings.clientDefaults || typeof s.settings.clientDefaults !== 'object' || Array.isArray(s.settings.clientDefaults)) {
      s.settings.clientDefaults = {};
    }
    if (!Array.isArray(s.settings.clientDefaults.columns)) {
      s.settings.clientDefaults.columns = cleanClientKeys(s.settings.clientColumns, DEFAULT_CLIENT_COLUMNS);
    }
    if (!Array.isArray(s.settings.clientDefaults.expandCols)) {
      s.settings.clientDefaults.expandCols = cleanClientKeys(s.settings.clientExpandCols, clientColumnKeys);
    }
    if (!Array.isArray(s.settings.clientDefaults.quickCols)) {
      s.settings.clientDefaults.quickCols = cleanClientKeys(s.settings.clientQuickCols, DEFAULT_CLIENT_QUICK_COLUMNS);
    }
    // Ensure there's always at least one admin user seeded
    if (s.users.length === 0) {
      s.users.push({ id: 'admin_default', name: 'Ty', pin: '1234', isAdmin: true });
    }
    (s.users).forEach(u => {
      if (!u.clientPrefs || typeof u.clientPrefs !== 'object') u.clientPrefs = {};
      if (!u.uiPrefs || typeof u.uiPrefs !== 'object') u.uiPrefs = {};
      if (!u.uiPrefs.theme) u.uiPrefs.theme = u.uiPrefs.highContrast ? 'highContrast' : 'default';
      u.uiPrefs.theme = sanitizeUserTheme(u.uiPrefs.theme);
    });
    const defaultEmp = (s.users).find(u => !u.isAdmin);
    if (!s.settings.debtEmployeeId && defaultEmp) s.settings.debtEmployeeId = defaultEmp.id;
    if (!s.homewatch) s.homewatch = [];
    (s.homewatch || []).forEach(hw => {
      if (!hw.payments) hw.payments = [];
      if (!hw.hwNotes) hw.hwNotes = [];
      if (!hw.advances) hw.advances = [];
      if (!hw.status) hw.status = 'active';
      hw.payments.forEach(p => {
        if (!p.status) p.status = 'pending';
        if (!p.billingState) p.billingState = 'none';
        if (!p.squarePaymentIds) p.squarePaymentIds = [];
        if (!p.reconcileStatus) p.reconcileStatus = 'none';
      });
      if (!hw.employeeId && defaultEmp) hw.employeeId = defaultEmp.id;
      (hw.advances || []).forEach(a => {
        if (a.splitEventId === undefined) a.splitEventId = '';
        if (a.payType === undefined) a.payType = '';
        if (a.label === undefined) a.label = '';
        if (a.date === undefined) a.date = '';
      });
    });
    (s.jobs || []).forEach(job => {
      delete job._expanded; // moved to local localStorage - not stored in Firestore
      if (!job.employeeId && defaultEmp) job.employeeId = defaultEmp.id;
      if (job.jobType !== 'hourly' && job.jobType !== 'quoted') job.jobType = 'quoted';
      if (job.hourlyRate === undefined) job.hourlyRate = 0;
      if (job.workCompleted === undefined) job.workCompleted = true;
      if (job.milestoneBasis !== 'amount') job.milestoneBasis = 'percent';
      if (!job.hourlyStatus) job.hourlyStatus = 'pending';
      if (!job.hourlySquareInvoiceId) job.hourlySquareInvoiceId = '';
      if (job.repaymentMode === undefined) job.repaymentMode = false;
      if (job.contactName === undefined) job.contactName = '';
      if (!job.jobNotes) job.jobNotes = [];
      if (!job.hours) job.hours = [];
      if (!job.advances) job.advances = [];
      if (!job.tips) job.tips = [];
      (job.advances || []).forEach(a => {
        if (a.splitEventId === undefined) a.splitEventId = '';
        if (a.payType === undefined) a.payType = '';
        if (a.label === undefined) a.label = '';
        if (a.date === undefined) a.date = '';
      });
      (job.tips || []).forEach(t => {
        if (!t.id) t.id = idFactory();
        if (t.label === undefined) t.label = 'Client tip';
        if (t.amount === undefined) t.amount = 0;
        if (t.date === undefined) t.date = '';
      });
      (job.milestones || []).forEach(m => {
        if (m.status === undefined) m.status = 'pending';
        if (!m.billingState) m.billingState = 'none';
        if (!m.squarePaymentIds) m.squarePaymentIds = [];
        if (!m.reconcileStatus) m.reconcileStatus = 'none';
      });
      (job.addOns || []).forEach(a => {
        if (a.status === undefined) a.status = 'pending';
        if (a.date === undefined) a.date = '';
        if (!a.billingState) a.billingState = 'none';
        if (!a.squarePaymentIds) a.squarePaymentIds = [];
        if (!a.reconcileStatus) a.reconcileStatus = 'none';
        if (a.isHours === undefined) a.isHours = false;
        if (a.hours === undefined) a.hours = 0;
        if (a.rate === undefined) a.rate = 0;
      });
      if (!job.revenueItems) job.revenueItems = [];
      (job.revenueItems || []).forEach(r => {
        if (r.status === undefined) { r.status = 'pending'; }
        if (r.date === undefined) r.date = '';
        if (!r.billingState) r.billingState = 'none';
        if (!r.squarePaymentIds) r.squarePaymentIds = [];
        if (!r.reconcileStatus) r.reconcileStatus = 'none';
      });
      if (!job.subtractions) job.subtractions = [];
      (job.subtractions || []).forEach(a => {
        if (a.status === undefined) { a.status = 'pending'; }
        if (a.date === undefined) a.date = '';
        if (a.sourceItemId === undefined) a.sourceItemId = null;
        if (!a.billingState) a.billingState = 'none';
        if (!a.squarePaymentIds) a.squarePaymentIds = [];
        if (!a.reconcileStatus) a.reconcileStatus = 'none';
      });
      if (job.isItemized === undefined) job.isItemized = false;
      if (!job.quoteItems) job.quoteItems = [];
    });
    return s;
  }

  function migrateState(s, options = {}) {
    normalizeLegacyState(s, options);
    normalizeCurrentState(s, options);
    return s;
  }

  return Object.freeze({
    migrateState,
    normalizeCurrentState,
    normalizeLegacyState,
    normalizeOwedInclude,
    sanitizeTheme
  });
});
