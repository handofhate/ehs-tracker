// ─── FIREBASE ─────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCZyxBVvINYbPeWSDkNPZsxnw9f_6uGEV4",
  authDomain: "ehs-tracker-7d6ed.firebaseapp.com",
  projectId: "ehs-tracker-7d6ed",
  storageBucket: "ehs-tracker-7d6ed.firebasestorage.app",
  messagingSenderId: "1043751819433",
  appId: "1:1043751819433:web:1cdd11e6fd9efb4d0871b8"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const DOC = db.collection('jobtracker').doc('state');

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = {
  settings: {
    empName: 'Employee',
    empShare: 0.66,
    feeRate: 0.026,
    txnFee: 0.30,
    debtOriginal: 2256.58,
    debtOwnerShare: 0.50,
    defaultMilestones: [],
    square: { functionBaseUrl: '', highValueConfirmAmount: 1000 }
  },
  debtPayments: [],
  splitPayments: [],
  jobs: [],
  users: [],
  appointments: [],
  homewatch: []
};
let editingJobId = null;
let addItemContext = null;
let payOutCtx = { employeeId: '', mode: 'pay_now' };
let expandedJobs = new Set(); // local only - never saved to Firestore
let expandedHW   = new Set(); // local only - never saved to Firestore
let expandedClients = new Set();
let notesCtx = null; // { type: 'job'|'hw', id }
let empSummaryTimeframe = '30'; // days, or 'all' (user-scoped local preference)
let hoursJobId = null;
let editNoteCtx = null;
let isSaving = false;
let currentUser = null; // { id, name, isAdmin }
let editingApptId = null;
let resetPinUserId = null;
let partialCollectCtx = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let schedView = 'list'; // 'list' | 'month'
let selectedCalDay = null;
let selectedDayFilter = null; // mobile day-drill-down
const OWED_INCLUDE_DEFAULTS = { jobs: true, homewatch: true, potential: true };

function normalizeOwedInclude(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    jobs: src.jobs !== undefined ? !!src.jobs : OWED_INCLUDE_DEFAULTS.jobs,
    homewatch: src.homewatch !== undefined ? !!src.homewatch : OWED_INCLUDE_DEFAULTS.homewatch,
    potential: src.potential !== undefined ? !!src.potential : OWED_INCLUDE_DEFAULTS.potential
  };
}

function _uiUserId() { return currentUser?.id || 'default'; }
function _uiKey(name) { return `${name}_${_uiUserId()}`; }
function loadUserUiState() {
  try {
    const tf = localStorage.getItem(_uiKey('empSummaryTF'));
    empSummaryTimeframe = tf || '30';
  } catch(e) { empSummaryTimeframe = '30'; }
  try {
    const sched = JSON.parse(localStorage.getItem(_uiKey('schedUI')) || '{}');
    schedView = (sched.view === 'month' || sched.view === 'list') ? sched.view : 'list';
    if (typeof sched.calYear === 'number') calYear = sched.calYear;
    if (typeof sched.calMonth === 'number' && sched.calMonth >= 0 && sched.calMonth <= 11) calMonth = sched.calMonth;
    selectedCalDay = sched.selectedCalDay || null;
    selectedDayFilter = sched.selectedDayFilter || null;
  } catch(e) {
    schedView = 'list';
    calYear = new Date().getFullYear();
    calMonth = new Date().getMonth();
    selectedCalDay = null;
    selectedDayFilter = null;
  }
  try {
    expandedClients = new Set(JSON.parse(localStorage.getItem(_uiKey('expClients')) || '[]'));
  } catch(e) { expandedClients = new Set(); }
}
function _currentUserRecord() {
  const id = currentUser?.id;
  if (!id) return null;
  return (state.users || []).find(u => u.id === id) || null;
}
function _sanitizeTheme(theme) {
  return ['default', 'highContrast', 'simple'].includes(theme) ? theme : 'default';
}
function _themeForCurrentUser() {
  const user = _currentUserRecord();
  if (user?.uiPrefs?.theme) return _sanitizeTheme(user.uiPrefs.theme);
  return user?.uiPrefs?.highContrast ? 'highContrast' : 'default';
}
function _syncThemeControls(theme) {
  const activeTheme = _sanitizeTheme(theme);
  document.querySelectorAll('[data-theme-option]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeOption === activeTheme);
    btn.setAttribute('aria-pressed', btn.dataset.themeOption === activeTheme ? 'true' : 'false');
  });
}
function applyTheme(theme = _themeForCurrentUser()) {
  const activeTheme = _sanitizeTheme(theme);
  document.body.classList.toggle('high-contrast', activeTheme === 'highContrast');
  document.body.classList.toggle('simple-theme', activeTheme === 'simple');
  _syncThemeControls(activeTheme);
}
function setTheme(theme) {
  const user = _currentUserRecord();
  if (!user) return;
  if (!user.uiPrefs || typeof user.uiPrefs !== 'object') user.uiPrefs = {};
  user.uiPrefs.theme = _sanitizeTheme(theme);
  delete user.uiPrefs.highContrast;
  applyTheme(user.uiPrefs.theme);
  save();
}
function saveEmpSummaryTimeframe() {
  try { localStorage.setItem(_uiKey('empSummaryTF'), empSummaryTimeframe); } catch(e) {}
}
function setEmpSummaryTimeframe(value) {
  empSummaryTimeframe = value || '30';
  saveEmpSummaryTimeframe();
  renderEmpSummary();
}
function saveScheduleUiState() {
  try {
    localStorage.setItem(_uiKey('schedUI'), JSON.stringify({
      view: schedView,
      calYear,
      calMonth,
      selectedCalDay: selectedCalDay || '',
      selectedDayFilter: selectedDayFilter || ''
    }));
  } catch(e) {}
}
function saveExpandedClientsState() {
  try { localStorage.setItem(_uiKey('expClients'), JSON.stringify([...expandedClients])); } catch(e) {}
}

// ─── PERSIST ─────────────────────────────────────────────────────────────────
function migrateState(s) {
  if (!s.settings.empName) s.settings.empName = 'Employee';
  if (s.settings.historicalAdj !== undefined && s.settings.debtOriginal === undefined) {
    s.settings.debtOriginal = s.settings.historicalAdj;
    delete s.settings.historicalAdj;
  }
  if (s.settings.debtOriginal === undefined) s.settings.debtOriginal = 2256.58;
  if (s.settings.debtOwnerShare === undefined) s.settings.debtOwnerShare = 0.50;
  if (s.settings.txnFee === undefined) s.settings.txnFee = 0.30;
  if (!s.settings.defaultMilestones) s.settings.defaultMilestones = [];
  if (!s.settings.square || typeof s.settings.square !== 'object') s.settings.square = {};
  if (s.settings.square.functionBaseUrl === undefined) s.settings.square.functionBaseUrl = '';
  if (s.settings.square.highValueConfirmAmount === undefined) s.settings.square.highValueConfirmAmount = 1000;
  s.settings.owedSummaryInclude = normalizeOwedInclude(s.settings.owedSummaryInclude);
  if (!s.debtPayments) s.debtPayments = [];
  if (!s.splitPayments) s.splitPayments = [];
  (s.splitPayments || []).forEach(p => {
    if (!p.id) p.id = uid();
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
  (s.appointments||[]).forEach(a => {
    if (a.contactName === undefined) a.contactName = '';
    if (a.endTime === undefined) a.endTime = '';
  });
  if (!s.clients) s.clients = [];
  (s.clients || []).forEach(c => {
    if (typeof c.clientNotes === 'string') {
      c.clientNotes = c.clientNotes.trim()
        ? [{ id: uid(), text: c.clientNotes, date: today(), authorId: '', authorName: 'Admin' }]
        : [];
    } else if (!Array.isArray(c.clientNotes)) {
      c.clientNotes = [];
    }
  });
  if (!s.settings.clientColumns) s.settings.clientColumns = ['email','phone','city','lastVisit','lifetimeSpend'];
  if (!s.settings.clientExpandCols) s.settings.clientExpandCols = CLIENT_COLS.map(c=>c.key);
  if (!s.settings.clientQuickCols) s.settings.clientQuickCols = ['email','phone','address1','city','state','postal','birthday','txCount','lifetimeSpend','firstVisit','lastVisit'];
  // Ensure there's always at least one admin user seeded
  if (s.users.length === 0) {
    s.users.push({ id: 'admin_default', name: 'Ty', pin: '1234', isAdmin: true });
  }
  // Seed empShare on existing non-admin users from legacy global setting
  const legacyEmpShare = s.settings.empShare ?? 0.66;
  (s.users).forEach(u => {
    if (!u.isAdmin && u.empShare === undefined) u.empShare = legacyEmpShare;
    if (!u.clientPrefs || typeof u.clientPrefs !== 'object') u.clientPrefs = {};
    if (!u.uiPrefs || typeof u.uiPrefs !== 'object') u.uiPrefs = {};
    if (!u.uiPrefs.theme) u.uiPrefs.theme = u.uiPrefs.highContrast ? 'highContrast' : 'default';
    u.uiPrefs.theme = _sanitizeTheme(u.uiPrefs.theme);
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
    if (job.jobType === 'hourly2') job.jobType = 'hourly';
    if (job.jobType !== 'hourly' && job.jobType !== 'quoted') job.jobType = 'quoted';
    if (job.hourlyRate === undefined) job.hourlyRate = 0;
    if (!job.hourlyStatus) job.hourlyStatus = 'pending';
    if (!job.hourlySquareInvoiceId) job.hourlySquareInvoiceId = '';
    if (job.repaymentMode === undefined) job.repaymentMode = false;
    if (job.contactName === undefined) job.contactName = '';
    if (!job.jobNotes) {
      job.jobNotes = [];
      if (job.notes && typeof job.notes === 'string' && job.notes.trim()) {
        job.jobNotes.push({ id: uid(), text: job.notes, date: job.date || today() });
      }
    }
    delete job.notes;
    if (!job.hours) job.hours = [];
    if (!job.advances) job.advances = [];
    (job.advances || []).forEach(a => {
      if (a.splitEventId === undefined) a.splitEventId = '';
      if (a.payType === undefined) a.payType = '';
      if (a.label === undefined) a.label = '';
      if (a.date === undefined) a.date = '';
    });
    (job.milestones || []).forEach(m => {
      if (m.status === undefined) { m.status = m.collected ? 'collected' : 'pending'; delete m.collected; }
      if (!m.billingState) m.billingState = 'none';
      if (!m.squarePaymentIds) m.squarePaymentIds = [];
      if (!m.reconcileStatus) m.reconcileStatus = 'none';
      if (m.partialState === undefined) m.partialState = '';
      if (m.partialGroupId === undefined) m.partialGroupId = '';
      if (m.partialParentLabel === undefined) m.partialParentLabel = '';
      if (m.partialParentPct === undefined) m.partialParentPct = 0;
      if (m.partialMode === undefined) m.partialMode = '';
      if (m.partialPercent === undefined) m.partialPercent = 0;
      if (m.partialDate === undefined) m.partialDate = '';
    });
    (job.addOns || []).forEach(a => {
      if (a.status === undefined) { a.status = a.collected ? 'collected' : 'pending'; delete a.collected; }
      if (a.date === undefined) a.date = '';
      if (!a.billingState) a.billingState = 'none';
      if (!a.squarePaymentIds) a.squarePaymentIds = [];
      if (!a.reconcileStatus) a.reconcileStatus = 'none';
      if (a.partialState === undefined) a.partialState = '';
      if (a.partialGroupId === undefined) a.partialGroupId = '';
      if (a.partialParentAmount === undefined) a.partialParentAmount = 0;
      if (a.partialParentLabel === undefined) a.partialParentLabel = '';
      if (a.partialMode === undefined) a.partialMode = '';
      if (a.partialPercent === undefined) a.partialPercent = 0;
      if (a.partialDate === undefined) a.partialDate = '';
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
      if (r.partialState === undefined) r.partialState = '';
      if (r.partialGroupId === undefined) r.partialGroupId = '';
      if (r.partialParentAmount === undefined) r.partialParentAmount = 0;
      if (r.partialParentLabel === undefined) r.partialParentLabel = '';
      if (r.partialMode === undefined) r.partialMode = '';
      if (r.partialPercent === undefined) r.partialPercent = 0;
      if (r.partialDate === undefined) r.partialDate = '';
    });
    if (!job.subtractions) job.subtractions = [];
    (job.subtractions || []).forEach(a => {
      if (a.status === undefined) { a.status = 'pending'; }
      if (a.date === undefined) a.date = '';
      if (a.sourceItemId === undefined) a.sourceItemId = null;
      if (!a.billingState) a.billingState = 'none';
      if (!a.squarePaymentIds) a.squarePaymentIds = [];
      if (!a.reconcileStatus) a.reconcileStatus = 'none';
      if (a.partialState === undefined) a.partialState = '';
      if (a.partialGroupId === undefined) a.partialGroupId = '';
      if (a.partialParentAmount === undefined) a.partialParentAmount = 0;
      if (a.partialParentLabel === undefined) a.partialParentLabel = '';
      if (a.partialMode === undefined) a.partialMode = '';
      if (a.partialPercent === undefined) a.partialPercent = 0;
      if (a.partialDate === undefined) a.partialDate = '';
    });
    if (job.isItemized === undefined) job.isItemized = false;
    if (!job.quoteItems) job.quoteItems = [];
    if (!job.partialCollections) job.partialCollections = [];
    (job.partialCollections || []).forEach(p => {
      if (!p.id) p.id = uid();
      if (p.date === undefined) p.date = job.date || today();
      if (p.note === undefined) p.note = '';
      if (p.mode === undefined) p.mode = 'dollar';
      if (p.partialPercent === undefined) p.partialPercent = 0;
      if (p.paymentTotal === undefined) p.paymentTotal = 0;
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
  });
  return s;
}

const undoStack = [];
const redoStack = [];
const UNDO_MAX = 50;
// Tracks the last successfully written state so save() always snapshots
// the pre-mutation baseline, not the already-mutated current state.
let _lastSavedState = null;

async function save() {
  if (isSaving) return;
  // Push the last confirmed Firestore state (pre-mutation baseline) onto undo stack
  if (_lastSavedState !== null) {
    undoStack.push(JSON.parse(JSON.stringify(_lastSavedState)));
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  redoStack.length = 0;
  _updateUndoBtn();
  _updateRedoBtn();
  isSaving = true;
  try {
    await DOC.set(JSON.parse(JSON.stringify(state)));
    // Record the just-written state as the new baseline
    _lastSavedState = JSON.parse(JSON.stringify(state));
  } catch(e) {
    console.error('Save failed:', e);
    showAlert('Save failed - check your connection.');
  } finally {
    isSaving = false;
  }
}

async function undoAction() {
  if (!undoStack.length) { showAlert('Nothing to undo.'); return; }
  const prev = undoStack.pop();
  const description = _describeUndoAction(prev, state);
  redoStack.push(JSON.parse(JSON.stringify(state)));
  _lastSavedState = JSON.parse(JSON.stringify(prev));
  _updateUndoBtn();
  _updateRedoBtn();
  _showUndoToast('Undo: ' + description);
  isSaving = true;
  try {
    await DOC.set(prev);
    // Apply directly - do not rely on onSnapshot (it fires before set() resolves and gets suppressed by isSaving)
    _applyRestoredState(prev);
  } catch(e) {
    console.error('Undo failed:', e);
    showAlert('Undo failed - check your connection.');
    undoStack.push(prev);
    redoStack.pop();
    _lastSavedState = JSON.parse(JSON.stringify(state));
    _updateUndoBtn();
    _updateRedoBtn();
  } finally {
    isSaving = false;
  }
}

async function redoAction() {
  if (!redoStack.length) { showAlert('Nothing to redo.'); return; }
  const next = redoStack.pop();
  const description = _describeUndoAction(state, next);
  undoStack.push(JSON.parse(JSON.stringify(state)));
  _lastSavedState = JSON.parse(JSON.stringify(next));
  _updateUndoBtn();
  _updateRedoBtn();
  _showUndoToast('Redo: ' + description);
  isSaving = true;
  try {
    await DOC.set(next);
    _applyRestoredState(next);
  } catch(e) {
    console.error('Redo failed:', e);
    showAlert('Redo failed - check your connection.');
    redoStack.push(next);
    undoStack.pop();
    _lastSavedState = JSON.parse(JSON.stringify(state));
    _updateUndoBtn();
    _updateRedoBtn();
  } finally {
    isSaving = false;
  }
}

function _applyRestoredState(restored) {
  state = migrateState(JSON.parse(JSON.stringify(restored)));
  if (currentUser) {
    const fresh = state.users.find(u => u.id === currentUser.id);
    if (fresh) currentUser = { id: fresh.id, name: fresh.name, isAdmin: fresh.isAdmin };
  }
  renderAll();
}

function _updateUndoBtn() {
  const btn = document.getElementById('undoBtn');
  if (!btn) return;
  btn.style.opacity = undoStack.length ? '1' : '0.35';
  btn.title = undoStack.length ? `Undo (${undoStack.length} action${undoStack.length!==1?'s':''})` : 'Nothing to undo';
}

function _updateRedoBtn() {
  const btn = document.getElementById('redoBtn');
  if (!btn) return;
  btn.style.opacity = redoStack.length ? '1' : '0.35';
  btn.title = redoStack.length ? `Redo (${redoStack.length} action${redoStack.length!==1?'s':''})` : 'Nothing to redo';
}
function _showUndoToast(msg) {
  const t = document.getElementById('undoToast');
  if (!t) return;
  t.textContent = msg || 'Undo applied';
  t.classList.remove('show');
  // Force reflow so re-triggering the animation works
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function _describeUndoAction(prev, curr) {
  // Compare prev (before action) vs curr (current/after) to describe what was done
  const pj = prev.jobs || [], cj = curr.jobs || [];
  if (cj.length > pj.length) {
    const a = cj.find(j => !pj.find(p => p.id === j.id));
    return `Added job "${a?.name || ''}"`;
  }
  if (cj.length < pj.length) {
    const r = pj.find(j => !cj.find(c => c.id === j.id));
    return `Deleted job "${r?.name || ''}"`;
  }
  for (const cjob of cj) {
    const pjob = pj.find(p => p.id === cjob.id);
    if (pjob && JSON.stringify(cjob) !== JSON.stringify(pjob)) {
      if (cjob.name !== pjob.name) return `Renamed job to "${cjob.name}"`;
      if (JSON.stringify(cjob.milestones) !== JSON.stringify(pjob.milestones)) return `Updated milestones on "${cjob.name}"`;
      if (JSON.stringify(cjob.advances) !== JSON.stringify(pjob.advances)) return `Updated advance on "${cjob.name}"`;
      if (cjob.status !== pjob.status) return `Marked "${cjob.name}" ${cjob.status}`;
      return `Updated job "${cjob.name}"`;
    }
  }
  const ph = prev.homewatch || [], ch = curr.homewatch || [];
  if (ch.length > ph.length) {
    const a = ch.find(h => !ph.find(p => p.id === h.id));
    return `Added HW client "${a?.name || ''}"`;
  }
  if (ch.length < ph.length) {
    const r = ph.find(h => !ch.find(c => c.id === h.id));
    return `Deleted HW client "${r?.name || ''}"`;
  }
  for (const chw of ch) {
    const phw = ph.find(p => p.id === chw.id);
    if (phw && JSON.stringify(chw) !== JSON.stringify(phw)) {
      if (JSON.stringify(chw.payments) !== JSON.stringify(phw.payments)) return `Updated payment on "${chw.name}"`;
      if (chw.status !== phw.status) return `${chw.status === 'paused' ? 'Paused' : 'Resumed'} HW "${chw.name}"`;
      return `Updated HW client "${chw.name}"`;
    }
  }
  const pc = prev.clients || [], cc = curr.clients || [];
  if (cc.length > pc.length) {
    const a = cc.find(c => !pc.find(p => p.id === c.id));
    const n = [a?.firstName, a?.surname].filter(Boolean).join(' ') || a?.company || '';
    return `Added client "${n}"`;
  }
  if (cc.length < pc.length) {
    const r = pc.find(c => !cc.find(cur => cur.id === c.id));
    const n = [r?.firstName, r?.surname].filter(Boolean).join(' ') || r?.company || '';
    return `Deleted client "${n}"`;
  }
  for (const ccl of cc) {
    const pcl = pc.find(p => p.id === ccl.id);
    if (pcl && JSON.stringify(ccl) !== JSON.stringify(pcl)) {
      const n = [ccl.firstName, ccl.surname].filter(Boolean).join(' ') || ccl.company || '';
      if (JSON.stringify(ccl.clientNotes) !== JSON.stringify(pcl.clientNotes)) return `Updated notes for "${n}"`;
      return `Updated client "${n}"`;
    }
  }
  const pa = prev.appointments || [], ca = curr.appointments || [];
  if (ca.length > pa.length) return 'Added appointment';
  if (ca.length < pa.length) {
    const r = pa.find(a => !ca.find(c => c.id === a.id));
    return `Deleted appointment${r?.clientName ? ` for "${r.clientName}"` : ''}`;
  }
  for (const ca_ of ca) {
    const pa_ = pa.find(p => p.id === ca_.id);
    if (pa_ && JSON.stringify(ca_) !== JSON.stringify(pa_)) return `Updated appointment${ca_.clientName ? ` for "${ca_.clientName}"` : ''}`;
  }
  const pd = prev.debtPayments || [], cd = curr.debtPayments || [];
  if (cd.length > pd.length) return 'Logged debt payment';
  if (cd.length < pd.length) return 'Deleted debt payment';
  if (JSON.stringify(pd) !== JSON.stringify(cd)) return 'Updated debt payment';
  const pu = prev.users || [], cu = curr.users || [];
  if (cu.length > pu.length) return 'Added user';
  if (cu.length < pu.length) return 'Removed user';
  for (const cu_ of cu) {
    const pu_ = pu.find(p => p.id === cu_.id);
    if (pu_ && JSON.stringify(cu_) !== JSON.stringify(pu_)) return `Updated user "${cu_.name}"`;
  }
  if (JSON.stringify(prev.settings) !== JSON.stringify(curr.settings)) return 'Updated settings';
  return 'Last action';
}

function load() {
  // Check for old localStorage data to migrate on first run
  const legacy = localStorage.getItem('jobtracker_v2');

  DOC.get().then(doc => {
    if (doc.exists) {
      state = migrateState(doc.data());
      _lastSavedState = JSON.parse(JSON.stringify(state));
      if (syncHomewatchAutoInvoices()) {
        save();
      }
    } else if (legacy) {
      // First time using Firebase - migrate local data up
      try {
        state = migrateState(JSON.parse(legacy));
        syncHomewatchAutoInvoices();
        save(); // push to Firestore
        localStorage.removeItem('jobtracker_v2');
      } catch(e) {}
    }
    document.getElementById('loadingOverlay').style.display = 'none';
    showLogin();
  }).catch(e => {
    console.error('Load failed:', e);
    document.getElementById('loadingOverlay').innerHTML = `
      <div style="font-family:var(--mono);font-size:16px;color:var(--red)">Connection failed</div>
      <div style="font-family:var(--mono);font-size:13px;color:var(--text3);margin-top:8px">${esc(e.message)}</div>`;
  });

  // Real-time listener - keeps all open tabs/devices in sync
  DOC.onSnapshot(doc => {
    if (doc.exists && !isSaving) {
      _lastSavedState = JSON.parse(JSON.stringify(doc.data()));
      state = migrateState(doc.data());
      if (syncHomewatchAutoInvoices()) {
        save();
      }
      if (currentUser) {
        // Refresh currentUser data in case PIN/name changed
        const fresh = state.users.find(u => u.id === currentUser.id);
        if (fresh) currentUser = { id: fresh.id, name: fresh.name, isAdmin: fresh.isAdmin };
        applyTheme();
        renderAll();
      }
    }
  });
}
function uid() { return crypto.randomUUID(); }
function today() { return new Date().toISOString().slice(0,10); }
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '$0.00';
  n = _roundMoney(n);
  if (Object.is(n, -0) || Math.abs(n) < 0.005) n = 0;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return (n < 0 ? '-$' : '$') + s;
}
function fmtDate(d) {
  if (!d) return '';
  const p = d.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : d;
}
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _squareBaseUrl() {
  return (state.settings?.square?.functionBaseUrl || '').trim().replace(/\/+$/,'');
}

async function callSquareFn(endpoint, payload = {}) {
  const base = _squareBaseUrl();
  if (!base) throw new Error('Square Functions Base URL is not configured in Settings to Square API.');
  const u = firebase.auth().currentUser;
  if (!u) throw new Error('Not authenticated.');
  const token = await u.getIdToken();
  const res = await fetch(`${base}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
    body: JSON.stringify(payload || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = json?.code || '';
    err.details = json;
    throw err;
  }
  return json;
}

// ─── CALCULATIONS ─────────────────────────────────────────────────────────────
function calcSplit(gross, { empShare, feeRate, txnFee = 0, txnCount = 0 }) {
  const normalizedGross = _roundMoney(gross);
  const totalFees  = _roundMoney(normalizedGross * feeRate + txnFee * txnCount);
  const netRevenue = _roundMoney(normalizedGross - totalFees);
  const empOwed    = _roundMoney(netRevenue * empShare);
  const ownerOwed  = _roundMoney(netRevenue * (1 - empShare));
  return { totalFees, netRevenue, empOwed, ownerOwed };
}

function getEmp(userId) {
  return state.users.find(u => u.id === userId);
}
function _jobType(job) {
  if (job?.jobType === 'hourly' || job?.jobType === 'hourly2') return 'hourly';
  return 'quoted';
}

function calcJob(job) {
  const emp = getEmp(job.employeeId);
  const empShare = emp?.empShare ?? 0.66;
  const { feeRate, txnFee = 0, debtOwnerShare } = state.settings;
  const normalOwnerShare = 1 - empShare;
  const effectiveOwnerShare = job.repaymentMode ? (debtOwnerShare || 0.50) : normalOwnerShare;
  const effectiveEmpShare   = 1 - effectiveOwnerShare;
  const ownerShare = effectiveOwnerShare;
  const jobType = _jobType(job);
  const isLegacyHourly = false;
  const isHourly = jobType === 'hourly';
  const revenueItems = isLegacyHourly ? (job.revenueItems || []) : [];
  const revenueTotal = revenueItems.reduce((s, r) => s + (r.amount || 0), 0);
  const hourlyRate = Number(job.hourlyRate || 0);
  const hoursTotal = (job.addOns || []).filter(a => !!a.isHours).reduce((s, a) => s + (a.amount || 0), 0);
  const loggedHoursTotal = (job.hours || []).reduce((s, h) => s + (h.hours || 0), 0);
  const loggedHoursAmount = _roundMoney(loggedHoursTotal * hourlyRate);
  const materialChargeTotal = (job.materials || []).reduce((s, m) => s + Number(m.chargeAmount ?? m.amount ?? 0), 0);

  const addOnTotal      = isHourly ? 0 : (job.addOns || []).reduce((s,a) => s + (a.amount||0), 0);
  const subtractionTotal= isHourly ? 0 : (job.subtractions || []).reduce((s,a) => s + (a.amount||0), 0);
  const contractTotal   = isHourly
    ? _roundMoney(loggedHoursAmount + hoursTotal + materialChargeTotal)
    : (isLegacyHourly ? revenueTotal : (job.quote || 0)) + addOnTotal - subtractionTotal;

  let collectedGross = 0, estimatedFees = 0, collectedTxns = 0;
  if (isHourly) {
    if ((job.hourlyStatus || 'pending') === 'collected') {
      collectedGross += contractTotal;
      estimatedFees += contractTotal * feeRate;
      collectedTxns++;
    }
  } else if (isLegacyHourly) {
    revenueItems.forEach(r => {
      if ((r.status || 'pending') === 'collected') {
        const g = Number(r.amount || 0);
        collectedGross += g;
        estimatedFees += g * feeRate;
        collectedTxns++;
      }
    });
  } else {
    (job.milestones || []).forEach(m => {
      if (m.status === 'collected') {
        const g = (m.pct/100) * (job.quote||0);
        collectedGross += g; estimatedFees += g * feeRate; collectedTxns++;
      }
    });
  }
  if (!isHourly) {
    (job.addOns || []).forEach(a => {
      if (a.status === 'collected') {
        collectedGross += a.amount||0; estimatedFees += (a.amount||0) * feeRate; collectedTxns++;
      }
    });
    (job.subtractions || []).forEach(a => {
      if (a.status === 'collected') {
        collectedGross -= a.amount||0; estimatedFees -= (a.amount||0) * feeRate;
      }
    });
  }
  estimatedFees += txnFee * collectedTxns;
  const manualFees = (job.fees || []).reduce((s,f) => s + (f.amount||0), 0);
  const totalFees = estimatedFees + manualFees;
  const netRevenue = collectedGross - totalFees;

  let pendingGross = 0, pendingTxns = 0;
  if (isHourly) {
    if ((job.hourlyStatus || 'pending') !== 'collected') {
      pendingGross += contractTotal;
      pendingTxns++;
    }
  } else if (isLegacyHourly) {
    revenueItems.forEach(r => {
      if ((r.status || 'pending') === 'collected') return;
      pendingGross += Number(r.amount || 0);
      pendingTxns++;
    });
  } else {
    (job.milestones || []).forEach(m => { if (m.status !== 'collected') pendingGross += (m.pct/100)*(job.quote||0); });
    (job.milestones || []).forEach(m => { if (m.status !== 'collected') pendingTxns++; });
  }
  if (!isHourly) {
    (job.addOns || []).forEach(a => { if (a.status !== 'collected') { pendingGross += a.amount||0; pendingTxns++; } });
    (job.subtractions || []).forEach(a => { if (a.status !== 'collected') pendingGross -= a.amount||0; });
  }

  const ownerMats = (job.materials||[]).filter(m=>m.who==='owner').reduce((s,m)=>s+Number(m.costAmount ?? m.amount ?? 0),0);
  const empMats   = (job.materials||[]).filter(m=>m.who==='emp').reduce((s,m)=>s+Number(m.costAmount ?? m.amount ?? 0),0);
  const totalMats = ownerMats + empMats;

  const profitPool  = Math.max(0, netRevenue - totalMats);
  const empProfit   = profitPool * effectiveEmpShare;
  const ownerProfit = profitPool * effectiveOwnerShare;
  const debtContribution = job.repaymentMode ? Math.max(0, profitPool * ((debtOwnerShare||0.50) - normalOwnerShare)) : 0;
  const empTotalOwed    = empProfit + empMats;
  const advancesPaid    = (job.advances||[]).reduce((s,a)=>s+(a.amount||0),0);
  const linkedDebtPaid  = (state.debtPayments||[]).filter(p=>p.linkedJobId===job.id).reduce((s,p)=>s+(p.amount||0),0);
  const empBalance      = empTotalOwed - advancesPaid - linkedDebtPaid;
  const outstanding     = contractTotal - collectedGross;
  const projectedGross  = collectedGross + pendingGross;
  const projectedTxns   = collectedTxns + pendingTxns;
  const projectedFees   = projectedGross * feeRate + txnFee * projectedTxns + manualFees;
  const projectedNetRevenue = projectedGross - projectedFees;
  const projectedProfitPool = Math.max(0, projectedNetRevenue - totalMats);
  const potentialEmpTotalOwed = projectedProfitPool * effectiveEmpShare + empMats;
  const potentialEmpBalance   = potentialEmpTotalOwed - advancesPaid - linkedDebtPaid;
  const potentialOwnerProfit  = projectedProfitPool * effectiveOwnerShare;
  const potentialOwnerTotal   = potentialOwnerProfit + ownerMats;
  const potentialDebtContribution = job.repaymentMode
    ? Math.max(0, projectedProfitPool * ((debtOwnerShare||0.50) - normalOwnerShare))
    : 0;
  const ownerTotal      = ownerProfit + ownerMats;
  const totalHours      = (job.hours||[]).reduce((s,h)=>s+(h.hours||0),0);

  return { contractTotal: _roundMoney(contractTotal), addOnTotal: _roundMoney(addOnTotal), subtractionTotal: _roundMoney(subtractionTotal), collectedGross: _roundMoney(collectedGross), pendingGross: _roundMoney(pendingGross),
    totalFees: _roundMoney(totalFees), netRevenue: _roundMoney(netRevenue), totalMats: _roundMoney(totalMats), ownerMats: _roundMoney(ownerMats), empMats: _roundMoney(empMats),
    profitPool: _roundMoney(profitPool), empProfit: _roundMoney(empProfit), ownerProfit: _roundMoney(ownerProfit), debtContribution: _roundMoney(debtContribution),
    empTotalOwed: _roundMoney(empTotalOwed), advancesPaid: _roundMoney(advancesPaid), linkedDebtPaid: _roundMoney(linkedDebtPaid), empBalance: _roundMoney(empBalance),
    outstanding: _roundMoney(outstanding), projectedGross: _roundMoney(projectedGross), projectedFees: _roundMoney(projectedFees), projectedNetRevenue: _roundMoney(projectedNetRevenue), projectedProfitPool: _roundMoney(projectedProfitPool),
    potentialEmpTotalOwed: _roundMoney(potentialEmpTotalOwed), potentialEmpBalance: _roundMoney(potentialEmpBalance),
    potentialOwnerProfit: _roundMoney(potentialOwnerProfit), potentialOwnerTotal: _roundMoney(potentialOwnerTotal), potentialDebtContribution: _roundMoney(potentialDebtContribution),
    ownerTotal: _roundMoney(ownerTotal), totalHours };
}

function calcHW(hw) {
  const emp = getEmp(hw.employeeId);
  const empShare = emp?.empShare ?? 0.66;
  const { feeRate, txnFee = 0 } = state.settings;
  const collectedPayments = (hw.payments||[]).filter(p=>p.status==='collected');
  const collectedGross    = collectedPayments.reduce((s,p)=>s+(p.amount||0),0);
  const txnCount          = collectedPayments.length;
  const pendingGross      = (hw.payments||[]).filter(p=>p.status!=='collected').reduce((s,p)=>s+(p.amount||0),0);
  const { totalFees, netRevenue, empOwed, ownerOwed } = calcSplit(collectedGross, { empShare, feeRate, txnFee, txnCount });
  const advancesPaid   = (hw.advances||[]).reduce((s,a)=>s+(a.amount||0),0);
  const linkedDebtPaid = (state.debtPayments||[]).filter(p=>p.linkedHWId===hw.id).reduce((s,p)=>s+(p.amount||0),0);
  const empBalance     = empOwed - advancesPaid - linkedDebtPaid;
  const { empOwed: potentialEmpOwed } = calcSplit(collectedGross + pendingGross, { empShare, feeRate, txnFee, txnCount: txnCount + (hw.payments||[]).filter(p=>p.status!=='collected').length });
  const potentialEmpBalance = potentialEmpOwed - advancesPaid - linkedDebtPaid;
  return {
    collectedGross: _roundMoney(collectedGross),
    pendingGross: _roundMoney(pendingGross),
    totalFees: _roundMoney(totalFees),
    netRevenue: _roundMoney(netRevenue),
    empOwed: _roundMoney(empOwed),
    ownerOwed: _roundMoney(ownerOwed),
    advancesPaid: _roundMoney(advancesPaid),
    linkedDebtPaid: _roundMoney(linkedDebtPaid),
    empBalance: _roundMoney(empBalance),
    potentialEmpBalance: _roundMoney(potentialEmpBalance)
  };
}

function getHWBillDateForMonth(hw, year, month) {
  if (!hw?.startDate) return null;
  const start = new Date(hw.startDate + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return null;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const billDay = Math.min(start.getDate(), daysInMonth);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(billDay).padStart(2, '0')}`;
}

function syncHomewatchAutoInvoices() {
  const todayStr = today();
  let changed = false;
  (state.homewatch || []).forEach(hw => {
    if (!hw?.startDate || hw.status === 'paused') return;
    if (!hw.payments) hw.payments = [];
    const start = new Date(hw.startDate + 'T00:00:00');
    if (Number.isNaN(start.getTime()) || hw.startDate > todayStr) return;
    const seenDates = new Set((hw.payments || []).map(p => p.date).filter(Boolean));
    let year = start.getFullYear();
    let month = start.getMonth();
    while (year < 2100) {
      const billDate = getHWBillDateForMonth(hw, year, month);
      if (!billDate || billDate > todayStr) break;
      if (!seenDates.has(billDate)) {
        hw.payments.push({
          id: uid(),
          amount: hw.monthlyRate || 0,
          date: billDate,
          status: 'invoiced',
          autoGenerated: true
        });
        seenDates.add(billDate);
        changed = true;
      }
      month++;
      if (month > 11) { month = 0; year++; }
    }
    hw.payments.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  });
  return changed;
}

// ─── HOMEWATCH ────────────────────────────────────────────────────────────────
let editingHWId  = null;
let hwPayContext = null;
let hwPayMode    = 'payment'; // 'payment' | 'advance'

function renderHomewatch() {
  const isAdmin = currentUser?.isAdmin;
  const list = isAdmin
    ? (state.homewatch || [])
    : (state.homewatch || []).filter(hw => hw.employeeId === currentUser?.id);
  document.getElementById('hwCount').textContent = `${list.length} HomeWatch client${list.length!==1?'s':''}`;
  document.getElementById('hwList').innerHTML = list.length
    ? list.map(hwCard).join('')
    : emptyState('No HomeWatch clients yet. Click + New Client to add one.');
  applyAdminClasses();
}

function hwCard(hw) {
  const c      = calcHW(hw);
  const isExp  = expandedHW.has(hw.id);
  const nc     = (hw.hwNotes||[]).length;
  const paused = hw.status === 'paused';
  const hwEmpName = currentUser?.isAdmin ? (getEmp(hw.employeeId)?.name || '') : '';
  return `
    <div class="job-card${isExp?' expanded':''}${paused?' job-complete':''}" id="hw_${hw.id}" onclick="toggleCardMobile(event, 'hw', '${hw.id}')">
      <div class="job-header hw-header">
        <div class="job-header-main" onclick="toggleHeaderDesktop(event, 'hw', '${hw.id}')">
          <div class="job-name" style="display:flex;align-items:center;gap:8px">
            ${esc(hw.name)}${paused?' <span style="font-size:13px;color:var(--text3)">(paused)</span>':''}
            ${clientByName(hw.name) ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;flex-shrink:0" onclick="event.stopPropagation();openClientQuick('${esc(hw.name)}')" title="View in Clients">${jobIconSvg('client')}</button>` : ''}
          </div>
          <div class="job-meta"><span style="font-size:13px;color:var(--text3)">Since ${hw.startDate ? fmtDate(hw.startDate) : '-'} | ${fmt(hw.monthlyRate)}/mo</span>${hwEmpName ? `<span style="font-size:13px;color:var(--text3)"> | </span><span style="color:var(--purple);font-size:13px">${esc(hwEmpName)}</span>` : ''}</div>
        </div>
        <div class="job-header-btns">
          <button class="btn btn-ghost btn-sm job-icon-btn hw-notes-btn${nc>0?' accent':''}" onclick="event.stopPropagation();openNotes('hw','${hw.id}')" title="Notes" aria-label="Notes">${jobIconSvg('notes')}</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="event.stopPropagation();toggleHWPause('${hw.id}')" title="${paused?'Resume':'Pause'}">${paused?'Resume':'Pause'}</button>
          <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="event.stopPropagation();openEditHW('${hw.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
          <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="event.stopPropagation();deleteHW('${hw.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
          <div class="job-chevron" onclick="event.stopPropagation();toggleHW('${hw.id}')">v</div>
        </div>
      </div>
      ${isExp ? hwDetail(hw, c) : ''}
    </div>`;
}

function hwDetail(hw, c) {
  const payments  = hw.payments  || [];
  const advances  = hw.advances  || [];
  const emp       = getEmp(hw.employeeId);
  const en        = esc(emp?.name || 'Employee');
  const feeLabel  = `Est. Square fees (~${(state.settings.feeRate*100).toFixed(1)}%${state.settings.txnFee ? ` + $${state.settings.txnFee.toFixed(2)}/txn` : ''})`;
  const empPct    = Math.round((emp?.empShare ?? 0.66) * 100);
  return `
    <div class="job-detail">
      <div class="line-item"><span>Collected (gross)</span><span class="green">${fmt(c.collectedGross)}</span></div>
      <div class="line-item admin-only"><span>${feeLabel}</span><span class="red">-${fmt(c.totalFees)}</span></div>
      <div class="line-item admin-only"><span>Net Revenue</span><span class="orange">${fmt(c.netRevenue)}</span></div>
      <div class="line-item"><b>${en}'s share (${empPct}%)</b><b class="${c.empOwed>0?'green':''}"> ${fmt(c.empOwed)}</b></div>
      <div class="section-header" style="margin-top:12px">
        <span class="section-title">Client Payments</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm admin-only" onclick="createHWSquareInvoice('${hw.id}', false)">Square Draft</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="createHWSquareInvoice('${hw.id}', true)">Square Send</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="openAddHWPayment('${hw.id}')">+ Log Payment</button>
        </div>
      </div>
      ${payments.length
        ? payments.slice().reverse().map((p,i)=>`
          <div class="line-item hw-pay-row" style="gap:8px">
            ${hwPayBadgeHtml(p.status, hw.id, p.id)}
            <div class="hw-pay-right">
              <span class="hw-pay-meta">${fmtDate(p.date)||p.date||'-'}</span>
              <span class="hw-pay-amount">${fmt(p.amount)}</span>
              <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeHWPayment('${hw.id}','${p.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
            </div>
          </div>`).join('')
        : '<div style="color:var(--text3);font-size:15px;padding:4px 0">No payments logged yet.</div>'}
      <div class="section-header admin-only" style="margin-top:12px">
        <span class="section-title">Paid to ${en}</span>
        <button class="btn btn-ghost btn-sm" onclick="openAddHWAdvance('${hw.id}')">+ Pay Employee</button>
      </div>
      ${advances.length
        ? advances.slice().reverse().map(a=>`
          <div class="line-item admin-only hw-pay-row hw-advance-row" style="gap:8px">
            <span class="hw-pay-spacer"></span>
            <div class="hw-pay-right">
              <span class="hw-pay-meta">${fmtDate(a.date)||a.date||'-'}</span>
              <span class="hw-pay-amount green">-${fmt(a.amount)}</span>
              <button class="btn btn-danger btn-sm btn-icon-only" onclick="removeHWAdvance('${hw.id}','${a.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
            </div>
          </div>`).join('')
        : '<div class="admin-only" style="color:var(--text3);font-size:15px;padding:4px 0">No payments made yet.</div>'}
      <div class="total-line admin-only" style="margin-top:8px">
        <span>Outstanding balance</span>
        <span class="${c.empBalance>0?'orange':'green'}">${fmt(Math.max(0,c.empBalance))}</span>
      </div>
    </div>`;
}

function hwPayBadgeHtml(status, hwId, payId) {
  const cfg = {
    pending:   { cls:'badge-pending',   label:'Pending'   },
    invoiced:  { cls:'badge-invoiced',  label:'Invoiced'  },
    collected: { cls:'badge-collected', label:'Collected' }
  };
  const { cls, label } = cfg[status] || cfg.pending;
  const admin = currentUser?.isAdmin;
  return `<span class="status-badge ${cls}"${admin?` onclick="cycleHWPayStatus('${hwId}','${payId}')" title="Click to cycle"`:''} style="cursor:${admin?'pointer':'default'}">${label}</span>`;
}

function openNewHWModal() {
  editingHWId = null;
  document.getElementById('hwModalTitle').textContent = 'New HomeWatch Client';
  document.getElementById('hw_name').value = '';
  document.getElementById('hw_startDate').value = today();
  document.getElementById('hw_rate').value = '';
  populateEmpDropdown('hw_emp', 'hw_emp_wrap', null);
  document.getElementById('hwModal').classList.remove('hidden');
}
function openEditHW(hwId) {
  const hw = (state.homewatch||[]).find(h=>h.id===hwId);
  if (!hw) return;
  editingHWId = hwId;
  document.getElementById('hwModalTitle').textContent = 'Edit HomeWatch Client';
  document.getElementById('hw_name').value      = hw.name||'';
  document.getElementById('hw_startDate').value = hw.startDate||'';
  document.getElementById('hw_rate').value      = hw.monthlyRate||'';
  populateEmpDropdown('hw_emp', 'hw_emp_wrap', hw.employeeId);
  document.getElementById('hwModal').classList.remove('hidden');
}
function saveHW() {
  const name        = document.getElementById('hw_name').value.trim();
  const startDate   = document.getElementById('hw_startDate').value;
  const monthlyRate = parseFloat(document.getElementById('hw_rate').value)||0;
  if (!name) { showAlert('Please enter a client name.'); return; }
  if (!state.homewatch) state.homewatch = [];
  const hwEmps = state.users.filter(u => !u.isAdmin);
  const hwEmployeeId = hwEmps.length > 1
    ? (document.getElementById('hw_emp')?.value || hwEmps[0]?.id)
    : hwEmps[0]?.id;
  if (editingHWId) {
    const hw = state.homewatch.find(h=>h.id===editingHWId);
    if (hw) { hw.name=name; hw.startDate=startDate; hw.monthlyRate=monthlyRate; if (hwEmployeeId) hw.employeeId = hwEmployeeId; }
  } else {
    const hw = { id:uid(), name, startDate, monthlyRate, status:'active', payments:[], hwNotes:[], advances:[], employeeId: hwEmployeeId || '' };
    expandedHW.clear();
    expandedHW.add(hw.id);
    saveExpandedState();
    state.homewatch.push(hw);
  }
  const isNewHW = !editingHWId;
  save(); closeModal('hwModal'); renderHomewatch(); renderSummary();
  if (isNewHW) checkNewClientPrompt(name);
}
function deleteHW(hwId) {
  showConfirm('Delete this HomeWatch client? This cannot be undone.', () => {
    state.homewatch = (state.homewatch||[]).filter(h=>h.id!==hwId);
    expandedHW.delete(hwId);
    saveExpandedState();
    save(); renderHomewatch(); renderSummary();
  });
}
function toggleHW(hwId) {
  if (expandedHW.has(hwId)) expandedHW.delete(hwId);
  else {
    expandedHW.clear();
    expandedHW.add(hwId);
  }
  saveExpandedState();
  renderHomewatch();
}
function toggleHWPause(hwId) {
  const hw = (state.homewatch||[]).find(h=>h.id===hwId);
  if (!hw) return;
  hw.status = hw.status === 'paused' ? 'active' : 'paused';
  save(); renderHomewatch(); renderSummary();
}
function openAddHWPayment(hwId) {
  hwPayContext = hwId; hwPayMode = 'payment';
  const hw = (state.homewatch||[]).find(h=>h.id===hwId);
  document.getElementById('hwPayModalTitle').textContent = `Log Client Payment - ${hw?.name||''}`;
  document.getElementById('hwp_amount').value = hw?.monthlyRate||'';
  document.getElementById('hwp_date').value   = today();
  document.getElementById('hwPayModal').classList.remove('hidden');
}
function openAddHWAdvance(hwId) {
  hwPayContext = hwId; hwPayMode = 'advance';
  const hw = (state.homewatch||[]).find(h=>h.id===hwId);
  document.getElementById('hwPayModalTitle').textContent = `Pay Employee - ${hw?.name||''}`;
  document.getElementById('hwp_amount').value = '';
  document.getElementById('hwp_date').value   = today();
  document.getElementById('hwPayModal').classList.remove('hidden');
}
function saveHWPayment() {
  const amount = parseFloat(document.getElementById('hwp_amount').value)||0;
  const date   = document.getElementById('hwp_date').value;
  if (!amount) { showAlert('Please enter an amount.'); return; }
  const hw = (state.homewatch||[]).find(h=>h.id===hwPayContext);
  if (!hw) return;
  if (hwPayMode === 'advance') {
    if (!hw.advances) hw.advances = [];
    hw.advances.push({ id:uid(), amount, date });
  } else {
    hw.payments.push({ id:uid(), amount, date, status:'pending' });
  }
  save(); closeModal('hwPayModal'); renderHomewatch(); renderSummary();
}
function removeHWAdvance(hwId, advId) {
  showConfirm('Remove this employee payment?', () => {
    const hw = (state.homewatch||[]).find(h=>h.id===hwId);
    if (!hw) return;
    hw.advances = (hw.advances||[]).filter(a=>a.id!==advId);
    save(); renderHomewatch(); renderSummary();
  });
}
function removeHWPayment(hwId, payId) {
  showConfirm('Remove this payment?', () => {
    const hw = (state.homewatch||[]).find(h=>h.id===hwId);
    if (!hw) return;
    hw.payments = hw.payments.filter(p=>p.id!==payId);
    save(); renderHomewatch(); renderSummary();
  });
}
function cycleHWPayStatus(hwId, payId) {
  const hw = (state.homewatch||[]).find(h=>h.id===hwId);
  if (!hw) return;
  const p = hw.payments.find(p=>p.id===payId);
  if (!p) return;
  const cycle = { pending:'invoiced', invoiced:'collected', collected:'pending' };
  const doIt = () => { p.status = cycle[p.status]||'pending'; save(); renderHomewatch(); renderSummary(); };
  if (p.status === 'collected') {
    showConfirm('Mark this payment as Pending? This will remove it from collected revenue.', doIt);
  } else { doIt(); }
}

// ─── DEBT PANEL ───────────────────────────────────────────────────────────────
function renderDebtPanel() {
  const debtEl = document.getElementById('debtPanel');
  if (!debtEl) return;
  const jobsTabActive = ['tab-active', 'tab-complete', 'tab-all']
    .some(id => document.getElementById(id)?.classList.contains('active'));
  if (!jobsTabActive) {
    debtEl.innerHTML = '';
    return;
  }
  const s = state.settings;
  const originalDebt = s.debtOriginal || 0;
  if (!originalDebt) { debtEl.innerHTML = ''; return; }

  let jobRepaid = 0;
  let jobProjected = 0;
  state.jobs.forEach(j => {
    const c = calcJob(j);
    jobRepaid += c.debtContribution;
    jobProjected += Math.max(0, (c.potentialDebtContribution || 0) - (c.debtContribution || 0));
  });
  const manualRepaid = (state.debtPayments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalRepaid = jobRepaid + manualRepaid;
  const totalProjected = totalRepaid + jobProjected;
  const remaining = Math.max(0, originalDebt - totalRepaid);
  const remainingAfterProjected = Math.max(0, originalDebt - totalProjected);
  const pct = Math.min(100, (totalRepaid / originalDebt) * 100);
  const pctProjected = Math.min(100, (totalProjected / originalDebt) * 100);
  const paid = remaining <= 0;
  const debtEmp = getEmp(s.debtEmployeeId);
  const en = esc(debtEmp?.name || 'Employee');
  const normalPct = Math.round((1 - (debtEmp?.empShare ?? 0.66)) * 100);
  const repayPct  = Math.round((s.debtOwnerShare || 0.50) * 100);

  const paymentsHtml = (state.debtPayments || []).length
    ? [...state.debtPayments].reverse().map(p => {
        const linkedJob = p.linkedJobId ? state.jobs.find(j => j.id === p.linkedJobId) : null;
        const linkedHW  = p.linkedHWId  ? (state.homewatch||[]).find(h => h.id === p.linkedHWId) : null;
        const jobTag = linkedJob ? `<span style="font-size:11px;background:rgba(91,141,239,0.15);color:var(--blue);border-radius:2px;padding:1px 6px;font-family:var(--mono);margin-left:6px;white-space:nowrap;display:inline-block">to ${esc(linkedJob.name)}</span>` : '';
        const hwTag  = linkedHW  ? `<span style="font-size:11px;background:rgba(76,175,130,0.15);color:var(--green);border-radius:2px;padding:1px 6px;font-family:var(--mono);margin-left:6px;white-space:nowrap;display:inline-block">to HW: ${esc(linkedHW.name)}</span>` : '';
        return `<div class="line-item line-item-simple" style="padding:6px 0">
          <div class="line-item-label" style="font-size:15px;display:flex;flex-direction:column;gap:3px;align-items:flex-start">
            <span>${esc(p.label||'Manual payment')}<span style="font-size:11px;color:var(--text3);margin-left:8px;font-family:var(--mono)">${fmtDate(p.date)||''}</span></span>
            ${jobTag||hwTag ? `<span style="display:flex;flex-wrap:wrap;gap:4px">${jobTag}${hwTag}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <div class="line-item-value green">+${fmt(p.amount)}</div>
            <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteDebtPayment('${p.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
          </div>
        </div>`;
      }).join('')
    : '';

  const baseW = pct.toFixed(1);
  const projW = Math.max(0, pctProjected - pct).toFixed(1);
  debtEl.innerHTML = `
    <div class="debt-panel${paid?' paid':''}">
      <div class="debt-panel-header">
        <span class="debt-panel-title">Fee Debt Repayment | ${en}</span>
        <span class="debt-panel-status${paid?' paid':''}">${paid ? 'PAID OFF' : `${repayPct}/${100-repayPct} split active`}</span>
      </div>
      <div class="debt-stats" style="grid-template-columns:repeat(4,1fr)">
        <div>
          <div class="debt-stat-label">Original Debt</div>
          <div class="debt-stat-value" style="color:var(--text2)">${fmt(originalDebt)}</div>
        </div>
        <div>
          <div class="debt-stat-label">Via Job Splits</div>
          <div class="debt-stat-value" style="color:var(--green)">${fmt(jobRepaid)}</div>
        </div>
        <div>
          <div class="debt-stat-label">Manual Payments</div>
          <div class="debt-stat-value" style="color:var(--green)">${fmt(manualRepaid)}</div>
        </div>
        <div>
          <div class="debt-stat-label">Remaining</div>
          <div class="debt-stat-value" style="color:${paid?'var(--green)':'var(--red)'}">${fmt(remaining)}</div>
        </div>
        <div>
          <div class="debt-stat-label">Projected (Pending)</div>
          <div class="debt-stat-value" style="color:rgba(255,193,7,0.95)">${fmt(jobProjected)}</div>
        </div>
        <div>
          <div class="debt-stat-label">Projected Total</div>
          <div class="debt-stat-value" style="color:rgba(255,193,7,0.95)">${fmt(totalProjected)}</div>
        </div>
        <div>
          <div class="debt-stat-label">Remaining (Projected)</div>
          <div class="debt-stat-value" style="color:${remainingAfterProjected<=0?'var(--green)':'rgba(255,193,7,0.95)'}">${fmt(remainingAfterProjected)}</div>
        </div>
      </div>
      <div class="debt-progress-track">
        <div class="debt-progress-fill" style="width:${baseW}%"></div>
        <div class="debt-progress-fill" style="width:${projW}%;background:rgba(255,193,7,0.95);position:relative;left:${baseW}%;top:-6px"></div>
      </div>
      <div class="debt-progress-label" style="margin-bottom:${paymentsHtml||!paid?'12px':'0'}">
        <span>${pct.toFixed(1)}% repaid | ${pctProjected.toFixed(1)}% projected</span>
        <span>Normal split ${normalPct}/${100-normalPct} | Repayment split ${repayPct}/${100-repayPct}</span>
      </div>
      ${paymentsHtml ? `<div style="border-top:1px solid var(--border);padding-top:10px;margin-bottom:10px">${paymentsHtml}</div>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="openAddDebtPayment()">+ Manual Payment</button>
    </div>`;
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
function renderSummary() {
  renderDebtPanel();
  renderEmpSummary();
  const active = state.jobs.filter(j => j.status !== 'complete');
  let tContract=0, tCollected=0, tPending=0, tOwner=0;
  active.forEach(j => {
    const c = calcJob(j);
    tContract += c.contractTotal; tCollected += c.collectedGross;
    tPending  += c.pendingGross;  tOwner    += c.ownerTotal;
  });
  const activeHW  = (state.homewatch||[]).filter(hw=>hw.status!=='paused');
  const pausedHW  = (state.homewatch||[]).filter(hw=>hw.status==='paused');
  const employees = state.users.filter(u => !u.isAdmin);
  const include = normalizeOwedInclude(state.settings?.owedSummaryInclude);
  const empCardsHtml = employees.map(emp => {
    const empJobs = state.jobs.filter(j => j.employeeId === emp.id && j.status !== 'complete');
    const empHWAll = (state.homewatch||[]).filter(hw => hw.employeeId === emp.id);
    const empHWActive = empHWAll.filter(hw => hw.status !== 'paused');
    const jobBal = _roundMoney(empJobs.reduce((s,j) => s + calcJob(j).empBalance, 0));
    const hwBal = _roundMoney(empHWAll.reduce((s,hw) => s + calcHW(hw).empBalance, 0));
    // Potential row is incremental only so it can be safely combined with current owed rows.
    const potentialBal = _roundMoney(empJobs.reduce((s,j) => {
      const c = calcJob(j);
      return s + (c.potentialEmpBalance - c.empBalance);
    }, 0) + empHWActive.reduce((s,hw) => {
      const c = calcHW(hw);
      return s + (c.potentialEmpBalance - c.empBalance);
    }, 0));
    const total = _roundMoney(
      (include.jobs ? jobBal : 0) +
      (include.homewatch ? hwBal : 0) +
      (include.potential ? potentialBal : 0));
    return `<div class="summary-card">
      <div class="summary-label">Owed to ${esc(emp.name)}</div>
      <div class="summary-value ${total < 0 ? 'red' : 'orange'}">${fmt(total)}</div>
      <div class="owed-breakdown">
        <div class="owed-breakdown-row">
          <span class="owed-breakdown-label">Jobs</span>
          <span class="owed-breakdown-amount">${fmt(jobBal)}</span>
          <button type="button" class="owed-toggle${include.jobs ? ' on' : ''}" onclick="event.stopPropagation();toggleSummaryOwedInclude('jobs')" aria-pressed="${include.jobs ? 'true' : 'false'}" title="Include Jobs in total">
            <span class="owed-toggle-thumb"></span>
          </button>
        </div>
        <div class="owed-breakdown-row">
          <span class="owed-breakdown-label">HomeWatch</span>
          <span class="owed-breakdown-amount">${fmt(hwBal)}</span>
          <button type="button" class="owed-toggle${include.homewatch ? ' on' : ''}" onclick="event.stopPropagation();toggleSummaryOwedInclude('homewatch')" aria-pressed="${include.homewatch ? 'true' : 'false'}" title="Include HomeWatch in total">
            <span class="owed-toggle-thumb"></span>
          </button>
        </div>
        <div class="owed-breakdown-row">
          <span class="owed-breakdown-label">Potential</span>
          <span class="owed-breakdown-amount">${fmt(potentialBal)}</span>
          <button type="button" class="owed-toggle${include.potential ? ' on' : ''}" onclick="event.stopPropagation();toggleSummaryOwedInclude('potential')" aria-pressed="${include.potential ? 'true' : 'false'}" title="Include Potential in total">
            <span class="owed-toggle-thumb"></span>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('summaryCards').innerHTML = `
    <div class="summary-card" onclick="goToTab('active')" style="cursor:pointer"><div class="summary-label">Active Jobs</div><div class="summary-value">${active.length}</div></div>
    <div class="summary-card" onclick="goToTab('homewatch')" style="cursor:pointer"><div class="summary-label">HomeWatch</div><div class="summary-value">${activeHW.length}</div><div class="summary-sub">${pausedHW.length > 0 ? `${pausedHW.length} paused` : 'none paused'}</div></div>
    <div class="summary-card"><div class="summary-label">Total Contract Value</div><div class="summary-value orange">${fmt(tContract)}</div></div>
    <div class="summary-card"><div class="summary-label">Collected</div><div class="summary-value green">${fmt(tCollected)}</div><div class="summary-sub">${fmt(tPending)} pending</div></div>
    <div class="summary-card"><div class="summary-label">Your Profit (active)</div><div class="summary-value green">${fmt(tOwner)}</div><div class="summary-sub">from collected revenue</div></div>
    ${empCardsHtml}`;
}

function toggleSummaryOwedInclude(category) {
  if (!['jobs', 'homewatch', 'potential'].includes(category)) return;
  const include = normalizeOwedInclude(state.settings?.owedSummaryInclude);
  include[category] = !include[category];
  if (category === 'potential' && include.potential && !include.jobs) {
    include.jobs = true;
  }
  if (category === 'jobs' && !include.jobs && include.potential) {
    include.potential = false;
  }
  state.settings.owedSummaryInclude = include;
  save();
  renderSummary();
}

function renderEmpSummary() {
  const el = document.getElementById('empSummaryCards');
  if (!el || !currentUser || currentUser.isAdmin) return;
  const myId     = currentUser.id;
  const active   = state.jobs.filter(j => j.status !== 'complete' && j.employeeId === myId);
  const activeHW = (state.homewatch||[]).filter(hw => hw.status !== 'paused' && hw.employeeId === myId);
  const pausedHW = (state.homewatch||[]).filter(hw => hw.status === 'paused' && hw.employeeId === myId);
  const allHW    = (state.homewatch||[]).filter(hw => hw.employeeId === myId);

  // Currently owed (collected but not yet paid out — includes paused clients with collected invoices)
  let tOwed = 0;
  active.forEach(j => { tOwed += calcJob(j).empBalance; });
  allHW.forEach(hw => { tOwed += calcHW(hw).empBalance; });
  tOwed = _roundMoney(tOwed);

  // Potential pay mirrors core calc functions:
  // start from current owed, then add only the active-items delta to potential balances.
  let tPotential = tOwed;
  active.forEach(j => {
    const c = calcJob(j);
    tPotential += (c.potentialEmpBalance - c.empBalance);
  });
  activeHW.forEach(hw => {
    const c = calcHW(hw);
    tPotential += (c.potentialEmpBalance - c.empBalance);
  });
  tPotential = _roundMoney(tPotential);

  // Recent pay (advances paid to employee within selected timeframe)
  let cutoffStr = null;
  if (empSummaryTimeframe !== 'all') {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(empSummaryTimeframe));
    cutoffStr = d.toISOString().slice(0, 10);
  }
  const inWindow = date => !cutoffStr || (date && date >= cutoffStr);
  let tRecentPay = 0;
  state.jobs.filter(j => j.employeeId === myId).forEach(j => {
    (j.advances||[]).forEach(a => { if (inWindow(a.date)) tRecentPay += a.amount||0; });
  });
  allHW.forEach(hw => {
    (hw.advances||[]).forEach(a => { if (inWindow(a.date)) tRecentPay += a.amount||0; });
  });

  const tfOpts = [
    ['7','Last 7 days'],['14','Last 14 days'],['30','Last 30 days'],
    ['60','Last 60 days'],['90','Last 90 days'],['365','This year'],['all','All time']
  ].map(([v,l]) => `<option value="${v}"${empSummaryTimeframe===v?' selected':''}>${l}</option>`).join('');

  el.innerHTML = `
    <div class="summary-card" onclick="goToTab('active')" style="cursor:pointer"><div class="summary-label">Active Jobs</div><div class="summary-value">${active.length}</div></div>
    <div class="summary-card" onclick="goToTab('homewatch')" style="cursor:pointer"><div class="summary-label">HomeWatch</div><div class="summary-value">${activeHW.length}</div><div class="summary-sub">${pausedHW.length > 0 ? `${pausedHW.length} paused` : 'none paused'}</div></div>
    <div class="summary-card">
      <div class="summary-label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">Recent Pay
        <select onchange="setEmpSummaryTimeframe(this.value)" style="font-size:12px;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:1px 4px">${tfOpts}</select>
      </div>
      <div class="summary-value green">${fmt(tRecentPay)}</div>
      <div class="summary-sub">advances received</div>
    </div>
    <div class="summary-card"><div class="summary-label">Currently Owed</div><div class="summary-value ${tOwed>0?'orange':'green'}">${fmt(Math.max(0,tOwed))}</div><div class="summary-sub">from collected work</div></div>
    <div class="summary-card"><div class="summary-label">Potential Pay</div><div class="summary-value orange">${fmt(Math.max(0,tPotential))}</div><div class="summary-sub">if all active work completes</div></div>`;
}

// ─── RENDER JOBS ─────────────────────────────────────────────────────────────
function renderJobs() {
  renderSummary();
  const isAdmin = currentUser?.isAdmin;
  const allJobs = isAdmin ? state.jobs : state.jobs.filter(j => j.employeeId === currentUser?.id);
  const active   = allJobs.filter(j => j.status !== 'complete');
  const complete = allJobs.filter(j => j.status === 'complete');
  document.getElementById('activeCount').textContent = `${active.length} active job${active.length!==1?'s':''}`;
  document.getElementById('activeJobsList').innerHTML   = active.length   ? active.map(jobCard).join('')   : emptyState('No active jobs. Click + New Job to get started.');
  document.getElementById('completeJobsList').innerHTML = complete.length ? complete.map(jobCard).join('') : emptyState('No completed jobs yet.');
  document.getElementById('allJobsList').innerHTML      = allJobs.length  ? allJobs.map(jobCard).join('')  : emptyState('No jobs yet.');
  applyAdminClasses();
}
function applyAdminClasses() {
  const isAdmin = currentUser?.isAdmin;
  document.querySelectorAll('.admin-only').forEach(el => { el.style.display = isAdmin ? '' : 'none'; });
  document.querySelectorAll('.employee-only').forEach(el => { el.style.display = isAdmin ? 'none' : ''; });
}
function emptyState(msg) { return `<div class="empty-state"><div class="empty-state-icon">[]</div>${msg}</div>`; }

function jobIconSvg(kind) {
  const icons = {
    client: '<i class="ph ph-user-circle" aria-hidden="true"></i>',
    estimate: '<i class="ph ph-file-text" aria-hidden="true"></i>',
    notes: '<i class="ph ph-note-pencil" aria-hidden="true"></i>',
    hours: '<i class="ph ph-clock" aria-hidden="true"></i>',
    edit: '<i class="ph ph-pencil-simple" aria-hidden="true"></i>',
    smile: '<i class="ph ph-smiley" aria-hidden="true"></i>',
    calendar: '<i class="ph ph-calendar-blank" aria-hidden="true"></i>',
    location: '<i class="ph ph-map-pin" aria-hidden="true"></i>',
    time: '<i class="ph ph-clock" aria-hidden="true"></i>',
    chart: '<i class="ph ph-chart-bar" aria-hidden="true"></i>',
    trash: '<i class="ph ph-trash" aria-hidden="true"></i>',
    menu: '<i class="ph ph-list" aria-hidden="true"></i>',
    close: '<i class="ph ph-x" aria-hidden="true"></i>'
  };
  return icons[kind] || '';
}

function jobIconButton({ title, icon, onclick = '', accent = false, disabled = false }) {
  const cls = `btn btn-ghost btn-sm job-icon-btn${accent ? ' accent' : ''}`;
  return `<button class="${cls}" type="button"${disabled ? ' disabled' : ''}${disabled ? '' : ` onclick="${onclick}"`} title="${title}" aria-label="${title}">${jobIconSvg(icon)}</button>`;
}

function jobCard(job) {
  const c = calcJob(job);
  const isHourly = _jobType(job) === 'hourly';
  const jobClient = job.clientId ? clientById(job.clientId) : clientByName(job.name);
  const contactClient = job.contactClientId ? clientById(job.contactClientId) : clientByName(job.contactName);
  const fadedStatStyle = isHourly ? 'opacity:0.45' : '';
  const fadedValueStyle = isHourly ? 'color:var(--text3)!important' : '';
  const isZeroStat = (n) => Math.abs(Number(n || 0)) < 0.005;
  const statTileStyle = (n, extra = '') => {
    const faded = isZeroStat(n);
    const base = faded ? 'opacity:0.45' : '';
    return [base, extra].filter(Boolean).join(';');
  };
  const statValueStyle = (n, normalColor = '') => {
    if (isZeroStat(n)) return 'color:var(--text3)!important';
    return normalColor ? `color:${normalColor}` : '';
  };
  const isExp = expandedJobs.has(job.id);
  const sc    = job.status === 'complete' ? 'complete' : 'active';
  const nc    = (job.jobNotes||[]).length;
  const th    = c.totalHours;
  const jobEmpName = currentUser?.isAdmin ? (getEmp(job.employeeId)?.name || '') : '';
  return `
  <div class="job-card ${sc} ${isExp?'expanded':''}" id="job_${job.id}" onclick="toggleCardMobile(event, 'job', '${job.id}')">
    <div class="job-header" onclick="toggleHeaderRow(event, 'job', '${job.id}')">
      ${jobEmpName ? `<div class="job-emp-rail">${esc(jobEmpName)}</div>` : '<div class="job-emp-rail"></div>'}
      <div class="job-header-main job-header-main-grid">
        <div class="job-name-block">
          <div class="job-name" style="display:flex;align-items:center;gap:8px">
            ${esc(job.name)}
            ${jobClient ? `<button class="btn btn-ghost btn-sm job-icon-btn" style="width:24px;height:24px" onclick="event.stopPropagation();openClientQuickById('${jobClient.id}')" title="View in Clients" aria-label="View in Clients">${jobIconSvg('client')}</button>` : ''}
          </div>
          ${job.contactName ? `<div style="font-size:13px;color:var(--blue);margin-top:2px;font-family:var(--mono);display:flex;align-items:center;gap:6px">via ${esc(job.contactName)} ${contactClient ? `<button class="btn btn-ghost btn-sm job-icon-btn" style="width:22px;height:22px" onclick="event.stopPropagation();openClientQuickById('${contactClient.id}')" title="View in Clients" aria-label="View in Clients">${jobIconSvg('client')}</button>` : ''}</div>` : ''}
          <div style="font-size:15px;color:var(--text3);margin-top:2px;font-family:var(--mono)">${job.date||''}</div>
          ${jobBillingSummaryHtml(job, c)}
        </div>
        <div class="job-quick-stats job-quick-stats-grid">
          <div class="job-stat" style="${statTileStyle(job.quote, fadedStatStyle)}"><div class="job-stat-label">Quote</div><div class="job-stat-value" style="${isHourly ? fadedValueStyle : statValueStyle(job.quote)}">${fmt(job.quote)}</div></div>
          <div class="job-stat" style="${statTileStyle(c.addOnTotal-c.subtractionTotal, fadedStatStyle)}"><div class="job-stat-label">Adjust</div><div class="job-stat-value" style="${isHourly ? fadedValueStyle : statValueStyle(c.addOnTotal-c.subtractionTotal, c.addOnTotal-c.subtractionTotal>=0?'var(--purple)':'var(--red)')}">${fmt(c.addOnTotal-c.subtractionTotal)}</div></div>
          <div class="job-stat" style="${statTileStyle(c.contractTotal)}"><div class="job-stat-label">Contract</div><div class="job-stat-value" style="${statValueStyle(c.contractTotal)}">${fmt(c.contractTotal)}</div></div>
          <div class="job-stat" style="${statTileStyle(c.collectedGross)}"><div class="job-stat-label">Collected</div><div class="job-stat-value" style="${statValueStyle(c.collectedGross, 'var(--green)')}">${fmt(c.collectedGross)}</div></div>
          <div class="job-stat" style="${statTileStyle(c.outstanding)}"><div class="job-stat-label">Outstanding</div><div class="job-stat-value" style="${statValueStyle(c.outstanding, c.outstanding>0?'var(--blue)':'var(--text2)')}">${fmt(c.outstanding)}</div></div>
          <div class="job-emp-stats">
            <div class="job-stat" style="${statTileStyle(c.empBalance)}"><div class="job-stat-label">Emp. Balance</div><div class="job-stat-value" style="${statValueStyle(c.empBalance, 'var(--accent)')}">${fmt(c.empBalance)}</div></div>
            <div class="job-stat" style="${statTileStyle(c.potentialEmpBalance)}"><div class="job-stat-label">Potential</div><div class="job-stat-value" style="${statValueStyle(c.potentialEmpBalance, c.potentialEmpBalance>0?'var(--yellow)':'var(--text2)')}">${fmt(c.potentialEmpBalance)}</div></div>
          </div>
        </div>
      </div>
      <div class="job-header-btns job-header-btns-stacked">
        <div class="job-action-pad">
          ${jobIconButton({ title: job.isItemized ? 'View estimate snapshot' : 'Estimate snapshot unavailable', icon:'estimate', onclick:`openQuoteSnapshot('${job.id}')`, accent: !!job.isItemized, disabled: !job.isItemized })}
          ${jobIconButton({ title:'Notes', icon:'notes', onclick:`openNotes(&quot;job&quot;,&quot;${job.id}&quot;)`, accent: nc > 0 })}
          ${currentUser?.isAdmin
            ? jobIconButton({ title:'Edit job', icon:'edit', onclick:`editJob(&quot;${job.id}&quot;)`, accent: true })
            : jobIconButton({ title:'Hi', icon:'smile', disabled: true })}
          ${jobIconButton({ title:'Hours', icon:'hours', onclick:`openHours(&quot;${job.id}&quot;)`, accent: th > 0 })}
        </div>
      </div>
    </div>
    ${isExp ? jobDetail(job, c) : ''}
  </div>`;
}

function _billingBucket(status, item) {
  const s = status || item?.status || 'pending';
  if (s === 'collected' || item?.billingState === 'paid') return 'paid';
  if (s === 'invoiced' || item?.squareInvoiceId || item?.hourlySquareInvoiceId) return 'invoiced';
  return 'pending';
}

function _addBillingRow(summary, status, amount, item = null) {
  const amt = _roundMoney(amount);
  if (Math.abs(amt) < 0.005) return;
  const bucket = _billingBucket(status, item);
  summary[bucket].count += 1;
  summary[bucket].total = _roundMoney(summary[bucket].total + amt);
}

function getJobBillingSummary(job, calc = null) {
  const summary = {
    pending: { count: 0, total: 0 },
    invoiced: { count: 0, total: 0 },
    paid: { count: 0, total: 0 }
  };
  const c = calc || calcJob(job);
  if (_jobType(job) === 'hourly') {
    _addBillingRow(summary, job.hourlyStatus || 'pending', c.contractTotal || 0, {
      status: job.hourlyStatus || 'pending',
      squareInvoiceId: job.hourlySquareInvoiceId || ''
    });
    return summary;
  }
  (job.milestones || []).forEach(m => {
    _addBillingRow(summary, m.status || 'pending', ((m.pct || 0) / 100) * (job.quote || 0), m);
  });
  (job.revenueItems || []).forEach(r => {
    _addBillingRow(summary, r.status || 'pending', Number(r.amount || 0), r);
  });
  (job.addOns || []).forEach(a => {
    _addBillingRow(summary, a.status || 'pending', a.amount || 0, a);
  });
  (job.subtractions || []).forEach(s => {
    _addBillingRow(summary, s.status || 'pending', -(s.amount || 0), s);
  });
  return summary;
}

function jobBillingSummaryHtml(job, calc = null) {
  const summary = getJobBillingSummary(job, calc);
  const cfg = {
    pending: { label: 'Pending', cls: 'pending' },
    invoiced: { label: 'Invoiced', cls: 'invoiced' }
  };
  const parts = ['pending', 'invoiced']
    .filter(k => summary[k].count > 0)
    .map(k => {
      const s = summary[k];
      const label = cfg[k].label;
      const lineLabel = s.count === 1 ? 'line' : 'lines';
      return `<span class="job-billing-pill ${cfg[k].cls}" title="${label}: ${s.count} ${lineLabel}, ${fmt(s.total)}"><span>${label}</span><strong>${s.count}</strong><em>${fmt(s.total)}</em></span>`;
    });
  return parts.length ? `<div class="job-billing-strip" aria-label="Invoice status summary">${parts.join('')}</div>` : '';
}

function jobClientChargeSummaryHtml(job, calc = null) {
  const c = calc || calcJob(job);
  const rows = [];
  const unifiedLines = Array.isArray(job.unifiedLines) ? job.unifiedLines : [];

  if (job.createdVia === 'unified-v2') {
    const fixed = Number(job.quote || 0);
    const hourly = (job.addOns || []).filter(a => a.isHours).reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const material = (job.addOns || []).filter(a => a.chargeType === 'materials').reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const other = (job.addOns || []).filter(a => !a.isHours && a.chargeType !== 'materials').reduce((sum, a) => sum + Number(a.amount || 0), 0);
    if (fixed > 0) rows.push({ label:'Fixed labor', amount:fixed });
    if (hourly > 0) rows.push({ label:'Hourly labor', amount:hourly });
    if (material > 0) rows.push({ label:'Materials', amount:material });
    if (other > 0) rows.push({ label:'Other charges', amount:other });
    if (Number(c.subtractionTotal || 0) > 0) rows.push({ label:'Credits', amount:-Number(c.subtractionTotal || 0), negative:true });
  } else if (unifiedLines.length) {
    const totals = { fixed:0, hourly:0, material:0, other:0, credit:0 };
    unifiedLines.forEach(line => {
      const amount = Number(line.amount || 0);
      if (line.type === 'material' && line.billClient === false) return;
      if (totals[line.type] !== undefined) totals[line.type] += amount;
    });
    if (totals.fixed > 0) rows.push({ label:'Fixed labor', amount:totals.fixed });
    if (totals.hourly > 0) rows.push({ label:'Hourly labor', amount:totals.hourly });
    if (totals.material > 0) rows.push({ label:'Materials', amount:totals.material });
    if (totals.other > 0) rows.push({ label:'Other charges', amount:totals.other });
    if (totals.credit > 0) rows.push({ label:'Credits', amount:-totals.credit, negative:true });
  } else {
    if (Number(job.quote || 0) > 0) rows.push({ label:'Quoted work', amount:Number(job.quote || 0) });
    if (Number(c.addOnTotal || 0) > 0) rows.push({ label:'Additions', amount:Number(c.addOnTotal || 0) });
    if (Number(c.subtractionTotal || 0) > 0) rows.push({ label:'Credits', amount:-Number(c.subtractionTotal || 0), negative:true });
  }

  return `
    ${rows.length ? rows.map(row => `<div class="line-item line-item-simple"><div class="line-item-label">${esc(row.label)}</div><div class="line-item-value${row.negative ? ' red' : ''}">${row.negative ? '-' : ''}${fmt(Math.abs(row.amount))}</div></div>`).join('') : '<div style="color:var(--text3);font-size:16px;padding:4px 0">No client charges yet.</div>'}
    <div class="total-line"><span style="color:var(--text2)">Total client charges</span><span class="line-item-value" style="color:var(--purple)">${fmt(c.contractTotal)}</span></div>`;
}

function badgeHtml(status, jobId, itemType, idx) {
  const cfg = {
    pending:   { cls:'badge-pending',   label:'Pending'  },
    invoiced:  { cls:'badge-invoiced',  label:'Invoiced' },
    collected: { cls:'badge-collected', label:'Collected'}
  };
  const { cls } = cfg[status] || cfg.pending;
  let label = (cfg[status] || cfg.pending).label;
  if (itemType === 'subtractions' && status === 'collected') label = 'Applied';
  const admin = currentUser?.isAdmin;
  const job = state.jobs.find(j => j.id === jobId);
  const item = job?.[itemType]?.[idx];
  const locked = itemType === 'subtractions' && !!item?.appliedByPartial;
  const title = locked ? 'Locked: applied via partial payment' : 'Click to cycle';
  const click = itemType === 'hourlyRevenue'
    ? ` onclick="cycleHourlyStatus('${jobId}')"`
    : ` onclick="cycleStatus('${jobId}','${itemType}',${idx})"`;
  return `<span class="status-badge ${cls}"${admin && !locked ? click : ''} title="${title}">${label}</span>`;
}

function payTypeBadgeHtml(payType, jobId, idx) {
  const cfg = {
    '':         { cls:'badge-pending',   label:'Pay' },
    'advance':  { cls:'badge-invoiced',  label:'Advance' },
    'final':    { cls:'badge-collected', label:'Final Pay' },
    'adjustment': { cls:'badge-pending', label:'Adjustment' }
  };
  const { cls, label } = cfg[payType] || cfg[''];
  const admin = currentUser?.isAdmin;
  return `<span class="status-badge ${cls}"${admin ? ` onclick="cyclePayType('${jobId}',${idx})" title="Click to cycle type"` : ''}>${label}</span>`;
}
function toggleHeaderMobile(event, type, id) {
  if (window.innerWidth > 600) return;
  if (event.target.closest('button, a, input, select, textarea, .job-chevron')) return;
  if (type === 'hw') toggleHW(id);
  else toggleJob(id);
}
function toggleCardMobile(event, type, id) {
  if (window.innerWidth > 600) return;
  if (event.target.closest('.job-detail')) return;
  if (event.target.closest('button, a, input, select, textarea, .job-chevron')) return;
  if (type === 'hw') toggleHW(id);
  else toggleJob(id);
}
function toggleHeaderDesktop(event, type, id) {
  if (window.innerWidth <= 600) return;
  if (event.target.closest('button, a, input, select, textarea, .job-chevron')) return;
  if (type === 'hw') toggleHW(id);
  else toggleJob(id);
}
function toggleHeaderRow(event, type, id) {
  if (event.target.closest('button, a, input, select, textarea, .job-chevron')) return;
  event.stopPropagation();
  if (type === 'hw') toggleHW(id);
  else toggleJob(id);
}
function cyclePayType(jobId, idx) {
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job||!job.advances||job.advances[idx]===undefined) return;
  const cycle = {'':'advance','advance':'final','final':'adjustment','adjustment':''};
  job.advances[idx].payType = cycle[job.advances[idx].payType||''];
  save(); renderJobs();
}

function _customerFromName(clientName) {
  const c = clientByName(clientName);
  if (c) {
    return {
      client: c,
      customer: {
        squareCustomerId: c.squareCustomerId || c.squareId || '',
        givenName: c.firstName || '',
        familyName: c.surname || '',
        companyName: c.company || '',
        email: c.email || '',
        phone: c.phone || '',
        referenceId: c.refId || c.id || '',
        note: c.memo || ''
      }
    };
  }
  const parts = String(clientName || '').trim().split(/\s+/).filter(Boolean);
  return {
    client: null,
    customer: {
      givenName: parts[0] || '',
      familyName: parts.slice(1).join(' '),
      companyName: '',
      email: '',
      phone: '',
      referenceId: '',
      note: ''
    }
  };
}

async function _sendSquareInvoicePayload(payload) {
  const rsp = await callSquareFn('squareInvoice', payload);
  showAlert(
    payload.send
      ? `Invoice sent in Square (${rsp.squareInvoiceId || 'no id'}).`
      : `Draft invoice created (${rsp.squareInvoiceId || 'no id'}).`
  );
}

function _jobInvoiceItems(job) {
  const refs = [], lineItems = [];
  const jt = _jobType(job);
  if (jt === 'hourly') {
    if ((job.hourlyStatus || 'pending') !== 'collected' && !job.hourlySquareInvoiceId) {
      const c = calcJob(job);
      const amountCents = Math.round((c.contractTotal || 0) * 100);
      if (amountCents > 0) {
        lineItems.push({ name: `${job.name} - Hourly Services`, amountCents });
        refs.push({ kind:'job', jobId:job.id, itemType:'hourlyRevenue', itemId:'hourlyRevenue' });
      }
    }
  } else {
    (job.milestones || []).forEach(m => {
      if ((m.status || 'pending') === 'collected') return;
      if (m.squareInvoiceId) return;
      const amountCents = Math.round(((m.pct || 0) / 100) * (job.quote || 0) * 100);
      if (!amountCents) return;
      lineItems.push({ name: `${job.name} - ${m.label || 'Milestone'}`, amountCents });
      refs.push({ kind:'job', jobId:job.id, itemType:'milestones', itemId:m.id });
    });
  }
  (job.addOns || []).forEach(a => {
    if ((a.status || 'pending') === 'collected') return;
    if (a.squareInvoiceId) return;
    const amountCents = Math.round((a.amount || 0) * 100);
    if (!amountCents) return;
    lineItems.push({ name: `${job.name} - ${a.label || 'Addition'}`, amountCents });
    refs.push({ kind:'job', jobId:job.id, itemType:'addOns', itemId:a.id });
  });
  (job.subtractions || []).forEach(s => {
    if ((s.status || 'pending') === 'collected') return;
    if (s.squareInvoiceId) return;
    const amountCents = -Math.round((s.amount || 0) * 100);
    if (!amountCents) return;
    lineItems.push({ name: `${job.name} - ${s.label || 'Subtraction'}`, amountCents });
    refs.push({ kind:'job', jobId:job.id, itemType:'subtractions', itemId:s.id });
  });
  return { lineItems, refs };
}

async function createJobSquareInvoice(jobId, send) {
  if (!currentUser?.isAdmin) return;
  const job = (state.jobs || []).find(j => j.id === jobId);
  if (!job) return;
  const built = _jobInvoiceItems(job);
  if (!built.lineItems.length) { showAlert('No invoiceable pending job items found.'); return; }
  const totalCents = built.lineItems.reduce((s, li) => s + li.amountCents, 0);
  if (totalCents <= 0) { showAlert('Invoice total must be greater than $0.00.'); return; }
  const { client, customer } = _customerFromName(job.name);
  const payload = {
    dryRun: false,
    send: !!send,
    currency: 'USD',
    dueDate: today(),
    lineItems: built.lineItems,
    lineItemName: 'Job Work',
    title: `${job.name} Invoice`,
    description: 'Job invoice from EHS Tracker',
    referenceId: job.id,
    note: job.contactName ? `Contact: ${job.contactName}` : '',
    customer,
    source: {
      kind: 'job',
      jobId: job.id,
      clientId: client?.id || '',
      refs: built.refs
    }
  };
  const total = built.lineItems.reduce((s, li) => s + li.amountCents, 0) / 100;
  const threshold = Number(state.settings?.square?.highValueConfirmAmount || 1000);
  const run = async () => {
    try { await _sendSquareInvoicePayload(payload); }
    catch (e) { showAlert(`Square invoice failed: ${e.message || 'unknown error'}`); }
  };
  if (!send) { run(); return; }
  showConfirm('Send this job invoice through Square now?', () => {
    if (total >= threshold) {
      showConfirm(
        `This invoice is ${fmt(total)} (>= ${fmt(threshold)}). Confirm send.`,
        () => { payload.highValueConfirmed = true; run(); },
        { title:'High-Value Send Check', okLabel:'Confirm Send', danger:false }
      );
    } else {
      run();
    }
  }, { title:'Send Invoice', okLabel:'Send', danger:false });
}

async function createHWSquareInvoice(hwId, send) {
  if (!currentUser?.isAdmin) return;
  const hw = (state.homewatch || []).find(h => h.id === hwId);
  if (!hw) return;
  const pending = (hw.payments || []).filter(p => (p.status || 'pending') !== 'collected' && !p.squareInvoiceId);
  if (!pending.length) { showAlert('No invoiceable HomeWatch payments found.'); return; }
  const lineItems = pending.map(p => ({
    name: `${hw.name} - ${fmtDate(p.date) || p.date || 'Service'}`,
    amountCents: Math.round((p.amount || 0) * 100)
  })).filter(li => li.amountCents > 0);
  if (!lineItems.length) { showAlert('Invoice total must be greater than $0.00.'); return; }
  const refs = pending.map(p => ({ kind:'homewatch', hwId:hw.id, itemType:'payments', itemId:p.id }));
  const { client, customer } = _customerFromName(hw.name);
  const payload = {
    dryRun: false,
    send: !!send,
    currency: 'USD',
    dueDate: today(),
    lineItems,
    lineItemName: 'HomeWatch Service',
    title: `${hw.name} HomeWatch Invoice`,
    description: 'HomeWatch service invoice from EHS Tracker',
    referenceId: hw.id,
    customer,
    source: {
      kind: 'homewatch',
      hwId: hw.id,
      clientId: client?.id || '',
      refs
    }
  };
  const total = lineItems.reduce((s, li) => s + li.amountCents, 0) / 100;
  const threshold = Number(state.settings?.square?.highValueConfirmAmount || 1000);
  const run = async () => {
    try { await _sendSquareInvoicePayload(payload); }
    catch (e) { showAlert(`Square invoice failed: ${e.message || 'unknown error'}`); }
  };
  if (!send) { run(); return; }
  showConfirm('Send this HomeWatch invoice through Square now?', () => {
    if (total >= threshold) {
      showConfirm(
        `This invoice is ${fmt(total)} (>= ${fmt(threshold)}). Confirm send.`,
        () => { payload.highValueConfirmed = true; run(); },
        { title:'High-Value Send Check', okLabel:'Confirm Send', danger:false }
      );
    } else {
      run();
    }
  }, { title:'Send Invoice', okLabel:'Send', danger:false });
}

function jobDetail(job, c) {
  const emp    = getEmp(job.employeeId);
  const en     = esc(emp?.name || 'Employee');
  const admin  = currentUser?.isAdmin;
  const empShare = emp?.empShare ?? 0.66;
  const empPct = Math.round((job.repaymentMode ? (1-(state.settings.debtOwnerShare||0.5)) : empShare)*100);
  const partialTag = (item) => {
    if (!item?.partialState) return '';
    const label = item.partialState === 'remaining' ? 'Partial Left' : 'Partial Paid';
    return `<span class="tag tag-his" style="margin-left:6px">${label}</span>`;
  };
  const fmtPctDisplay = (pct) => {
    const n = Number(pct || 0);
    const s = n.toFixed(2);
    return s.endsWith('.00') ? String(Math.round(n)) : s.replace(/0$/, '');
  };
  const partialSplitHint = (item) => {
    if (!item) return '';
    const pct = Number(item.partialPercent || 0);
    const mode = item.partialMode || '';
    let hintDate = item.partialDate || '';
    if (!hintDate && mode) {
      const match = (job.partialCollections || []).slice().reverse().find(p => {
        if ((p.mode || '') !== mode) return false;
        if (mode === 'percent' && pct > 0) return Math.abs(Number(p.partialPercent || 0) - pct) < 0.0001;
        return true;
      });
      hintDate = match?.date || '';
    }
    const dateTxt = hintDate ? fmtDate(hintDate) : '';
    if (mode === 'percent' && pct > 0) {
      return ` <span style="font-size:12px;color:var(--text3)">(${fmtPctDisplay(pct)}% partial${dateTxt ? ` - ${dateTxt}` : ''})</span>`;
    }
    if (mode) {
      return ` <span style="font-size:12px;color:var(--text3)">(partial${dateTxt ? ` - ${dateTxt}` : ''})</span>`;
    }
    return '';
  };
  const jobType = _jobType(job);
  const isLegacyHourly = false;
  const isHourly = jobType === 'hourly';

  const hasLegacyPartial = !(job.partialCollections || []).length && (
    (isLegacyHourly
      ? (job.revenueItems || []).some(r => !!r.partialState)
      : (job.milestones || []).some(m => !!m.partialState)) ||
    (job.addOns || []).some(a => !!a.partialState) ||
    (job.subtractions || []).some(s => !!s.partialState)
  );
  const milestoneEntries = (job.milestones || []).map((m, i) => ({ m, i }));
  const renderedMilestoneGroups = new Set();
  const milestonesHtml = milestoneEntries.map(({ m, i }) => {
    const groupId = m.partialGroupId || '';
    if (groupId && renderedMilestoneGroups.has(groupId)) return '';
    if (groupId) {
      renderedMilestoneGroups.add(groupId);
      const group = milestoneEntries.filter(x => x.m.partialGroupId === groupId);
      const parentLabel = group[0]?.m.partialParentLabel || group[0]?.m.label || `Milestone ${i + 1}`;
      const rawParentPct = Number(group[0]?.m.partialParentPct || 0);
      const parentPct = rawParentPct > 0 ? rawParentPct : group.reduce((sum, x) => sum + Number(x.m.pct || 0), 0);
      const parentAmt = (parentPct / 100) * (job.quote || 0);
      const splitHint = partialSplitHint(group[0]?.m);
      const childrenHtml = group.map(({ m: gm, i: gi }) => {
        const amt = (gm.pct / 100) * (job.quote || 0);
        const st = gm.status || 'pending';
        const childTag = partialTag(gm);
        return `<div class="line-item" style="padding-left:16px">
          <div class="line-item-label" style="display:flex;align-items:center;gap:6px">
            <span style="color:var(--text3)">&#8627;</span>${childTag || '<span class="tag tag-his">Partial</span>'}
          </div>
          <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
            <div class="line-item-value ${st==='collected'?'green':'dim'}">${fmt(amt)}</div>
            ${badgeHtml(st,job.id,'milestones',gi)}
          </div>
        </div>`;
      }).join('');
      return `<div class="line-item">
        <div class="line-item-label">${esc(parentLabel)} (${fmtPctDisplay(parentPct)}%)${splitHint}</div>
        <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
          <div class="line-item-value dim">${fmt(parentAmt)}</div>
        </div>
      </div>${childrenHtml}`;
    }
    const amt = (m.pct / 100) * (job.quote || 0);
    const st = m.status || 'pending';
    const tag = partialTag(m);
    return `<div class="line-item">
      <div class="line-item-label" style="display:flex;flex-direction:column;gap:4px">
        <span>${esc(m.label||`Milestone ${i+1}`)} (${fmtPctDisplay(m.pct)}%)</span>
        ${tag ? `<span>${tag}</span>` : ''}
      </div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value ${st==='collected'?'green':'dim'}">${fmt(amt)}</div>
        ${badgeHtml(st,job.id,'milestones',i)}
      </div>
    </div>`;
  }).join('');
  const revenueEntries = (job.revenueItems || []).map((r, i) => ({ r, i }));
  const renderedRevenueGroups = new Set();
  const hourlyRevenueHtml = revenueEntries.map(({ r, i }) => {
    const groupId = r.partialGroupId || '';
    if (groupId && renderedRevenueGroups.has(groupId)) return '';
    if (groupId) {
      renderedRevenueGroups.add(groupId);
      const group = revenueEntries.filter(x => x.r.partialGroupId === groupId);
      const parentLabel = group[0]?.r.partialParentLabel || group[0]?.r.label || 'Revenue';
      const rawParentAmt = Number(group[0]?.r.partialParentAmount || 0);
      const parentAmt = _roundMoney(rawParentAmt > 0 ? rawParentAmt : group.reduce((sum, x) => sum + Number(x.r.amount || 0), 0));
      const splitHint = partialSplitHint(group[0]?.r);
      const childrenHtml = group.map(({ r: gr, i: gi }) => {
        const st = gr.status || 'pending';
        const childTag = partialTag(gr);
        return `<div class="line-item" style="padding-left:16px">
          <div class="line-item-label" style="display:flex;align-items:center;gap:6px">
            <span style="color:var(--text3)">&#8627;</span>${childTag || '<span class="tag tag-his">Partial</span>'}
          </div>
          <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
            <div class="line-item-value ${st==='collected' ? 'green' : 'dim'}">${fmt(gr.amount)}</div>
            ${badgeHtml(st,job.id,'revenueItems',gi)}
            <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="openAddItem('${job.id}','revenue','${gr.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
            <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeItem('${job.id}','revenueItems',${gi})" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
          </div>
        </div>`;
      }).join('');
      return `<div class="line-item">
        <div class="line-item-label">${esc(parentLabel)}${splitHint}</div>
        <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
          <div class="line-item-value dim">${fmt(parentAmt)}</div>
        </div>
      </div>${childrenHtml}`;
    }
    const st = r.status || 'pending';
    const tag = partialTag(r);
    return `<div class="line-item">
      <div class="line-item-label" style="display:flex;flex-direction:column;gap:4px">
        <span>${esc(r.label || 'Revenue')}${r.date ? `<span style="font-size:14px;color:var(--text3);margin-left:6px">${fmtDate(r.date)}</span>` : ''}</span>
        ${tag ? `<span>${tag}</span>` : ''}
      </div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value ${st==='collected' ? 'green' : 'dim'}">${fmt(r.amount)}</div>
        ${badgeHtml(st,job.id,'revenueItems',i)}
        <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="openAddItem('${job.id}','revenue','${r.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
        <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeItem('${job.id}','revenueItems',${i})" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
      </div>
    </div>`;
  }).join('');

  const subtractionsHtml = (job.subtractions||[]).map((a,i) => {
    const st = a.status||'pending';
    return `<div class="line-item">
      <div class="line-item-label">${esc(a.label||'Subtraction')}${partialTag(a)}${a.date?`<span style="font-size:14px;color:var(--text3);margin-left:6px">${fmtDate(a.date)}</span>`:''}</div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value red">-${fmt(a.amount)}</div>
        ${badgeHtml(st,job.id,'subtractions',i)}
        <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="openAddItem('${job.id}','subtraction','${a.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
        <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeItem('${job.id}','subtractions',${i})" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
      </div>
    </div>`;
  }).join('');

  const addOnEntries = (job.addOns || []).map((a, i) => ({ a, i }));
  const standardAddOnEntries = addOnEntries.filter(({ a }) => !a.isHours);
  const hoursAddOnEntries = addOnEntries.filter(({ a }) => !!a.isHours);
  const renderAddOnRows = (entries, editType, showStatusBadge = true) => {
    const renderedGroups = new Set();
    return entries.map(({ a, i }) => {
      const groupId = a.partialGroupId || '';
      if (groupId && renderedGroups.has(groupId)) return '';
      if (groupId) {
        renderedGroups.add(groupId);
        const group = entries.filter(x => x.a.partialGroupId === groupId);
        const parentLabel = group[0]?.a.partialParentLabel || group[0]?.a.label || 'Addition';
        const rawParentAmt = Number(group[0]?.a.partialParentAmount || 0);
        const parentAmt = _roundMoney(rawParentAmt > 0 ? rawParentAmt : group.reduce((sum, x) => sum + Number(x.a.amount || 0), 0));
        const splitHint = partialSplitHint(group[0]?.a);
        const childrenHtml = group.map(({ a: ga, i: gi }) => {
          const st = ga.status || 'pending';
          const childTag = partialTag(ga);
          return `<div class="line-item" style="padding-left:16px">
            <div class="line-item-label" style="display:flex;align-items:center;gap:6px">
              <span style="color:var(--text3)">&#8627;</span>${childTag || '<span class="tag tag-his">Partial</span>'}
            </div>
            <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
              <div class="line-item-value ${st==='collected' ? 'green' : 'dim'}">${fmt(ga.amount)}</div>
              ${showStatusBadge ? badgeHtml(st,job.id,'addOns',gi) : ''}
              <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="openAddItem('${job.id}','${editType}','${ga.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
              <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeItem('${job.id}','addOns',${gi})" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
            </div>
          </div>`;
        }).join('');
        return `<div class="line-item">
          <div class="line-item-label">${esc(parentLabel)}${splitHint}</div>
          <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
            <div class="line-item-value dim">${fmt(parentAmt)}</div>
          </div>
        </div>${childrenHtml}`;
      }
      const st = a.status || 'pending';
      const tag = partialTag(a);
      const hoursMeta = a.isHours
        ? `<div style="font-size:14px;color:var(--text3);margin-top:2px">${(Number(a.hours || 0)).toFixed(2)}h @ ${fmt(a.rate || 0)}${a.date ? ` ${fmtDate(a.date)}` : ''}</div>`
        : '';
      return `<div class="line-item">
        <div class="line-item-label" style="display:flex;flex-direction:column;gap:4px">
          <span>${esc(a.label || (a.isHours ? 'Hours' : 'Addition'))}${!a.isHours && a.date ? `<span style="font-size:14px;color:var(--text3);margin-left:6px">${fmtDate(a.date)}</span>` : ''}</span>
          ${hoursMeta}
          ${tag ? `<span>${tag}</span>` : ''}
        </div>
        <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
          <div class="line-item-value ${st==='collected' ? 'green' : 'dim'}">${fmt(a.amount)}</div>
          ${showStatusBadge ? badgeHtml(st,job.id,'addOns',i) : ''}
          <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="openAddItem('${job.id}','${editType}','${a.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
          <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeItem('${job.id}','addOns',${i})" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
        </div>
      </div>`;
    }).join('');
  };
  const addOnsHtml = renderAddOnRows(standardAddOnEntries, 'addon');
  const hoursHtml = renderAddOnRows(hoursAddOnEntries, 'hours', !isHourly);

  const partialHistoryHtml = (job.partialCollections || []).length
    ? `<div style="margin-top:10px;border-top:1px dashed var(--border);padding-top:10px">
        <div style="font-family:var(--mono);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Revenue Collections</div>
        ${(job.partialCollections || []).slice().reverse().map((p, revIdx) => {
          const isLatest = revIdx === 0;
          const modeTxt = p.mode === 'percent' ? `${fmtPctDisplay(p.partialPercent || 0)}%` : 'Dollar';
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <div style="min-width:0">
              <div style="font-size:14px">${fmt(p.paymentTotal || 0)} <span style="font-size:12px;color:var(--text3)">(${modeTxt})</span></div>
              <div style="font-size:12px;color:var(--text3)">${fmtDate(p.date) || p.date || ''}${p.note ? ` - ${esc(p.note)}` : ''}</div>
            </div>
            <div class="admin-only" style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <button class="btn btn-ghost btn-sm job-icon-btn" onclick="editPartialCollection('${job.id}','${p.id}')" ${isLatest ? '' : 'disabled'} title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
              <button class="btn btn-danger btn-sm btn-icon-only" onclick="deletePartialCollection('${job.id}','${p.id}')" ${isLatest ? '' : 'disabled'} title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
            </div>
          </div>`;
        }).join('')}
      </div>`
    : '';
  const legacyPartialHtml = hasLegacyPartial
    ? `<div style="margin-top:10px;border-top:1px dashed var(--border);padding-top:10px">
        <div style="font-size:13px;color:var(--text3);margin-bottom:8px">Legacy partial payment detected (created before edit history support).</div>
        <button class="btn btn-ghost btn-sm admin-only" onclick="rebuildLegacyPartial('${job.id}')">Rebuild Legacy Partial</button>
      </div>`
    : '';
  const matsHtml = (job.materials||[]).map((m,i) => `
    <div class="line-item">
      <div class="line-item-label">${esc(m.label||'Materials')}<span class="tag ${m.who==='owner'?'tag-mine':'tag-his'}">${m.who==='owner'?'EHS':en}</span></div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value red">${fmt(Number(isHourly ? (m.costAmount ?? m.amount ?? 0) : (m.amount ?? 0)))}</div>
        <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="openAddItem('${job.id}','material','${m.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
        <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeItem('${job.id}','materials',${i})" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
      </div>
    </div>`).join('');
  const clientChargeSummaryHtml = jobClientChargeSummaryHtml(job, c);

  const advHtml = (job.advances||[]).map((a,i) => `
    <div class="line-item">
      <div class="line-item-label">${esc(a.label||'Pay')} <span style="font-size:15px;color:var(--text3)">${fmtDate(a.date)||''}</span></div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value red">${fmt(a.amount)}</div>
        ${payTypeBadgeHtml(a.payType||'', job.id, i)}
        <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="openAddItem('${job.id}','advance','${a.id}')" title="Edit" aria-label="Edit">${jobIconSvg('edit')}</button>
        <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="removeItem('${job.id}','advances',${i})" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
      </div>
    </div>`).join('');

  return `
  <div class="job-detail">
    <div class="detail-grid">

      <div class="detail-section">
        <div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">${isHourly ? 'Hours' : 'Client Charges'}</div>
          ${isHourly
            ? `<button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','hours')">+</button>`
            : `<button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openPartialCollect('${job.id}')" title="Record payment">+</button>`}
        </div>
        ${isHourly
          ? (hoursHtml || '<div style="color:var(--text3);font-size:16px;padding:4px 0">No hours entries yet.</div>')
          : isLegacyHourly
          ? (hourlyRevenueHtml || '<div style="color:var(--text3);font-size:16px;padding:4px 0">No revenue entries yet.</div>')
          : `${clientChargeSummaryHtml}${milestonesHtml ? `<div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin:14px 0 8px;padding-bottom:8px;border-bottom:1px solid var(--border)"><div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Billing schedule</div></div>${milestonesHtml}` : ''}`
        }
        ${isHourly ? '' : partialHistoryHtml}
        ${isHourly ? '' : legacyPartialHtml}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Collected / Net Revenue</div>
        ${isHourly ? `<div class="line-item"><div class="line-item-label">Invoice</div><div class="line-item-actions" style="display:flex;align-items:center;gap:8px"><div class="line-item-value dim">${fmt(c.contractTotal)}</div>${badgeHtml(job.hourlyStatus || 'pending',job.id,'hourlyRevenue',0)}</div></div>` : ''}
        <div class="total-line"><span style="color:var(--text2)">Collected (gross)</span><span class="line-item-value green">${fmt(c.collectedGross)}</span></div>
        <div class="admin-only">
          <div class="line-item mobile-fee-row" style="padding-top:6px">
            <div class="line-item-label" style="font-size:16px"><span class="fee-label-main">Est. Square fees</span><span class="fee-label-detail"> (~${(state.settings.feeRate*100).toFixed(1)}%${state.settings.txnFee ? ` + $${state.settings.txnFee.toFixed(2)}/txn` : ''})</span></div>
            <div class="line-item-value red" style="font-size:16px">-${fmt(c.totalFees)}</div>
          </div>
          <div class="total-line"><span style="color:var(--text2)">Net Revenue</span><span class="line-item-value orange">${fmt(c.netRevenue)}</span></div>
        </div>
      </div>

      ${isHourly ? '' : `<div class="detail-section">
        <div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Subtractions</div>
          <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','subtraction')">+</button>
        </div>
        ${subtractionsHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None</div>'}
        ${c.subtractionTotal>0?`<div class="total-line"><span style="color:var(--text2)">Total</span><span class="line-item-value red">-${fmt(c.subtractionTotal)}</span></div>`:''}
      </div>`}

      <div class="detail-section">
        ${isHourly ? `
          <div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
            <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Materials</div>
            <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','material')">+</button>
          </div>
          ${matsHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None logged</div>'}
          <div style="margin-top:4px;padding-top:4px">
            <div class="line-item admin-only"><div class="line-item-label" style="font-size:16px">EHS materials</div><div class="line-item-value dim" style="font-size:16px">-${fmt(c.ownerMats)}</div></div>
            <div class="line-item"><div class="line-item-label" style="font-size:16px">${en}'s materials</div><div class="line-item-value dim" style="font-size:16px">-${fmt(c.empMats)}</div></div>
          </div>
          <div class="total-line"><span style="color:var(--text2)">Total Materials</span><span class="line-item-value" style="color:var(--purple)">+${fmt((job.materials||[]).reduce((s,m)=>s+Number(m.chargeAmount ?? m.amount ?? 0),0))}</span></div>
        ` : isLegacyHourly ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
            <div>
              <div class="detail-section-header" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding-bottom:8px;border-bottom:1px solid var(--border)">
                <div class="detail-section-title" style="margin:0;padding:0;border:none">Additions</div>
                <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','addon')">+</button>
              </div>
              ${addOnsHtml || '<div style="color:var(--text3);font-size:16px;padding:4px 0">None</div>'}
            </div>
            <div>
              <div class="detail-section-header" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding-bottom:8px;border-bottom:1px solid var(--border)">
                <div class="detail-section-title" style="margin:0;padding:0;border:none">Hours</div>
                <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','hours')">+</button>
              </div>
              ${hoursHtml || '<div style="color:var(--text3);font-size:16px;padding:4px 0">None</div>'}
            </div>
          </div>
        ` : `
          <div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
            <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Additions</div>
            <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','addon')">+</button>
          </div>
          ${addOnsHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None</div>'}
          ${hoursAddOnEntries.length ? `
            <div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin:14px 0 8px;padding-bottom:8px;border-bottom:1px solid var(--border)">
              <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Hours</div>
              <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','hours')">+</button>
            </div>
            ${hoursHtml}
          ` : ''}
        `}
        ${c.addOnTotal>0?`<div class="total-line"><span style="color:var(--text2)">Total</span><span class="line-item-value" style="color:var(--purple)">+${fmt(c.addOnTotal)}</span></div>`:''}
      </div>

      ${isHourly ? '' : `<div class="detail-section">
        <div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Materials</div>
          <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','material')">+</button>
        </div>
        ${matsHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None logged</div>'}
        <div style="margin-top:4px;padding-top:4px">
          <div class="line-item admin-only"><div class="line-item-label" style="font-size:16px">EHS materials</div><div class="line-item-value dim" style="font-size:16px">-${fmt(c.ownerMats)}</div></div>
          <div class="line-item"><div class="line-item-label" style="font-size:16px">${en}'s materials</div><div class="line-item-value dim" style="font-size:16px">-${fmt(c.empMats)}</div></div>
        </div>
        <div class="total-line"><span style="color:var(--text2)">Total Materials</span><span class="line-item-value red">-${fmt(c.totalMats)}</span></div>
      </div>`}

      <div class="detail-section">
        <div class="detail-section-header" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Employee Pay</div>
          <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','advance')">+</button>
        </div>
        ${advHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None logged</div>'}
        <div class="total-line"><span style="color:var(--text2)">Total Paid</span><span class="line-item-value red">-${fmt(c.advancesPaid)}</span></div>
      </div>

    </div>

    <div class="settlement-box">
      <div class="settlement-title">Settlement Breakdown${job.repaymentMode?` <span style="color:var(--red);font-size:14px;margin-left:8px">REPAYMENT SPLIT ${Math.round((state.settings.debtOwnerShare||0.5)*100)}/${Math.round((1-(state.settings.debtOwnerShare||0.5))*100)}</span>`:''}</div>
      <div class="settlement-grid" style="${admin?'':'grid-template-columns:1fr'}">
        <div class="admin-only">
          <div class="settlement-col-title">Your ${Math.round((job.repaymentMode?(state.settings.debtOwnerShare||0.5):(1-empShare))*100)}%</div>
          <div class="settlement-big orange">${fmt(c.ownerProfit)}</div>
          <div style="font-size:16px;color:var(--text3);font-family:var(--mono)">profit share</div>
          ${job.repaymentMode&&c.debtContribution>0?`<div style="font-size:16px;color:var(--red);font-family:var(--mono);margin-top:4px">${fmt(c.debtContribution)} to debt</div>`:''}
          <div style="font-size:16px;color:var(--text2);font-family:var(--mono);margin-top:4px">+ ${fmt(c.ownerMats)} mats back</div>
          <div style="font-size:17px;color:var(--green);font-family:var(--mono);font-weight:600;margin-top:6px;border-top:1px solid var(--border);padding-top:6px">= ${fmt(c.ownerTotal)} total</div>
        </div>
        <div>
          <div class="settlement-col-title">${admin ? `${en} (${empPct}%)` : `Your share (${empPct}%)`}</div>
          <div class="settlement-big ${c.empBalance>0?'orange':'green'}">${fmt(Math.abs(c.empBalance))}</div>
          <div style="font-size:16px;color:var(--text3);font-family:var(--mono)">${c.empBalance>0?'still owed':(admin?'he owes you':'you owe')}</div>
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono)">Profit share: ${fmt(c.empProfit)}</div>
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono)">+ Mats back: ${fmt(c.empMats)}</div>
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono);border-top:1px solid var(--border);padding-top:4px;margin-top:4px">= Total owed: ${fmt(c.empTotalOwed)}</div>
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono)">- Paid out: ${fmt(c.advancesPaid)}</div>
            ${c.linkedDebtPaid>0?`<div style="font-size:16px;color:var(--red);font-family:var(--mono)">- Debt repayment: ${fmt(c.linkedDebtPaid)}</div>`:''}
          </div>
          <div style="font-size:15px;color:var(--text3);font-family:var(--mono);margin-top:6px">Profit pool: ${fmt(c.profitPool)}</div>
        </div>
      </div>
    </div>

    <div class="settlement-box" style="border-color:rgba(255,193,7,0.35)">
      <div class="settlement-title">Potential (if everything pending is collected)
        <span style="color:var(--text3);font-size:13px;margin-left:8px;font-family:var(--mono)">preview</span>
        ${job.repaymentMode?` <span style="color:rgba(255,193,7,0.95);font-size:14px;margin-left:8px">POTENTIAL REPAYMENT</span>`:''}
      </div>
      <div class="settlement-grid" style="${admin?'':'grid-template-columns:1fr'}">
        <div class="admin-only">
          <div class="settlement-col-title">Your potential</div>
          <div class="settlement-big orange">${fmt(c.potentialOwnerProfit)}</div>
          <div style="font-size:16px;color:var(--text3);font-family:var(--mono)">profit share</div>
          ${job.repaymentMode&&c.potentialDebtContribution>0?`<div style="font-size:16px;color:rgba(255,193,7,0.95);font-family:var(--mono);margin-top:4px">${fmt(c.potentialDebtContribution)} to debt</div>`:''}
          <div style="font-size:16px;color:var(--text2);font-family:var(--mono);margin-top:4px">+ ${fmt(c.ownerMats)} mats back</div>
          <div style="font-size:17px;color:var(--green);font-family:var(--mono);font-weight:600;margin-top:6px;border-top:1px solid var(--border);padding-top:6px">= ${fmt(c.potentialOwnerTotal)} total</div>
        </div>
        <div>
          <div class="settlement-col-title">${admin ? `${en} (potential)` : 'Your potential'}</div>
          <div class="settlement-big ${c.potentialEmpBalance>0?'orange':'green'}">${fmt(Math.abs(c.potentialEmpBalance))}</div>
          <div style="font-size:16px;color:var(--text3);font-family:var(--mono)">${c.potentialEmpBalance>0?'still owed':(admin?'he owes you':'you owe')}</div>
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono)">Projected profit pool: ${fmt(c.projectedProfitPool)}</div>
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono);border-top:1px solid var(--border);padding-top:4px;margin-top:4px">= Total owed: ${fmt(c.potentialEmpTotalOwed)}</div>
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono)">- Paid out: ${fmt(c.advancesPaid)}</div>
            ${c.linkedDebtPaid>0?`<div style="font-size:16px;color:var(--red);font-family:var(--mono)">- Debt repayment: ${fmt(c.linkedDebtPaid)}</div>`:''}
          </div>
        </div>
      </div>
    </div>

    <div class="admin-only job-detail-footer">
      <div class="job-detail-admin-actions">
        <button class="btn btn-ghost btn-sm" onclick="createJobSquareInvoice('${job.id}', false)">Square Draft</button>
        <button class="btn btn-ghost btn-sm" onclick="createJobSquareInvoice('${job.id}', true)">Square Send</button>
      <button class="btn btn-ghost btn-sm job-icon-btn" onclick="editJob('${job.id}')" title="Edit job" aria-label="Edit job">${jobIconSvg('edit')}</button>
        <button class="btn btn-${job.status==='complete'?'ghost':'green'} btn-sm" onclick="toggleComplete('${job.id}')">
          ${job.status==='complete'?'Reopen':'Complete'}
        </button>
      <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteJob('${job.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
        <button class="repay-toggle${job.repaymentMode?' active':''}" onclick="toggleRepayment('${job.id}')" title="Toggle debt repayment split for this job">${job.repaymentMode?'Repaying':'Normal'}</button>
      </div>
    </div>
  </div>`;
}

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
// ─── DEBT PAYMENTS ────────────────────────────────────────────────────────────
function openAddDebtPayment() {
  document.getElementById('dp_label').value  = '';
  document.getElementById('dp_amount').value = '';
  document.getElementById('dp_date').value   = today();
  document.getElementById('dp_linkJob').checked = false;
  document.getElementById('dp_jobWrap').style.display = 'none';
  const activeJobs = state.jobs.filter(j => j.status !== 'complete');
  const activeHW   = (state.homewatch || []).filter(hw => hw.status !== 'paused');
  const jobOpts    = activeJobs.map(j => {
    const bal = calcJob(j).empBalance;
    return `<option value="job:${j.id}">${esc(j.name)} (owed: ${fmt(bal)})</option>`;
  }).join('');
  const hwOpts = activeHW.map(hw => {
    const bal = calcHW(hw).empBalance;
    return `<option value="hw:${hw.id}">${esc(hw.name)} (owed: ${fmt(bal)})</option>`;
  }).join('');
  document.getElementById('dp_linkSelect').innerHTML =
    '<option value="">- Select -</option>' +
    (jobOpts ? `<optgroup label="Jobs">${jobOpts}</optgroup>` : '') +
    (hwOpts  ? `<optgroup label="HomeWatch">${hwOpts}</optgroup>`  : '');
  document.getElementById('debtPaymentModal').classList.remove('hidden');
}
function toggleDpLink() {
  const on = document.getElementById('dp_linkJob').checked;
  document.getElementById('dp_jobWrap').style.display = on ? '' : 'none';
}
function saveDebtPayment() {
  const amount = parseFloat(document.getElementById('dp_amount').value);
  if (!amount || amount <= 0) { showAlert('Please enter a valid amount.'); return; }
  const label  = document.getElementById('dp_label').value.trim();
  const date   = document.getElementById('dp_date').value;
  const linked = document.getElementById('dp_linkJob').checked;
  const sel    = linked ? document.getElementById('dp_linkSelect').value : '';
  if (linked && !sel) { showAlert('Please select a job or HomeWatch client.'); return; }
  const linkedJobId = (linked && sel.startsWith('job:')) ? sel.slice(4) : null;
  const linkedHWId  = (linked && sel.startsWith('hw:'))  ? sel.slice(3) : null;
  if (!state.debtPayments) state.debtPayments = [];
  state.debtPayments.push({ id: uid(), label, amount, date, linkedJobId, linkedHWId });
  save(); renderAll(); closeModal('debtPaymentModal');
}
function deleteDebtPayment(id) {
  showConfirm('Remove this payment?', () => {
    state.debtPayments = (state.debtPayments || []).filter(p => p.id !== id);
    save(); renderAll();
  });
}

function _collectAdvanceRows() {
  const out = [];
  (state.jobs || []).forEach(j => {
    (j.advances || []).forEach(a => {
      out.push({
        sourceKind: 'job',
        sourceId: j.id,
        sourceName: j.name || 'Job',
        employeeId: j.employeeId || '',
        advance: a || {}
      });
    });
  });
  (state.homewatch || []).forEach(hw => {
    (hw.advances || []).forEach(a => {
      out.push({
        sourceKind: 'hw',
        sourceId: hw.id,
        sourceName: hw.name || 'HomeWatch',
        employeeId: hw.employeeId || '',
        advance: a || {}
      });
    });
  });
  return out;
}
function _buildLedgerFromStoredEvents() {
  const rows = [];
  const byEventId = {};
  (state.splitPayments || []).forEach(e => { if (e?.id) byEventId[e.id] = e; });
  (state.splitPayments || []).forEach(e => {
    rows.push({
      id: `stored:${e.id}`,
      source: 'stored',
      date: e.date || '',
      label: e.label || 'Split payment',
      mode: e.mode || 'split',
      employeeId: e.employeeId || '',
      total: Number(e.total || 0),
      allocations: (e.allocations || []).map(a => ({
        sourceKind: a.sourceKind || '',
        sourceId: a.sourceId || '',
        sourceName: a.sourceName || '',
        amount: Number(a.amount || 0),
        payType: a.payType || ''
      }))
    });
  });
  return { rows, byEventId };
}
function _buildLedgerFromLegacy(byEventId = {}) {
  const groups = {};
  _collectAdvanceRows().forEach(({ sourceKind, sourceId, sourceName, employeeId, advance }) => {
    const splitEventId = (advance.splitEventId || '').trim();
    if (splitEventId && byEventId[splitEventId]) return;
    const amount = Number(advance.amount || 0);
    if (Math.abs(amount) <= 0.005) return;
    const label = (advance.label || '').trim();
    const date = (advance.date || '').trim();
    if (!label) return;
    const key = `${date}||${label}`;
    if (!groups[key]) groups[key] = { date, label, allocations: [], employeeIds: new Set() };
    groups[key].allocations.push({ sourceKind, sourceId, sourceName, amount, payType: advance.payType || '' });
    if (employeeId) groups[key].employeeIds.add(employeeId);
  });
  const out = [];
  Object.keys(groups).forEach(key => {
    const g = groups[key];
    const isLikelySplit = g.allocations.length > 1 || /^(split payment|pay out)/i.test(g.label);
    if (!isLikelySplit) return;
    const total = g.allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
    const mode = /\(potential\)/i.test(g.label) ? 'potential' : 'split';
    const employeeId = g.employeeIds.size === 1 ? [...g.employeeIds][0] : '';
    out.push({
      id: `legacy:${key}`,
      source: 'legacy',
      date: g.date,
      label: g.label,
      mode,
      employeeId,
      total,
      allocations: g.allocations
    });
  });
  return out;
}
function _getSplitLedgerEntries() {
  const { rows: storedRows, byEventId } = _buildLedgerFromStoredEvents();
  const legacyRows = _buildLedgerFromLegacy(byEventId);
  const all = [...storedRows, ...legacyRows];
  all.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da === db) return (a.label || '').localeCompare(b.label || '');
    return db.localeCompare(da);
  });
  return all;
}
function openSplitLedger() {
  renderSplitLedger();
  document.getElementById('splitLedgerModal').classList.remove('hidden');
}
function _scrollLedgerTargetIntoView(el) {
  if (!el) return;
  const headerOffset = window.innerWidth <= 600 ? 76 : 92;
  const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 1200);
}
function goToLedgerSource(sourceKind, sourceId) {
  if (!sourceId) return;
  closeModal('splitLedgerModal');
  if (sourceKind === 'hw') {
    expandedHW.clear();
    expandedHW.add(sourceId);
    saveExpandedState();
    goToTab('homewatch');
    setTimeout(() => {
      renderHomewatch();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        _scrollLedgerTargetIntoView(document.getElementById(`hw_${sourceId}`));
      }));
    }, 40);
    return;
  }
  expandedJobs.clear();
  expandedJobs.add(sourceId);
  saveExpandedState();
  goToTab('all');
  setTimeout(() => {
    renderJobs();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.querySelector(`#tab-all #job_${sourceId}`) || document.getElementById(`job_${sourceId}`);
      _scrollLedgerTargetIntoView(target);
    }));
  }, 40);
}
function renderSplitLedger() {
  const wrap = document.getElementById('splitLedgerList');
  if (!wrap) return;
  const rows = _getSplitLedgerEntries();
  if (!rows.length) {
    wrap.innerHTML = '<div style="color:var(--text3);font-size:15px;padding:12px 0">No split pay / payout events yet.</div>';
    return;
  }
  wrap.innerHTML = rows.map(r => {
    const empName = r.employeeId ? (getEmp(r.employeeId)?.name || '') : '';
    const modeLabel = r.mode === 'potential' ? 'Potential' : 'Split';
    const allocHtml = (r.allocations || []).map(a => `
      <button type="button" style="width:100%;background:none;border:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);cursor:pointer;color:inherit;text-align:left" data-kind="${a.sourceKind || ''}" data-id="${a.sourceId || ''}" onclick="goToLedgerSource(this.dataset.kind, this.dataset.id)" title="Open ${esc(a.sourceName || (a.sourceKind === 'hw' ? 'HomeWatch' : 'Job'))}">
        <span style="min-width:0">${esc(a.sourceName || (a.sourceKind === 'hw' ? 'HomeWatch' : 'Job'))}</span>
        <span style="font-family:var(--mono);white-space:nowrap;color:${Number(a.amount || 0) < 0 ? 'var(--red)' : 'var(--green)'}">${fmt(a.amount || 0)}</span>
      </button>`).join('');
    return `<div style="border:1px solid var(--border2);border-radius:3px;padding:10px 12px;margin-bottom:10px;background:var(--bg3)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="min-width:0">
          <div style="font-size:15px">${esc(r.label || 'Split payment')}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text3)">${fmtDate(r.date)}${empName ? ` | ${esc(empName)}` : ''} | ${modeLabel}${r.source === 'legacy' ? ' | legacy' : ''}</div>
        </div>
        <div style="font-family:var(--mono);font-size:15px;color:${Number(r.total || 0) < 0 ? 'var(--red)' : 'var(--green)'};white-space:nowrap">${fmt(r.total || 0)}</div>
      </div>
      <div style="border-top:1px dashed var(--border);padding-top:6px">${allocHtml}</div>
    </div>`;
  }).join('');
}

// ─── SPLIT PAY ────────────────────────────────────────────────────────────────
function _buildPayOutRows(employeeId) {
  if (!employeeId) return [];
  const rows = [];
  state.jobs.filter(j => j.status !== 'complete' && j.employeeId === employeeId).forEach(j => {
    const c = calcJob(j);
    rows.push({
      id: `sp_job_${j.id}`,
      label: j.name || 'Job',
      kind: 'job',
      owedNow: Number(c.empBalance || 0),
      potential: Number(c.potentialEmpBalance || 0)
    });
  });
  (state.homewatch || []).filter(hw => hw.status !== 'paused' && hw.employeeId === employeeId).forEach(hw => {
    const c = calcHW(hw);
    rows.push({
      id: `sp_hw_${hw.id}`,
      label: hw.name || 'HomeWatch',
      kind: 'hw',
      owedNow: Number(c.empBalance || 0),
      potential: Number(c.potentialEmpBalance || 0)
    });
  });
  return rows;
}
function _calcPayOutPlan(employeeId) {
  const rows = _buildPayOutRows(employeeId).map(r => {
    const owedPayable = Math.max(0, Number(r.owedNow || 0));
    const payToZeroTarget = Number(r.potential || 0);
    return {
      ...r,
      owedPayable: _roundMoney(owedPayable),
      payNowTarget: _roundMoney(owedPayable),
      payToZeroTarget: _roundMoney(payToZeroTarget)
    };
  });
  const payNowTotal = _roundMoney(rows.reduce((s, r) => s + r.payNowTarget, 0));
  const payToZeroTotal = _roundMoney(rows.reduce((s, r) => s + r.payToZeroTarget, 0));
  return {
    rows,
    payNowTotal,
    payToZeroTotal,
    potentialAddOn: _roundMoney(payToZeroTotal - payNowTotal)
  };
}
function setPayOutMode(mode) {
  if (mode !== 'pay_now' && mode !== 'pay_to_zero') return;
  payOutCtx.mode = mode;
  renderPayOut();
}
function openPayOut() {
  if (!currentUser?.isAdmin) return;
  const employees = state.users.filter(u => !u.isAdmin);
  if (!employees.length) { showAlert('No employees available for payout.'); return; }
  const select = document.getElementById('po_employee');
  if (!select) return;
  if (!payOutCtx.employeeId || !employees.some(e => e.id === payOutCtx.employeeId)) {
    payOutCtx.employeeId = employees[0].id;
  }
  if (payOutCtx.mode !== 'pay_now' && payOutCtx.mode !== 'pay_to_zero') payOutCtx.mode = 'pay_now';
  select.innerHTML = employees.map(e => `<option value="${e.id}"${e.id === payOutCtx.employeeId ? ' selected' : ''}>${esc(e.name || 'Employee')}</option>`).join('');
  document.getElementById('po_date').value = today();
  renderPayOut();
  document.getElementById('payOutModal').classList.remove('hidden');
}
function renderPayOut() {
  const select = document.getElementById('po_employee');
  if (!select) return;
  payOutCtx.employeeId = select.value || payOutCtx.employeeId || '';
  const mode = payOutCtx.mode === 'pay_to_zero' ? 'pay_to_zero' : 'pay_now';
  const includePotential = mode === 'pay_to_zero';
  const plan = _calcPayOutPlan(payOutCtx.employeeId);
  const selectedTotal = includePotential ? plan.payToZeroTotal : plan.payNowTotal;
  const payNowBtn = document.getElementById('po_mode_now');
  const payToZeroBtn = document.getElementById('po_mode_zero');
  if (payNowBtn) payNowBtn.classList.toggle('active', mode === 'pay_now');
  if (payToZeroBtn) payToZeroBtn.classList.toggle('active', mode === 'pay_to_zero');
  const totalsEl = document.getElementById('po_totals');
  if (totalsEl) {
    totalsEl.innerHTML = `
      <span>Pay Now (completed only) <strong>${fmt(plan.payNowTotal)}</strong></span>
      <span>Pay To Zero (include potential) <strong>${fmt(plan.payToZeroTotal)}</strong></span>
      <span>Potential Add-on <strong>${fmt(plan.potentialAddOn)}</strong></span>
      <span>Selected Payout <strong style="color:${selectedTotal < -0.005 ? 'var(--red)' : 'var(--green)'}">${fmt(selectedTotal)}</strong></span>`;
  }
  const rowsEl = document.getElementById('po_rows');
  const hintEl = document.getElementById('po_hint');
  if (hintEl) {
    hintEl.textContent = includePotential
      ? 'Pay To Zero includes negative rows so payouts fully reconcile overpaid vs future balances.'
      : 'Pay Now ignores negative rows so prepaid jobs do not reduce what is paid today.';
  }
  const applyBtn = document.getElementById('po_applyBtn');
  if (applyBtn) {
    applyBtn.textContent = includePotential ? 'Use Pay To Zero in Split Pay' : 'Use Pay Now in Split Pay';
    applyBtn.disabled = selectedTotal <= 0.005;
  }
  if (rowsEl) {
    const shown = plan.rows.filter(r => includePotential ? Math.abs(r.payToZeroTarget) > 0.005 : r.payNowTarget > 0.005);
    rowsEl.innerHTML = shown.length
      ? shown.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="min-width:0">
              <div style="font-size:15px">${esc(r.label)}</div>
              <div style="font-family:var(--mono);font-size:12px;color:var(--text3)">
                owed ${fmt(r.owedNow)}${includePotential ? ` | potential ${fmt(r.potential)}` : ''}
              </div>
            </div>
            <div style="font-family:var(--mono);font-size:14px;color:${(includePotential ? r.payToZeroTarget : r.payNowTarget) < -0.005 ? 'var(--red)' : 'var(--green)'};white-space:nowrap">${fmt(includePotential ? r.payToZeroTarget : r.payNowTarget)}</div>
          </div>`).join('')
      : '<div style="color:var(--text3);font-size:15px;padding:12px 0">No payable rows for this payout mode.</div>';
  }
}
function applyPayOutToSplitPay() {
  const includePotential = payOutCtx.mode === 'pay_to_zero';
  const plan = _calcPayOutPlan(payOutCtx.employeeId);
  const targetTotal = includePotential ? plan.payToZeroTotal : plan.payNowTotal;
  if (targetTotal <= 0.005) {
    showAlert('Nothing to pay out for this selection.');
    return;
  }
  const emp = getEmp(payOutCtx.employeeId);
  const allocById = {};
  plan.rows.forEach(r => {
    if (includePotential) {
      if (Math.abs(r.payToZeroTarget) > 0.005) allocById[r.id] = r.payToZeroTarget;
      return;
    }
    if (r.payNowTarget > 0.005) allocById[r.id] = r.payNowTarget;
  });
  openSplitPay({
    trackAdvances: includePotential,
    total: targetTotal,
    date: document.getElementById('po_date')?.value || today(),
    label: `Pay Out${emp?.name ? ` - ${emp.name}` : ''}${includePotential ? ' (pay to zero)' : ' (pay now)'}`,
    allocById
  });
  closeModal('payOutModal');
}
function openSplitPay(preset = null) {
  document.getElementById('sp_total').value = '';
  document.getElementById('sp_date').value  = today();
  document.getElementById('sp_label').value = '';
  const track = document.getElementById('sp_toggleTrack');
  if (track) track.dataset.on = 'false';
  if (preset?.trackAdvances && track) track.dataset.on = 'true';
  renderSplitPayAlloc();
  if (preset) {
    if (preset.total !== undefined) document.getElementById('sp_total').value = Number(preset.total || 0).toFixed(2);
    if (preset.date) document.getElementById('sp_date').value = preset.date;
    if (preset.label !== undefined) document.getElementById('sp_label').value = preset.label || '';
    const allocById = preset.allocById || {};
    document.querySelectorAll('.sp-alloc-input').forEach(el => {
      const amt = Number(allocById[el.id] || 0);
      el.value = Math.abs(amt) > 0.005 ? amt.toFixed(2) : '';
      const typeEl = document.getElementById(el.id + '_type');
      if (typeEl) {
        if (preset.trackAdvances && amt < -0.005) typeEl.value = 'adjustment';
        else if (preset.trackAdvances && amt > 0.005) typeEl.value = 'advance';
        else typeEl.value = '';
      }
    });
    updateSplitTotals();
  }
  document.getElementById('splitPayModal').classList.remove('hidden');
}
function toggleSplitAdvances() {
  const track = document.getElementById('sp_toggleTrack');
  track.dataset.on = track.dataset.on === 'true' ? 'false' : 'true';
  renderSplitPayAlloc();
}
function renderSplitPayAlloc() {
  const activeJobs = state.jobs.filter(j => j.status !== 'complete');
  const activeHW   = (state.homewatch || []).filter(hw => hw.status !== 'paused');
  const allocEl    = document.getElementById('sp_allocList');
  const track = document.getElementById('sp_toggleTrack');
  const thumb = document.getElementById('sp_toggleThumb');
  const allowAdvances = track?.dataset.on === 'true';
  if (track) track.style.background = allowAdvances ? 'var(--accent)' : 'var(--border2)';
  if (thumb) thumb.style.transform = allowAdvances ? 'translateX(18px)' : 'translateX(0)';
  const row = (id, name, bal, potentialBal) => {
    const owedColor = bal > 0.005 ? 'var(--accent)' : bal < -0.005 ? 'var(--red)' : 'var(--text3)';
    const advance = potentialBal - bal;
    const advanceStr = allowAdvances && advance > 0.005
      ? ` &nbsp;<span style="color:var(--text3)">+${fmt(advance)} potential</span>` : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:17px;font-weight:500">${name}</div>
        <div style="font-family:var(--mono);font-size:13px;color:${owedColor}">owed: ${fmt(bal)}${advanceStr}</div>
      </div>
      <select class="form-input sp-type-select" id="${id}_type" style="display:none;width:100px;font-size:12px;padding:4px 6px;flex-shrink:0">
        <option value="">General</option>
        <option value="advance">Advance</option>
        <option value="final">Final Pay</option>
        <option value="adjustment">Adjustment</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="${id}_maxBtn" data-step="0" onclick="maxAlloc('${id}',${bal},${potentialBal},${allowAdvances})" style="flex-shrink:0">Max</button>
      <input class="form-input sp-alloc-input" type="number" step="0.01" placeholder="0.00"
        id="${id}" style="max-width:100px" oninput="updateSplitTotals()" />
    </div>`;
  };
  let html = '';
  if (activeJobs.length) {
    if (activeHW.length) html += `<div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);padding:4px 0 6px">Jobs</div>`;
    html += activeJobs.map(j => { const c = calcJob(j); return row(`sp_job_${j.id}`, esc(j.name), c.empBalance, c.potentialEmpBalance); }).join('');
  }
  if (activeHW.length) {
    html += `<div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);padding:${activeJobs.length?'12px':'4px'} 0 6px">HomeWatch</div>`;
    html += activeHW.map(hw => { const c = calcHW(hw); return row(`sp_hw_${hw.id}`, esc(hw.name), c.empBalance, c.potentialEmpBalance); }).join('');
  }
  allocEl.innerHTML = html || '<div style="color:var(--text3);font-size:16px;padding:8px 0">No active jobs or HomeWatch clients.</div>';
  updateSplitTotals();
}
function maxAlloc(inputId, bal, potentialBal, allowAdvances) {
  const btn = document.getElementById(inputId + '_maxBtn');
  const step = parseInt(btn?.dataset.step || '0');
  const total = parseFloat(document.getElementById('sp_total').value) || 0;
  let otherAllocated = 0;
  document.querySelectorAll('.sp-alloc-input').forEach(el => {
    if (el.id !== inputId) otherAllocated += parseFloat(el.value) || 0;
  });
  const cap = total > 0 ? total - otherAllocated : Infinity;
  const capTarget = (target) => {
    if (!isFinite(cap)) return target;
    if (target > cap) return cap;
    return target;
  };
  let target;
  if (!allowAdvances || Math.abs(potentialBal - bal) <= 0.005) {
    target = capTarget(bal);
    if (btn) btn.dataset.step = '0';
  } else if (step === 0) {
    target = capTarget(bal);
    if (btn) btn.dataset.step = '1';
  } else {
    target = capTarget(potentialBal);
    if (btn) btn.dataset.step = '0';
  }
  document.getElementById(inputId).value = Math.abs(target) > 0.005 ? target.toFixed(2) : '';
  updateSplitTotals();
}
function updateSplitTotals() {
  const total = parseFloat(document.getElementById('sp_total').value) || 0;
  let allocated = 0;
  document.querySelectorAll('.sp-alloc-input').forEach(el => {
    const amt = parseFloat(el.value) || 0;
    allocated += amt;
    const typeEl = document.getElementById(el.id + '_type');
    if (typeEl) typeEl.style.display = Math.abs(amt) > 0.005 ? '' : 'none';
  });
  const remaining = total - allocated;
  const remColor  = Math.abs(remaining) < 0.01 ? 'var(--green)' : remaining < 0 ? 'var(--red)' : 'var(--accent)';
  const el = document.getElementById('sp_totals');
  if (el) el.innerHTML = `
    <span>Total <strong>${fmt(total)}</strong></span>
    <span>Allocated <strong style="color:var(--green)">${fmt(allocated)}</strong></span>
    <span>Remaining <strong style="color:${remColor}">${fmt(remaining)}</strong></span>`;
}
async function saveSplitPay() {
  const total   = parseFloat(document.getElementById('sp_total').value) || 0;
  if (total <= 0) { showAlert('Please enter a total amount.'); return; }
  const date    = document.getElementById('sp_date').value;
  const label   = document.getElementById('sp_label').value.trim();
  let allocated = 0;
  const jobEntries = [], hwEntries = [];
  document.querySelectorAll('.sp-alloc-input').forEach(el => {
    const amt = parseFloat(el.value) || 0;
    if (Math.abs(amt) <= 0.005) return;
    allocated += amt;
    const selectedType = (document.getElementById(el.id + '_type') || {}).value || '';
    const payType = selectedType || (amt < -0.005 ? 'adjustment' : '');
    if (el.id.startsWith('sp_job_')) jobEntries.push({ jobId: el.id.slice('sp_job_'.length), amount: amt, payType });
    if (el.id.startsWith('sp_hw_'))  hwEntries.push({  hwId:  el.id.slice('sp_hw_'.length),  amount: amt, payType });
  });
  if (!jobEntries.length && !hwEntries.length) { showAlert('Please allocate at least one amount.'); return; }
  const remaining = total - allocated;
  const doSave = async () => {
    const splitEventId = uid();
    const trackAdvances = (document.getElementById('sp_toggleTrack')?.dataset.on === 'true');
    const eventLabel = label || 'Split payment';
    const allocations = [];
    const employeeIds = new Set();
    jobEntries.forEach(({ jobId, amount, payType }) => {
      const job = state.jobs.find(j => j.id === jobId);
      if (job) {
        if (!job.advances) job.advances = [];
        job.advances.push({ id: uid(), label: eventLabel, amount, date, payType, splitEventId });
        allocations.push({ sourceKind: 'job', sourceId: job.id, sourceName: job.name || 'Job', amount, payType: payType || '' });
        if (job.employeeId) employeeIds.add(job.employeeId);
      }
    });
    hwEntries.forEach(({ hwId, amount, payType }) => {
      const hw = (state.homewatch || []).find(h => h.id === hwId);
      if (hw) {
        if (!hw.advances) hw.advances = [];
        hw.advances.push({ id: uid(), label: eventLabel, amount, date, payType, splitEventId });
        allocations.push({ sourceKind: 'hw', sourceId: hw.id, sourceName: hw.name || 'HomeWatch', amount, payType: payType || '' });
        if (hw.employeeId) employeeIds.add(hw.employeeId);
      }
    });
    if (!state.splitPayments) state.splitPayments = [];
    state.splitPayments.push({
      id: splitEventId,
      date: date || today(),
      label: eventLabel,
      total,
      mode: trackAdvances ? 'potential' : 'split',
      employeeId: employeeIds.size === 1 ? [...employeeIds][0] : '',
      allocations,
      createdAt: new Date().toISOString()
    });
    await save(); renderAll(); closeModal('splitPayModal');
  };
  if (Math.abs(remaining) > 0.01) {
    showConfirm(`${fmt(Math.abs(remaining))} is ${remaining > 0 ? 'unallocated' : 'over-allocated'}. Save anyway?`, doSave);
  } else {
    doSave();
  }
}

// ─── PARTIAL COLLECTION (JOBS) ───────────────────────────────────────────────
function _roundMoney(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  const v = Math.sign(x) * Math.round((Math.abs(x) + Number.EPSILON) * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}
function _roundPct(n) { return Math.round((Number(n) + Number.EPSILON) * 1000000) / 1000000; }
function _clearSquareFields(item) {
  if (!item || typeof item !== 'object') return;
  item.squareInvoiceId = '';
  item.squareOrderId = '';
  item.squarePaymentIds = [];
  item.billingState = 'none';
  item.reconcileStatus = 'none';
  item.lastSquareEventAt = '';
  item.partialPaidAmountCents = 0;
}
function _setPartialAutoSubUI() {
  const track = document.getElementById('pc_autoTrack');
  const thumb = document.getElementById('pc_autoThumb');
  const on = partialCollectCtx?.autoSub !== false;
  if (track) {
    track.dataset.on = on ? 'true' : 'false';
    track.style.background = on ? 'var(--accent)' : 'var(--border2)';
  }
  if (thumb) thumb.style.transform = on ? 'translateX(18px)' : 'translateX(0)';
}
function _buildPartialCollectCtx(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return null;
  const isHourly = _jobType(job) === 'hourly';
  const rows = [];
  if (isHourly) {
    (job.revenueItems || []).forEach((r, idx) => {
      if ((r.status || 'pending') === 'collected') return;
      const gross = _roundMoney(r.amount || 0);
      if (gross <= 0) return;
      rows.push({
        key: `revenueItems:${idx}`,
        itemType: 'revenueItems',
        idx,
        label: r.label || `Revenue ${idx + 1}`,
        gross,
        assignedSub: 0,
        net: gross,
        alloc: 0,
        included: false
      });
    });
  } else {
    (job.milestones || []).forEach((m, idx) => {
      if ((m.status || 'pending') === 'collected') return;
      const gross = _roundMoney(((m.pct || 0) / 100) * (job.quote || 0));
      if (gross <= 0) return;
      rows.push({
        key: `milestones:${idx}`,
        itemType: 'milestones',
        idx,
        label: m.label || `Milestone ${idx + 1}`,
        gross,
        assignedSub: 0,
        net: gross,
        alloc: 0,
        included: false
      });
    });
  }
  (job.addOns || []).forEach((a, idx) => {
    if ((a.status || 'pending') === 'collected') return;
    const gross = _roundMoney(a.amount || 0);
    if (gross <= 0) return;
    rows.push({
      key: `addOns:${idx}`,
      itemType: 'addOns',
      idx,
      label: a.label || `Addition ${idx + 1}`,
      gross,
      assignedSub: 0,
      net: gross,
      alloc: 0,
      included: false
    });
  });
  const subtractions = [];
  (job.subtractions || []).forEach((s, idx) => {
    if ((s.status || 'pending') === 'collected') return;
    const amt = _roundMoney(s.amount || 0);
    if (amt <= 0) return;
    subtractions.push({ idx, amount: amt });
  });
  const totalGross = _roundMoney(rows.reduce((sum, r) => sum + r.gross, 0));
  const totalSub = _roundMoney(subtractions.reduce((sum, s) => sum + s.amount, 0));
  return { jobId, rows, subtractions, totalGross, totalSub, totalNet: totalGross, unassignedSub: 0, autoSub: true, isHourly };
}
function _hydratePartialRows(ctx) {
  if (!ctx) return null;
  const rows = (ctx.rows || []).map(r => ({
    ...r,
    gross: _roundMoney(r.gross || 0),
    alloc: _roundMoney(Math.max(0, Number(r.alloc || 0))),
    included: !!r.included,
    assignedSub: 0,
    net: _roundMoney(r.gross || 0)
  }));
  let remSub = ctx.autoSub ? _roundMoney(ctx.totalSub || 0) : 0;
  rows.forEach(r => {
    if ((r.itemType !== 'milestones' && r.itemType !== 'revenueItems') || remSub <= 0) return;
    const assign = _roundMoney(Math.min(remSub, r.gross));
    r.assignedSub = assign;
    r.net = _roundMoney(r.gross - assign);
    remSub = _roundMoney(remSub - assign);
  });
  rows.forEach(r => {
    if (r.itemType !== 'milestones' && r.itemType !== 'revenueItems') r.net = r.gross;
    if (r.alloc > r.net) r.alloc = r.net;
  });
  const totalNet = _roundMoney(rows.reduce((sum, r) => sum + r.net, 0));
  return { ...ctx, rows, totalNet, unassignedSub: remSub };
}
function _applyPartialPreset(ctx, preset) {
  if (!ctx || !preset) return ctx;
  const byKey = preset.presetByKey || {};
  const rows = (ctx.rows || []).map(r => {
    const p = byKey[r.key] || {};
    return { ...r, included: !!p.included, alloc: _roundMoney(Math.max(0, Number(p.alloc || 0))) };
  });
  return { ...ctx, rows, autoSub: preset.autoSub !== false };
}
function openPartialCollect(jobId, preset = null) {
  if (!currentUser?.isAdmin) return;
  const ctx = _buildPartialCollectCtx(jobId);
  if (!ctx) {
    return;
  }
  partialCollectCtx = _hydratePartialRows(_applyPartialPreset(ctx, preset));
  document.getElementById('pc_mode').value = preset?.mode || 'dollar';
  document.getElementById('pc_total').value = preset?.mode === 'dollar' ? (preset?.paymentTotal || '') : '';
  document.getElementById('pc_percent').value = preset?.mode === 'percent' ? (preset?.partialPercent || '') : '';
  document.getElementById('pc_date').value = preset?.date || today();
  document.getElementById('pc_note').value = preset?.note || '';
  const modalTitle = document.getElementById('pc_modalTitle');
  if (modalTitle) modalTitle.textContent = partialCollectCtx.isHourly ? 'Log Revenue Payment' : 'Log Revenue Collection';
  const listLabel = document.getElementById('pc_listLabel');
  if (listLabel) listLabel.textContent = partialCollectCtx.isHourly ? 'Pending Revenue Entries + Additions' : 'Pending Milestones + Additions';
  const autoSubLabel = document.getElementById('pc_autoSubLabel');
  if (autoSubLabel) autoSubLabel.textContent = partialCollectCtx.isHourly
    ? 'Apply pending subtractions across remaining revenue entries'
    : 'Apply pending subtractions across remaining milestones';
  _setPartialAutoSubUI();
  renderPartialCollectRows();
  document.getElementById('partialCollectModal').classList.remove('hidden');
}
function _renderIncludeToggle(rowIdx) {
  const track = document.getElementById(`pc_inc_track_${rowIdx}`);
  const thumb = document.getElementById(`pc_inc_thumb_${rowIdx}`);
  const txt = document.getElementById(`pc_inc_txt_${rowIdx}`);
  const row = partialCollectCtx?.rows?.[rowIdx];
  if (!track || !thumb || !txt || !row) return;
  const on = !!row.included;
  track.style.background = on ? 'var(--accent)' : 'var(--border2)';
  thumb.style.transform = on ? 'translateX(18px)' : 'translateX(0)';
  txt.textContent = on ? 'Included' : 'Excluded';
}
function renderPartialCollectRows() {
  if (!partialCollectCtx) return;
  partialCollectCtx = _hydratePartialRows(partialCollectCtx);
  _setPartialAutoSubUI();
  const mode = document.getElementById('pc_mode')?.value || 'dollar';
  const listEl = document.getElementById('pc_list');
  const infoEl = document.getElementById('pc_subInfo');
  if (infoEl) {
    const baseLabel = partialCollectCtx.isHourly ? 'Pending revenue/additions' : 'Pending milestones/additions';
    infoEl.innerHTML = `
      <span>${baseLabel}: <strong>${fmt(partialCollectCtx.totalGross)}</strong></span>
      <span>Pending subtractions: <strong style="color:var(--red)">-${fmt(partialCollectCtx.totalSub)}</strong></span>
      <span>Net due base: <strong style="color:var(--accent)">${fmt(partialCollectCtx.totalNet)}</strong></span>
      ${partialCollectCtx.autoSub && partialCollectCtx.unassignedSub > 0.01 ? `<span style="color:var(--red)">Unassigned subtraction overflow: ${fmt(partialCollectCtx.unassignedSub)}</span>` : ''}`;
  }
  const rowsHtml = partialCollectCtx.rows.map((r, i) => {
    const typeLabel = r.itemType === 'milestones' ? 'Milestone' : r.itemType === 'revenueItems' ? 'Revenue' : 'Addition';
    const milestoneSub = (r.itemType === 'milestones' || r.itemType === 'revenueItems') && partialCollectCtx.autoSub && r.assignedSub > 0
      ? ` - after ${fmt(r.assignedSub)} subtractions`
      : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:16px;font-weight:500">${esc(r.label)}</div>
        <div style="font-family:var(--mono);font-size:12px">${typeLabel} - due ${fmt(r.net)}${milestoneSub}</div>
      </div>
      <div class="pc-dollar-controls" style="display:${mode==='dollar'?'flex':'none'};align-items:center;gap:8px;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="partialCollectMax(${i})">Max</button>
        <input class="form-input pc-alloc-input" id="pc_alloc_${i}" type="number" step="0.01" placeholder="0.00" value="${r.alloc > 0 ? r.alloc.toFixed(2) : ''}" style="max-width:110px" oninput="setPartialAlloc(${i}, this.value)" />
      </div>
      <div class="pc-percent-controls" style="display:${mode==='percent'?'flex':'none'};align-items:center;gap:8px;flex-shrink:0">
        <div style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none" onclick="togglePartialInclude(${i})">
          <span id="pc_inc_txt_${i}" style="display:inline-block;min-width:70px;text-align:right;font-family:var(--mono);font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em">${r.included ? 'Included' : 'Excluded'}</span>
          <span id="pc_inc_track_${i}" style="display:inline-flex;align-items:center;width:40px;height:22px;border-radius:11px;background:${r.included ? 'var(--accent)' : 'var(--border2)'};transition:background 0.2s;cursor:pointer;flex-shrink:0;padding:2px;box-sizing:border-box">
            <span id="pc_inc_thumb_${i}" style="width:18px;height:18px;border-radius:50%;background:#fff;transition:transform 0.2s;display:block;transform:${r.included ? 'translateX(18px)' : 'translateX(0)'}"></span>
          </span>
        </div>
      </div>
    </div>`;
  }).join('');
  listEl.innerHTML = rowsHtml || '<div style="color:var(--text3);font-size:16px;padding:8px 0">No pending items.</div>';
  updatePartialCollectTotals();
}
function setPartialAlloc(rowIdx, value) {
  if (!partialCollectCtx?.rows?.[rowIdx]) return;
  const v = _roundMoney(Math.max(0, parseFloat(value) || 0));
  partialCollectCtx.rows[rowIdx].alloc = v;
  updatePartialCollectTotals();
}
function togglePartialInclude(rowIdx) {
  if (!partialCollectCtx?.rows?.[rowIdx]) return;
  partialCollectCtx.rows[rowIdx].included = !partialCollectCtx.rows[rowIdx].included;
  _renderIncludeToggle(rowIdx);
  updatePartialCollectTotals();
}
function onPartialModeChange() {
  renderPartialCollectRows();
}
function togglePartialAutoSubtractions() {
  if (!partialCollectCtx) return;
  partialCollectCtx.autoSub = !partialCollectCtx.autoSub;
  renderPartialCollectRows();
}
function partialCollectMax(rowIdx) {
  if (!partialCollectCtx?.rows?.[rowIdx]) return;
  partialCollectCtx = _hydratePartialRows(partialCollectCtx);
  const total = parseFloat(document.getElementById('pc_total')?.value) || 0;
  const row = partialCollectCtx.rows[rowIdx];
  let other = 0;
  partialCollectCtx.rows.forEach((r, i) => { if (i !== rowIdx) other += Number(r.alloc || 0); });
  const cap = Math.max(0, _roundMoney(total - other));
  const target = Math.max(0, Math.min(row.net, cap));
  row.alloc = _roundMoney(target);
  const el = document.getElementById(`pc_alloc_${rowIdx}`);
  if (el) el.value = row.alloc > 0 ? row.alloc.toFixed(2) : '';
  updatePartialCollectTotals();
}
function _getPartialCollectPlan() {
  if (!partialCollectCtx) return null;
  partialCollectCtx = _hydratePartialRows(partialCollectCtx);
  const mode = document.getElementById('pc_mode')?.value || 'dollar';
  const allocs = [];
  let paymentTotal = 0;
  let allocatedNet = 0;
  let selectedNetBase = 0;
  if (mode === 'dollar') {
    paymentTotal = _roundMoney(parseFloat(document.getElementById('pc_total')?.value) || 0);
    partialCollectCtx.rows.forEach((r, i) => {
      const net = _roundMoney(Math.max(0, Math.min(r.net, Number(r.alloc || 0))));
      if (net <= 0) return;
      const baseSub = partialCollectCtx.autoSub && (r.itemType === 'milestones' || r.itemType === 'revenueItems') ? _roundMoney(r.assignedSub || 0) : 0;
      const gross = _roundMoney(Math.min(r.gross, net + baseSub));
      const subCollect = _roundMoney(Math.max(0, gross - net));
      allocs.push({ rowIdx: i, net, gross, subCollect });
      allocatedNet += net;
    });
  } else {
    const pct = Math.max(0, Math.min(100, parseFloat(document.getElementById('pc_percent')?.value) || 0));
    partialCollectCtx.rows.forEach((r, i) => {
      if (!r.included) return;
      selectedNetBase += r.net;
      const ratio = pct / 100;
      const net = _roundMoney(r.net * ratio);
      const baseSub = partialCollectCtx.autoSub && (r.itemType === 'milestones' || r.itemType === 'revenueItems') ? _roundMoney(r.assignedSub || 0) : 0;
      const gross = _roundMoney(Math.min(r.gross, net + baseSub));
      if (net <= 0 && gross <= 0) return;
      const subCollect = _roundMoney(Math.max(0, gross - net));
      allocs.push({ rowIdx: i, net, gross, subCollect });
      allocatedNet += net;
    });
    paymentTotal = _roundMoney(selectedNetBase * (pct / 100));
  }
  const grossTotal = _roundMoney(allocs.reduce((sum, a) => sum + a.gross, 0));
  const subCollectedTotal = partialCollectCtx?.autoSub
    ? _roundMoney(Math.min(
        partialCollectCtx.totalSub || 0,
        allocs.reduce((sum, a) => sum + (a.subCollect || 0), 0)
      ))
    : 0;
  return {
    mode,
    paymentTotal,
    allocatedNet: _roundMoney(allocatedNet),
    remaining: _roundMoney(paymentTotal - allocatedNet),
    selectedNetBase: _roundMoney(selectedNetBase),
    allocs,
    grossTotal,
    subCollectedTotal
  };
}
function updatePartialCollectTotals() {
  const plan = _getPartialCollectPlan();
  const mode = document.getElementById('pc_mode')?.value || 'dollar';
  const totalsEl = document.getElementById('pc_totals');
  const dollarWrap = document.getElementById('pc_dollar_wrap');
  const percentWrap = document.getElementById('pc_percent_wrap');
  if (dollarWrap) dollarWrap.style.display = mode === 'dollar' ? '' : 'none';
  if (percentWrap) percentWrap.style.display = mode === 'percent' ? '' : 'none';
  document.querySelectorAll('.pc-dollar-controls').forEach(el => { el.style.display = mode === 'dollar' ? 'flex' : 'none'; });
  document.querySelectorAll('.pc-percent-controls').forEach(el => { el.style.display = mode === 'percent' ? 'flex' : 'none'; });
  if (!totalsEl || !plan) return;
  if (mode === 'dollar') {
    const remColor = Math.abs(plan.remaining) < 0.01 ? 'var(--green)' : plan.remaining < 0 ? 'var(--red)' : 'var(--accent)';
    totalsEl.innerHTML = `
      <span>Payment <strong>${fmt(plan.paymentTotal)}</strong></span>
      <span>Allocated <strong style="color:var(--green)">${fmt(plan.allocatedNet)}</strong></span>
      <span>Remaining <strong style="color:${remColor}">${fmt(plan.remaining)}</strong></span>
      ${partialCollectCtx?.autoSub ? `<span>Subtractions consumed in this payment <strong style="color:var(--red)">-${fmt(plan.subCollectedTotal)}</strong></span>` : ''}`;
  } else {
    const pct = Math.max(0, Math.min(100, parseFloat(document.getElementById('pc_percent')?.value) || 0));
    totalsEl.innerHTML = `
      <span>Selected Net Base <strong>${fmt(plan.selectedNetBase)}</strong></span>
      <span>Collect % <strong>${pct.toFixed(2)}%</strong></span>
      <span>Total Payment Amount <strong style="color:var(--green)">${fmt(plan.paymentTotal)}</strong></span>
      ${partialCollectCtx?.autoSub ? `<span>Subtractions consumed in this payment <strong style="color:var(--red)">-${fmt(plan.subCollectedTotal)}</strong></span>` : ''}`;
  }
}
function _distributeSubtractionCollection(subRows, targetAmount) {
  const out = [];
  let rem = _roundMoney(targetAmount);
  for (let i = 0; i < subRows.length && rem > 0.0001; i++) {
    const avail = _roundMoney(subRows[i].amount || 0);
    if (avail <= 0) continue;
    const take = _roundMoney(Math.min(avail, rem));
    if (take > 0) out.push({ idx: subRows[i].idx, amount: take });
    rem = _roundMoney(rem - take);
  }
  return out;
}
function _applyPartialToAmountList(list, idx, collectAmt, meta = {}) {
  const item = list?.[idx];
  if (!item) return;
  const total = _roundMoney(item.amount || 0);
  const take = _roundMoney(Math.max(0, Math.min(total, collectAmt)));
  if (take <= 0) return;
  if (take >= total - 0.0001) {
    item.status = 'collected';
    item.partialState = '';
    if (meta.appliedByPartial) item.appliedByPartial = true;
    if (meta.partialMode) {
      item.partialMode = meta.partialMode;
      item.partialPercent = meta.partialPercent || 0;
      item.partialDate = meta.partialDate || item.partialDate || '';
    }
    return;
  }
  const baseGroup = item.partialGroupId || item.id || uid();
  const parentAmount = item.partialParentAmount ?? total;
  const parentLabel = item.partialParentLabel || item.label || '';
  const remainingAmt = _roundMoney(total - take);
  const remaining = {
    ...item,
    amount: remainingAmt,
    status: 'pending',
    partialState: 'remaining',
    partialGroupId: baseGroup,
    partialParentAmount: parentAmount,
    partialParentLabel: parentLabel,
    partialMode: meta.partialMode || item.partialMode || '',
    partialPercent: meta.partialPercent || item.partialPercent || 0,
    partialDate: meta.partialDate || item.partialDate || '',
    appliedByPartial: !!meta.appliedByPartial
  };
  const collected = {
    ...item,
    id: uid(),
    amount: take,
    status: 'collected',
    partialState: 'paid',
    partialGroupId: baseGroup,
    partialParentAmount: parentAmount,
    partialParentLabel: parentLabel,
    partialMode: meta.partialMode || item.partialMode || '',
    partialPercent: meta.partialPercent || item.partialPercent || 0,
    partialDate: meta.partialDate || item.partialDate || '',
    appliedByPartial: !!meta.appliedByPartial
  };
  _clearSquareFields(remaining);
  _clearSquareFields(collected);
  list.splice(idx, 1, collected, remaining);
}
function _applyPartialToMilestones(job, idx, collectAmt, meta = {}) {
  const list = job?.milestones || [];
  const item = list[idx];
  if (!item) return;
  const quote = Number(job.quote || 0);
  if (quote <= 0) return;
  const total = _roundMoney(((item.pct || 0) / 100) * quote);
  const take = _roundMoney(Math.max(0, Math.min(total, collectAmt)));
  if (take <= 0) return;
  if (take >= total - 0.0001) {
    item.status = 'collected';
    item.partialState = '';
    if (!item.id) item.id = uid();
    if (meta.partialMode) {
      item.partialMode = meta.partialMode;
      item.partialPercent = meta.partialPercent || 0;
      item.partialDate = meta.partialDate || item.partialDate || '';
    }
    return;
  }
  const takePct = _roundPct((take / quote) * 100);
  const remPct = _roundPct((item.pct || 0) - takePct);
  if (takePct <= 0 || remPct <= 0) {
    item.status = 'collected';
    item.partialState = '';
    if (!item.id) item.id = uid();
    return;
  }
  const baseId = item.partialGroupId || item.id || uid();
  const parentLabel = item.partialParentLabel || item.label || '';
  const parentPct = item.partialParentPct ?? (item.pct || 0);
  const remaining = {
    ...item,
    id: item.id || uid(),
    pct: remPct,
    status: 'pending',
    partialState: 'remaining',
    partialGroupId: baseId,
    partialParentLabel: parentLabel,
    partialParentPct: parentPct,
    partialMode: meta.partialMode || item.partialMode || '',
    partialPercent: meta.partialPercent || item.partialPercent || 0,
    partialDate: meta.partialDate || item.partialDate || ''
  };
  const collected = {
    ...item,
    id: uid(),
    pct: takePct,
    status: 'collected',
    partialState: 'paid',
    partialGroupId: baseId,
    partialParentLabel: parentLabel,
    partialParentPct: parentPct,
    partialMode: meta.partialMode || item.partialMode || '',
    partialPercent: meta.partialPercent || item.partialPercent || 0,
    partialDate: meta.partialDate || item.partialDate || ''
  };
  _clearSquareFields(remaining);
  _clearSquareFields(collected);
  list.splice(idx, 1, collected, remaining);
}
function savePartialCollect() {
  if (!partialCollectCtx) return;
  const plan = _getPartialCollectPlan();
  if (!plan) return;
  const mode = plan.mode;
  if (mode === 'dollar' && plan.paymentTotal <= 0) { showAlert('Please enter a payment amount.'); return; }
  if (mode === 'percent') {
    const pct = Math.max(0, Math.min(100, parseFloat(document.getElementById('pc_percent')?.value) || 0));
    if (pct <= 0) { showAlert('Please enter a percentage greater than 0.'); return; }
  }
  const job = state.jobs.find(j => j.id === partialCollectCtx.jobId);
  if (!job) return;
  const date = document.getElementById('pc_date')?.value || today();
  const note = (document.getElementById('pc_note')?.value || '').trim();
  const partialPercent = mode === 'percent'
    ? Math.max(0, Math.min(100, parseFloat(document.getElementById('pc_percent')?.value) || 0))
    : 0;
  const persist = () => {
    if (!plan.allocs.length && partialCollectCtx.isHourly && mode === 'dollar' && plan.paymentTotal > 0) {
      if (!job.revenueItems) job.revenueItems = [];
      job.revenueItems.push({
        id: uid(),
        label: note || 'Collected payment',
        amount: _roundMoney(plan.paymentTotal),
        date,
        status: 'collected'
      });
      if (!job.jobNotes) job.jobNotes = [];
      const summary = note || `Revenue payment logged: ${fmt(plan.paymentTotal)} on ${date}.`;
      job.jobNotes.push({ id: uid(), text: summary, date, authorId: currentUser?.id || '', authorName: currentUser?.name || 'Admin' });
      save(); renderJobs(); closeModal('partialCollectModal');
      partialCollectCtx = null;
      return;
    }
    if (!plan.allocs.length) {
      showAlert('Please allocate/include at least one line item.');
      return;
    }
    const before = {
      milestones: JSON.parse(JSON.stringify(job.milestones || [])),
      revenueItems: JSON.parse(JSON.stringify(job.revenueItems || [])),
      addOns: JSON.parse(JSON.stringify(job.addOns || [])),
      subtractions: JSON.parse(JSON.stringify(job.subtractions || []))
    };
    const byType = { milestones: [], revenueItems: [], addOns: [] };
    plan.allocs.forEach(a => {
      const row = partialCollectCtx.rows[a.rowIdx];
      if (!row) return;
      byType[row.itemType].push({ idx: row.idx, gross: a.gross });
    });
    byType.milestones.sort((a,b) => b.idx - a.idx).forEach(a =>
      _applyPartialToMilestones(job, a.idx, a.gross, { partialMode: mode, partialPercent, partialDate: date })
    );
    byType.revenueItems.sort((a,b) => b.idx - a.idx).forEach(a =>
      _applyPartialToAmountList(job.revenueItems, a.idx, a.gross, { partialMode: mode, partialPercent, partialDate: date })
    );
    byType.addOns.sort((a,b) => b.idx - a.idx).forEach(a =>
      _applyPartialToAmountList(job.addOns, a.idx, a.gross, { partialMode: mode, partialPercent, partialDate: date })
    );
    if (partialCollectCtx.autoSub && plan.subCollectedTotal > 0.0001) {
      const subAlloc = _distributeSubtractionCollection(partialCollectCtx.subtractions, plan.subCollectedTotal);
      subAlloc.sort((a,b) => b.idx - a.idx).forEach(a =>
        _applyPartialToAmountList(job.subtractions, a.idx, a.amount, { appliedByPartial: true })
      );
    }
    if (!job.partialCollections) job.partialCollections = [];
    const presetByKey = {};
    partialCollectCtx.rows.forEach(r => {
      presetByKey[r.key] = { included: !!r.included, alloc: Number(r.alloc || 0) };
    });
    job.partialCollections.push({
      id: uid(),
      date,
      note,
      mode,
      partialPercent,
      paymentTotal: plan.paymentTotal,
      autoSub: !!partialCollectCtx.autoSub,
      presetByKey,
      snapshotBefore: before,
      createdAt: new Date().toISOString()
    });
    if (!job.jobNotes) job.jobNotes = [];
    const summary = note || `Revenue collection logged: ${fmt(plan.paymentTotal)} on ${date}.`;
    job.jobNotes.push({ id: uid(), text: summary, date, authorId: currentUser?.id || '', authorName: currentUser?.name || 'Admin' });
    save(); renderJobs(); closeModal('partialCollectModal');
    partialCollectCtx = null;
  };
  if (mode === 'dollar' && Math.abs(plan.remaining) > 0.01) {
    showConfirm(`${fmt(Math.abs(plan.remaining))} is ${plan.remaining > 0 ? 'unallocated' : 'over-allocated'}. Save anyway?`, persist);
    return;
  }
  persist();
}

function deletePartialCollection(jobId, partialId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  const arr = job.partialCollections || [];
  const idx = arr.findIndex(p => p.id === partialId);
  if (idx < 0) return;
  if (idx !== arr.length - 1) {
    showAlert('Only the most recent partial payment can be deleted (to protect later calculations).');
    return;
  }
  const entry = arr[idx];
  showConfirm('Delete this partial payment and restore the prior line items?', () => {
    const snap = entry.snapshotBefore || {};
    job.milestones = JSON.parse(JSON.stringify(snap.milestones || []));
    job.revenueItems = JSON.parse(JSON.stringify(snap.revenueItems || []));
    job.addOns = JSON.parse(JSON.stringify(snap.addOns || []));
    job.subtractions = JSON.parse(JSON.stringify(snap.subtractions || []));
    job.partialCollections = arr.filter(p => p.id !== partialId);
    save(); renderJobs();
  }, { title:'Delete Partial Payment', okLabel:'Delete', danger:true });
}

function editPartialCollection(jobId, partialId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  const arr = job.partialCollections || [];
  const idx = arr.findIndex(p => p.id === partialId);
  if (idx < 0) return;
  if (idx !== arr.length - 1) {
    showAlert('Only the most recent partial payment can be edited (to protect later calculations).');
    return;
  }
  const entry = arr[idx];
  const snap = entry.snapshotBefore || {};
  job.milestones = JSON.parse(JSON.stringify(snap.milestones || []));
  job.revenueItems = JSON.parse(JSON.stringify(snap.revenueItems || []));
  job.addOns = JSON.parse(JSON.stringify(snap.addOns || []));
  job.subtractions = JSON.parse(JSON.stringify(snap.subtractions || []));
  job.partialCollections = arr.filter(p => p.id !== partialId);
  save();
  openPartialCollect(jobId, {
    mode: entry.mode || 'dollar',
    partialPercent: Number(entry.partialPercent || 0),
    paymentTotal: Number(entry.paymentTotal || 0),
    date: entry.date || today(),
    note: entry.note || '',
    autoSub: entry.autoSub !== false,
    presetByKey: entry.presetByKey || {}
  });
}


function rebuildLegacyPartial(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  showConfirm('Rebuild legacy partial into a clean baseline so you can re-run partial collection?', () => {
    const collapseAmountList = (arr) => {
      const out = [];
      const byLabel = new Map();
      (arr || []).forEach(item => {
        if (!item?.partialState) { out.push({ ...item, appliedByPartial: false }); return; }
        const key = String(item.partialParentLabel || item.label || 'Item');
        if (!byLabel.has(key)) byLabel.set(key, { ...item, id: uid(), label: key, amount: 0, status: 'pending', partialState: '', appliedByPartial: false, partialGroupId: '', partialParentAmount: 0, partialParentLabel: '' });
        const g = byLabel.get(key);
        g.amount = _roundMoney((g.amount || 0) + (item.amount || 0));
      });
      byLabel.forEach(v => out.push(v));
      return out;
    };
    const collapseMilestones = () => {
      const out = [];
      const byLabel = new Map();
      (job.milestones || []).forEach(item => {
        if (!item?.partialState) { out.push({ ...item, partialGroupId: '', partialParentLabel: '', partialParentPct: 0, partialMode: '', partialPercent: 0 }); return; }
        const key = String(item.partialParentLabel || item.label || 'Milestone');
        if (!byLabel.has(key)) byLabel.set(key, { ...item, id: uid(), label: key, pct: 0, status: 'pending', partialState: '', partialGroupId: '', partialParentLabel: '', partialParentPct: 0, partialMode: '', partialPercent: 0 });
        const g = byLabel.get(key);
        g.pct = _roundPct((g.pct || 0) + (item.pct || 0));
      });
      byLabel.forEach(v => out.push(v));
      return out;
    };
    job.milestones = collapseMilestones();
    job.revenueItems = collapseAmountList(job.revenueItems || []);
    job.addOns = collapseAmountList(job.addOns || []);
    job.subtractions = collapseAmountList(job.subtractions || []).map(s => ({ ...s, status: 'pending' }));
    job.partialCollections = [];
    save(); renderJobs();
  }, { title:'Rebuild Legacy Partial', okLabel:'Rebuild', danger:true });
}
function toggleRepayment(id) {
  const j = state.jobs.find(j=>j.id===id);
  if (!j) return;
  j.repaymentMode = !j.repaymentMode;
  save(); renderJobs();
}
function toggleJob(id) {
  if (expandedJobs.has(id)) expandedJobs.delete(id);
  else {
    expandedJobs.clear();
    expandedJobs.add(id);
  }
  saveExpandedState();
  renderJobs();
}
function cycleStatus(jobId, itemType, idx) {
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job||!job[itemType]||!job[itemType][idx]) return;
  const item = job[itemType][idx];
  if (itemType === 'subtractions' && item.appliedByPartial) {
    showAlert('This subtraction was applied by a partial payment and is locked from manual status changes.');
    return;
  }
  if (item.status === 'collected') {
    const msg = itemType === 'subtractions'
      ? 'Mark this subtraction as Pending? This will remove it from applied adjustments.'
      : 'Mark this as Pending? This will remove it from collected revenue.';
    showConfirm(msg, () => {
      const cycle = { pending:'invoiced', invoiced:'collected', collected:'pending' };
      item.status = cycle[item.status||'pending'];
      save(); renderJobs();
    });
    return;
  }
  const cycle = { pending:'invoiced', invoiced:'collected', collected:'pending' };
  item.status = cycle[item.status||'pending'];
  save(); renderJobs();
}
function cycleHourlyStatus(jobId) {
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job || _jobType(job) !== 'hourly') return;
  const curr = job.hourlyStatus || 'pending';
  const cycle = { pending:'invoiced', invoiced:'collected', collected:'pending' };
  const doIt = () => {
    job.hourlyStatus = cycle[curr] || 'pending';
    if (job.hourlyStatus === 'pending') job.hourlySquareInvoiceId = '';
    save(); renderJobs();
  };
  if (curr === 'collected') {
    showConfirm('Mark this as Pending? This will remove it from collected revenue.', doIt);
    return;
  }
  doIt();
}
function toggleComplete(id) {
  const j = state.jobs.find(j=>j.id===id);
  if (j) { j.status = j.status==='complete'?'active':'complete'; save(); renderJobs(); }
}
function deleteJob(id) {
  showConfirm('Delete this job? This cannot be undone.', () => {
    state.jobs = state.jobs.filter(j=>j.id!==id); save(); renderJobs();
  });
}
function removeItem(jobId, key, idx) {
  const j = state.jobs.find(j=>j.id===jobId);
  if (!j || !j[key]) return;
  const item = j[key][idx];
  if (key === 'subtractions' && item?.appliedByPartial) {
    showAlert('This subtraction was applied by a partial payment and cannot be deleted.');
    return;
  }
  j[key].splice(idx,1); save(); renderJobs();
}

// ─── NOTES ────────────────────────────────────────────────────────────────────
function _notesEntity() {
  if (!notesCtx) return null;
  return notesCtx.type === 'hw'
    ? (state.homewatch||[]).find(h=>h.id===notesCtx.id)
    : state.jobs.find(j=>j.id===notesCtx.id);
}
function _notesKey() { return notesCtx?.type === 'hw' ? 'hwNotes' : 'jobNotes'; }
function _notesRender() { if (notesCtx?.type === 'hw') renderHomewatch(); else renderJobs(); }

function openNotes(type, id) {
  notesCtx = { type, id };
  const entity = _notesEntity();
  if (!entity) return;
  document.getElementById('notesModalTitle').textContent = `Notes - ${entity.name}`;
  document.getElementById('n_date').value = today();
  document.getElementById('n_text').value = '';
  renderNotesList();
  document.getElementById('notesModal').classList.remove('hidden');
}
function renderNotesList() {
  const entity = _notesEntity();
  if (!entity) return;
  const key = _notesKey();
  const notes = (entity[key]||[]).slice().reverse();
  document.getElementById('notesList').innerHTML = notes.length
    ? notes.map(n=>`
      <div class="note-item">
        <div class="note-meta">
          <span class="note-date-label">${fmtDate(n.date)||n.date||'-'}</span>
          <div class="note-actions">
            <button class="btn btn-ghost btn-sm job-icon-btn" onclick="openEditNote('${n.id}')" title="Edit note" aria-label="Edit note">${jobIconSvg('edit')}</button>
            <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteNote('${n.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
          </div>
        </div>
        <div class="note-text">${esc(n.text)}</div>
      </div>`).join('')
    : '<div style="color:var(--text3);font-size:17px;padding:8px 0 16px">No notes yet.</div>';
}
function saveNote() {
  const text = document.getElementById('n_text').value.trim();
  const date = document.getElementById('n_date').value;
  if (!text) { showAlert('Please enter a note.'); return; }
  const entity = _notesEntity();
  if (!entity) return;
  const key = _notesKey();
  if (!entity[key]) entity[key]=[];
  entity[key].push({ id:uid(), text, date });
  save(); document.getElementById('n_text').value=''; document.getElementById('n_date').value=today();
  renderNotesList(); _notesRender();
}
function deleteNote(noteId) {
  showConfirm('Delete this note?', () => {
    const entity = _notesEntity();
    if (!entity) return;
    const key = _notesKey();
    entity[key] = (entity[key]||[]).filter(n=>n.id!==noteId);
    save(); renderNotesList(); _notesRender();
  });
}
function openEditNote(noteId) {
  const entity = _notesEntity();
  if (!entity) return;
  const key = _notesKey();
  const note = (entity[key]||[]).find(n=>n.id===noteId);
  if (!note) return;
  editNoteCtx = { noteId };
  document.getElementById('en_date').value = note.date||'';
  document.getElementById('en_text').value = note.text||'';
  document.getElementById('editNoteModal').classList.remove('hidden');
}
function saveEditNote() {
  if (!editNoteCtx) return;
  const { noteId } = editNoteCtx;
  const entity = _notesEntity();
  if (!entity) return;
  const key = _notesKey();
  const note = (entity[key]||[]).find(n=>n.id===noteId);
  if (!note) return;
  note.text = document.getElementById('en_text').value.trim();
  note.date = document.getElementById('en_date').value;
  save(); closeModal('editNoteModal'); renderNotesList(); _notesRender();
}

// ─── HOURS ────────────────────────────────────────────────────────────────────
function openHours(jobId) {
  hoursJobId = jobId;
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job) return;
  document.getElementById('hoursModalTitle').textContent = `Hours - ${job.name}`;
  document.getElementById('h_date').value  = today();
  document.getElementById('h_hours').value = '';
  document.getElementById('h_note').value  = '';
  renderHoursList();
  document.getElementById('hoursModal').classList.remove('hidden');
}
function renderHoursList() {
  const job = state.jobs.find(j=>j.id===hoursJobId);
  if (!job) return;
  const hours = job.hours||[];
  const total = hours.reduce((s,h)=>s+(h.hours||0),0);
  document.getElementById('hoursTotalBar').innerHTML = `
    <div class="hours-total-bar">
      <span style="font-family:var(--mono);font-size:15px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3)">Total Hours Logged</span>
      <span style="font-family:var(--mono);font-size:28px;font-weight:600;color:var(--accent)">${total}h</span>
    </div>`;
  const sorted = hours.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  document.getElementById('hoursList').innerHTML = sorted.length
    ? sorted.map(h=>`
      <div class="hours-item">
        <div>
          <div style="font-family:var(--mono);font-size:16px;color:var(--text3)">${fmtDate(h.date)||h.date||''}</div>
          ${h.note?`<div style="font-size:17px;color:var(--text2);margin-top:2px">${esc(h.note)}</div>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-family:var(--mono);font-size:20px;font-weight:600;color:var(--accent)">${h.hours}h</span>
            <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteHoursEntry('${h.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
        </div>
      </div>`).join('')
    : '<div style="color:var(--text3);font-size:17px;padding:8px 0 16px">No hours logged yet.</div>';
}
function saveHours() {
  const date  = document.getElementById('h_date').value;
  const hours = parseFloat(document.getElementById('h_hours').value);
  const note  = document.getElementById('h_note').value.trim();
  if (!hours||hours<=0) { showAlert('Please enter a valid number of hours.'); return; }
  const job = state.jobs.find(j=>j.id===hoursJobId);
  if (!job) return;
  if (!job.hours) job.hours=[];
  job.hours.push({ id:uid(), date, hours, note });
  save(); document.getElementById('h_hours').value=''; document.getElementById('h_note').value=''; document.getElementById('h_date').value=today();
  renderHoursList(); renderJobs();
}
function deleteHoursEntry(hId) {
  const job = state.jobs.find(j=>j.id===hoursJobId);
  if (!job) return;
  job.hours = (job.hours||[]).filter(h=>h.id!==hId);
  save(); renderHoursList(); renderJobs();
}

// ─── JOB MODAL ────────────────────────────────────────────────────────────────
let milestoneCount = 0;
let quoteItemCount = 0;
function populateEmpDropdown(selectId, wrapId, currentEmpId) {
  const emps = state.users.filter(u => !u.isAdmin);
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.style.display = emps.length > 1 ? '' : 'none';
  if (emps.length <= 1) return;
  document.getElementById(selectId).innerHTML = emps.map(u =>
    `<option value="${u.id}"${u.id === currentEmpId ? ' selected' : ''}>${esc(u.name)}</option>`
  ).join('');
}
let milestoneMode = 'single';
let jobTypeMode = 'quoted';
let jobSetupMode = 'unified';
function refreshJobSetupButtons() {
  ['unified', 'itemized', 'hourly'].forEach(mode => {
    const btn = document.getElementById(`js_mode_${mode}`);
    if (!btn) return;
    btn.className = `btn ${jobSetupMode === mode ? 'btn-primary selected' : 'btn-ghost'} btn-sm user-pick-btn`;
  });
}
function setJobType(type) {
  jobTypeMode = type === 'hourly' ? 'hourly' : 'quoted';
  const typeEl = document.getElementById('f_jobType');
  if (typeEl && typeEl.value !== jobTypeMode) typeEl.value = jobTypeMode;
  const quotedWrap = document.getElementById('jobQuotedFields');
  const hourlyHint = document.getElementById('jobHourlyHint');
  const hourlyRateWrap = document.getElementById('f_hourly_rate_wrap');
  const hourlyLike = jobTypeMode === 'hourly' || jobTypeMode === 'hourly';
  if (quotedWrap) quotedWrap.style.display = hourlyLike ? 'none' : '';
  if (hourlyHint) hourlyHint.style.display = hourlyLike ? '' : 'none';
  if (hourlyRateWrap) hourlyRateWrap.style.display = hourlyLike ? '' : 'none';
}
function setJobSetupMode(mode) {
  jobSetupMode = mode === 'itemized' ? 'itemized' : mode === 'hourly' ? 'hourly' : 'unified';
  const isHourly = jobSetupMode === 'hourly';
  const itemized = jobSetupMode === 'itemized';
  setJobType(isHourly ? 'hourly' : 'quoted');
  const itemizedEl = document.getElementById('f_itemized');
  if (itemizedEl) itemizedEl.checked = itemized;
  toggleItemizedQuote();
  refreshJobSetupButtons();
}
function onJobTypeChange() {
  const type = document.getElementById('f_jobType')?.value || 'quoted';
  if (type === 'hourly') setJobSetupMode('hourly');
  else setJobSetupMode(document.getElementById('f_itemized')?.checked ? 'itemized' : 'unified');
}
function setMilestoneMode(mode) {
  const dms = state.settings.defaultMilestones || [];
  if (mode === 'default' && !dms.length) {
    document.getElementById('milestoneHint').textContent = 'No defaults set - configure them in Settings > Jobs.';
    document.getElementById('milestoneHint').style.display = '';
    document.getElementById('milestoneEditor').style.display = 'none';
    // keep single selected
    mode = 'single';
  }
  milestoneMode = mode;
  ['single','default','custom'].forEach(m => {
    const btn = document.getElementById(`ms_btn_${m}`);
    if (btn) btn.className = `btn ${m === mode ? 'btn-primary' : 'btn-ghost'} btn-sm`;
  });
  const editor = document.getElementById('milestoneEditor');
  const hint   = document.getElementById('milestoneHint');
  if (mode === 'single') {
    editor.style.display = 'none';
    hint.textContent = 'Full invoice - one payment to track.';
    hint.style.display = '';
    document.getElementById('milestoneList').innerHTML = '';
    milestoneCount = 0;
  } else {
    editor.style.display = '';
    hint.style.display = 'none';
    document.getElementById('milestoneList').innerHTML = '';
    milestoneCount = 0;
    if (mode === 'default') {
      dms.forEach(m => addMilestoneField(m.label, m.pct));
    } else {
      addMilestoneField();
    }
  }
}
function setJobFinancialEditLock(locked) {
  const note = document.getElementById('jobFinancialLockNote');
  if (note) note.style.display = locked ? '' : 'none';

  const ids = ['f_jobType', 'f_hourlyRate', 'f_itemized', 'f_quote', 'quoteAddItemBtn', 'ms_btn_single', 'ms_btn_default', 'ms_btn_custom', 'milestoneAddBtn', 'js_mode_unified', 'js_mode_itemized', 'js_mode_hourly'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!locked;
  });

  const lockRegion = document.getElementById('jobFinancialLockRegion');
  if (lockRegion) {
    lockRegion.style.opacity = locked ? '0.5' : '1';
    lockRegion.style.filter = locked ? 'grayscale(0.2)' : 'none';
  }

  document.querySelectorAll('#quoteItemList input, #quoteItemList button').forEach(el => {
    el.disabled = !!locked;
  });
  document.querySelectorAll('#milestoneList input, #milestoneList button').forEach(el => {
    el.disabled = !!locked;
  });
}

function openNewJobModal() {
  editingJobId = null;
  document.getElementById('jobModalTitle').textContent = 'New Job';
  document.getElementById('f_name').value    = '';
  document.getElementById('f_contact').value = '';
  document.getElementById('f_quote').value   = '';
  document.getElementById('f_hourlyRate').value = '';
  document.getElementById('f_date').value    = today();
  document.getElementById('f_itemized').checked = false;
  document.getElementById('f_jobType').value = 'quoted';
  document.getElementById('quoteItemList').innerHTML = '';
  quoteItemCount = 0;
  setJobSetupMode('unified');
  setMilestoneMode('single');
  populateEmpDropdown('f_emp', 'f_emp_wrap', null);
  setJobFinancialEditLock(false);
  document.getElementById('jobModal').classList.remove('hidden');
}
function editJob(id) {
  const job = state.jobs.find(j=>j.id===id);
  if (!job) return;
  const jobType = _jobType(job);
  editingJobId = id;
  document.getElementById('jobModalTitle').textContent = 'Edit Job';
  document.getElementById('f_name').value    = job.name;
  document.getElementById('f_contact').value = job.contactName || '';
  document.getElementById('f_quote').value   = job.quote;
  document.getElementById('f_hourlyRate').value = (job.hourlyRate || 0) > 0 ? Number(job.hourlyRate).toFixed(2) : '';
  document.getElementById('f_date').value    = job.date||'';
  document.getElementById('f_itemized').checked = job.isItemized||false;
  document.getElementById('f_jobType').value = jobType;
  document.getElementById('quoteItemList').innerHTML = '';
  quoteItemCount = 0;
  if (job.isItemized && job.quoteItems?.length) {
    job.quoteItems.forEach(qi => addQuoteItemField(qi.label, qi.amount));
  }
  setJobSetupMode(jobType === 'hourly' ? 'hourly' : (job.isItemized ? 'itemized' : 'unified'));
  if (jobType === 'hourly') {
    milestoneMode = 'single';
    document.getElementById('milestoneList').innerHTML = '';
    milestoneCount = 0;
  } else {
    const isSingle = job.milestones?.length === 1 && job.milestones[0].pct === 100;
    if (isSingle) {
      setMilestoneMode('single');
    } else {
      milestoneMode = 'custom';
      ['single','default','custom'].forEach(m => {
        const btn = document.getElementById(`ms_btn_${m}`);
        if (btn) btn.className = `btn ${m === 'custom' ? 'btn-primary' : 'btn-ghost'} btn-sm`;
      });
      document.getElementById('milestoneEditor').style.display = '';
      document.getElementById('milestoneHint').style.display = 'none';
      document.getElementById('milestoneList').innerHTML = '';
      milestoneCount = 0;
      (job.milestones||[]).forEach(m => addMilestoneField(m.label, m.pct));
    }
  }
  populateEmpDropdown('f_emp', 'f_emp_wrap', job.employeeId);
  setJobFinancialEditLock(hasPartialFinancialState(job));
  document.getElementById('jobModal').classList.remove('hidden');
}
let dmCount = 0;
function addDmField(label='', pct='') {
  dmCount++;
  const id = dmCount;
  const div = document.createElement('div');
  div.className = 'milestone-row'; div.id = `dmrow_${id}`;
  div.innerHTML = `
    <input class="form-input" placeholder="Label" value="${label}" id="dmlabel_${id}" style="flex:2" />
    <input class="form-input" placeholder="%" type="number" value="${pct}" id="dmpct_${id}" style="flex:1;max-width:80px" oninput="updateDmPreview()" />
    <button class="btn btn-danger btn-sm btn-icon-only" onclick="document.getElementById('dmrow_${id}').remove();updateDmPreview()" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>`;
  document.getElementById('dmList').appendChild(div);
  updateDmPreview();
}
function updateDmPreview() {
  let total = 0;
  document.querySelectorAll('[id^="dmpct_"]').forEach(el => { total += parseFloat(el.value) || 0; });
  const err = document.getElementById('dmError');
  if (err) err.textContent = (total > 0 && Math.abs(total - 100) > 0.01) ? `Total: ${total}%` : '';
}
function addMilestoneField(label='', pct='') {
  milestoneCount++;
  const id = milestoneCount;
  const div = document.createElement('div');
  div.className = 'milestone-row'; div.id = `mrow_${id}`;
  div.innerHTML = `
    <input class="form-input" placeholder="Label" value="${label}" id="mlabel_${id}" style="flex:2" />
    <input class="form-input" placeholder="%" type="number" value="${pct}" id="mpct_${id}" style="flex:1;max-width:80px" oninput="updateMilestonePreview()" />
    <button class="btn btn-danger btn-sm btn-icon-only" onclick="document.getElementById('mrow_${id}').remove();updateMilestonePreview()" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>`;
  document.getElementById('milestoneList').appendChild(div);
  updateMilestonePreview();
}
function updateMilestonePreview() {
  let total=0;
  document.querySelectorAll('[id^="mpct_"]').forEach(el=>{total+=parseFloat(el.value)||0;});
  const err = document.getElementById('milestoneError');
  err.textContent = (Math.abs(total-100)>0.01&&total>0) ? `Milestones total ${total}% - must equal 100%` : '';
}
function toggleItemizedQuote() {
  const on = document.getElementById('f_itemized').checked;
  document.getElementById('f_quote_wrap').style.display = on ? 'none' : '';
  document.getElementById('f_items_wrap').style.display = on ? '' : 'none';
  if (on && document.getElementById('quoteItemList').children.length === 0) {
    addQuoteItemField();
  }
}
function addQuoteItemField(label='', amount='') {
  quoteItemCount++;
  const id = quoteItemCount;
  const div = document.createElement('div');
  div.id = `qitem_${id}`;
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `
    <input class="form-input" placeholder="Description" value="${label}" id="qilabel_${id}" style="flex:2" />
    <input class="form-input" placeholder="$0.00" type="number" step="0.01" value="${amount}" id="qiamt_${id}" style="flex:1;max-width:100px" oninput="updateQuoteItemTotal()" />
    <button class="btn btn-danger btn-sm btn-icon-only" onclick="document.getElementById('qitem_${id}').remove();updateQuoteItemTotal()" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>`;
  document.getElementById('quoteItemList').appendChild(div);
  updateQuoteItemTotal();
}
function updateQuoteItemTotal() {
  let total = 0;
  document.querySelectorAll('[id^="qiamt_"]').forEach(el => { total += parseFloat(el.value)||0; });
  const el = document.getElementById('quoteItemTotal');
  if (el) el.textContent = '$' + total.toFixed(2);
}
function hasPartialFinancialState(job) {
  if (!job) return false;
  if ((job.partialCollections || []).length) return true;
  if ((job.revenueItems || []).some(r => r?.partialState || r?.partialGroupId || r?.partialMode || r?.partialDate)) return true;
  if ((job.milestones || []).some(m => m?.partialState || m?.partialGroupId || m?.partialMode || m?.partialDate)) return true;
  if ((job.addOns || []).some(a => a?.partialState || a?.partialGroupId || a?.partialMode || a?.partialDate)) return true;
  if ((job.subtractions || []).some(s => s?.partialState || s?.appliedByPartial)) return true;
  return false;
}
function financialSignatureFromMilestones(list) {
  return JSON.stringify((list || []).map(m => ({ label: String(m?.label || ''), pct: Number(m?.pct || 0) })));
}
function financialSignatureFromQuoteItems(list) {
  return JSON.stringify((list || []).map(q => ({ label: String(q?.label || ''), amount: _roundMoney(Number(q?.amount || 0)) })));
}

function saveJob() {
  const name        = document.getElementById('f_name').value.trim();
  const contactName = document.getElementById('f_contact').value.trim();
  const date        = document.getElementById('f_date').value;
  const selectedType = document.getElementById('f_jobType')?.value || 'quoted';
  const jobType     = selectedType === 'hourly' ? 'hourly' : 'quoted';
  const isHourly    = jobType === 'hourly';
  const hourlyRate  = _roundMoney(parseFloat(document.getElementById('f_hourlyRate')?.value) || 0);
  const isItemized  = !isHourly && document.getElementById('f_itemized').checked;
  if (!name) { showAlert('Please enter a client name.'); return; }
  let quote = 0, quoteItems = [];
  if (isHourly) {
    quote = 0;
    quoteItems = [];
  } else if (isItemized) {
    document.querySelectorAll('[id^="qiamt_"]').forEach((el, i) => {
      const amt = parseFloat(el.value)||0;
      const qId = el.id.slice('qiamt_'.length);
      const lbl = document.getElementById(`qilabel_${qId}`)?.value.trim()||`Item ${i+1}`;
      quoteItems.push({ id: uid(), label: lbl, amount: amt });
    });
    if (quoteItems.length === 0) { showAlert('Please add at least one line item.'); return; }
    quote = quoteItems.reduce((s, qi) => s + (qi.amount||0), 0);
  } else {
    quote = parseFloat(document.getElementById('f_quote').value)||0;
  }
  const milestones=[]; let total=0;
  if (isHourly) {
    // Hourly jobs use revenue entries instead of quote milestones.
  } else if (milestoneMode === 'single') {
    const prevStatus = editingJobId
      ? (state.jobs.find(j=>j.id===editingJobId)?.milestones?.[0]?.status || 'pending')
      : 'pending';
    milestones.push({ label:'Invoice', pct:100, status: prevStatus });
  } else {
    document.querySelectorAll('[id^="mpct_"]').forEach((el,i)=>{
      const pct = parseFloat(el.value)||0;
      const mId = el.id.slice('mpct_'.length);
      const lbl = document.getElementById(`mlabel_${mId}`)?.value||`Milestone ${i+1}`;
      milestones.push({label:lbl,pct,status:'pending'}); total+=pct;
    });
    if (milestones.length&&Math.abs(total-100)>0.01) { showAlert(`Milestone percentages add up to ${total}%, not 100%.`); return; }
  }
  const isNew = !editingJobId;
  const originalName = editingJobId ? (state.jobs.find(j=>j.id===editingJobId)?.name || '') : '';
  const emps = state.users.filter(u => !u.isAdmin);
  const employeeId = emps.length > 1
    ? (document.getElementById('f_emp')?.value || emps[0]?.id)
    : emps[0]?.id;
  if (editingJobId) {
    const job = state.jobs.find(j=>j.id===editingJobId);
    if (job) {
      const partialLocked = hasPartialFinancialState(job);
      if (partialLocked) {
        const typeChanged = _jobType(job) !== jobType;
        const milestoneChanged = !isHourly && (financialSignatureFromMilestones(milestones) !== financialSignatureFromMilestones(job.milestones || []));
        const quoteChanged = !isHourly && (_roundMoney(Number(quote || 0)) !== _roundMoney(Number(job.quote || 0)));
        const itemizedChanged = !isHourly && (!!isItemized !== !!job.isItemized);
        const quoteItemsChanged = !isHourly && (financialSignatureFromQuoteItems(quoteItems) !== financialSignatureFromQuoteItems(job.quoteItems || []));
        if (typeChanged || milestoneChanged || quoteChanged || itemizedChanged || quoteItemsChanged) {
          showAlert('This job has revenue-collection history. Job type, quote, and payment structure edits are locked here to protect split calculations. Use Revenue > Collections (Edit/Delete) first.');
          return;
        }
      }
      job.name = name;
      job.contactName = contactName;
      job.date = date;
      if (employeeId) job.employeeId = employeeId;
      job.jobType = jobType;
      job.hourlyRate = hourlyRate;
      if (!partialLocked) {
        job.quote = quote;
        job.isItemized = isItemized;
        job.quoteItems = quoteItems;
        if (!isHourly) milestones.forEach((m,i)=>{ if(job.milestones[i]) m.status=job.milestones[i].status||'pending'; });
        job.milestones = milestones;
      }
    }
  } else {
    const newId = uid();
    expandedJobs.clear();
    expandedJobs.add(newId);
    saveExpandedState();
    state.jobs.push({ id:newId, name, contactName, quote, date, isItemized, quoteItems, status:'active',
      milestones, addOns:[], subtractions:[], materials:[], advances:[], fees:[], jobNotes:[], hours:[], partialCollections:[], repaymentMode:false,
      revenueItems:[], jobType, hourlyRate,
      hourlyStatus:'pending', hourlySquareInvoiceId:'',
      employeeId: employeeId || '' });
  }
  save(); renderJobs(); closeModal('jobModal');
  if (isNew || name.toLowerCase() !== originalName.toLowerCase()) checkNewClientPrompt(name);
}

// ─── UNIFIED QUICK JOB MODAL ────────────────────────────────────────────────
let unifiedLineCount = 0;
let unifiedMilestoneCount = 0;
let unifiedNewClientMode = false;
let unifiedClientAcIdx = -1;

function _unifiedAttr(value) {
  return esc(String(value ?? '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _unifiedLineDefaultLabel(type) {
  return { fixed:'Fixed labor', hourly:'Hourly labor', material:'Materials', other:'Other charge', credit:'Credit' }[type] || 'Labor';
}

function _unifiedLineTypeOptions(selected) {
  const options = [
    ['fixed', 'Fixed labor'],
    ['hourly', 'Hourly labor'],
    ['material', 'Materials'],
    ['other', 'Other charge'],
    ['credit', 'Credit']
  ];
  return options.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function _unifiedEmployeeId() {
  const emps = state.users.filter(u => !u.isAdmin);
  return emps.length > 1
    ? (document.getElementById('uj_emp')?.value || emps[0]?.id || '')
    : (emps[0]?.id || '');
}

function _unifiedEmployeeName() {
  return getEmp(_unifiedEmployeeId())?.name || 'Employee';
}

function openUnifiedJobModal() {
  if (!currentUser?.isAdmin) return;
  unifiedNewClientMode = false;
  unifiedClientAcIdx = -1;
  unifiedLineCount = 0;
  unifiedMilestoneCount = 0;
  document.getElementById('uj_clientName').value = '';
  document.getElementById('uj_clientId').value = '';
  document.getElementById('uj_existingClientInfo').textContent = '';
  document.getElementById('uj_newClientFields').style.display = 'none';
  document.getElementById('uj_newClientBtn').textContent = 'NEW CLIENT';
  document.getElementById('uj_newClientBtn').disabled = false;
  ['uj_firstName','uj_surname','uj_company','uj_email','uj_phone','uj_address1','uj_address2','uj_city','uj_state','uj_postal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('uj_contactName').value = '';
  document.getElementById('uj_date').value = today();
  document.getElementById('uj_notes').value = '';
  document.getElementById('uj_lineList').innerHTML = '';
  document.getElementById('uj_milestoneList').innerHTML = '';
  document.getElementById('uj_paymentMode').value = 'single';
  populateEmpDropdown('uj_emp', 'uj_emp_wrap', null);
  addUnifiedLine('fixed');
  updateUnifiedJobDescriptionSummary();
  setUnifiedPaymentMode('single');
  document.getElementById('unifiedJobModal').classList.remove('hidden');
}

function addUnifiedLine(type = 'fixed', preset = {}) {
  const safeType = ['fixed','hourly','material','other','credit'].includes(type) ? type : 'fixed';
  unifiedLineCount++;
  const id = unifiedLineCount;
  const row = document.createElement('div');
  row.className = 'unified-line-row';
  row.id = `uj_line_${id}`;
  row.dataset.lineId = String(id);
  row._preset = { ...preset };
  row.innerHTML = `
    <div class="unified-line-head">
      <select class="form-input" id="uj_type_${id}" onchange="renderUnifiedLine(${id})">${_unifiedLineTypeOptions(safeType)}</select>
      <button type="button" class="btn btn-danger btn-sm btn-icon-only" onclick="removeUnifiedLine(${id})" title="Remove line" aria-label="Remove line">${jobIconSvg('trash')}</button>
    </div>
    <div id="uj_fields_${id}"></div>`;
  document.getElementById('uj_lineList').appendChild(row);
  renderUnifiedLine(id);
}

function renderUnifiedLine(id) {
  const row = document.getElementById(`uj_line_${id}`);
  if (!row) return;
  const type = document.getElementById(`uj_type_${id}`)?.value || 'fixed';
  const p = row._preset || {};
  const description = p.description ?? (p.label && p.label !== _unifiedLineDefaultLabel(type) ? p.label : '');
  const amount = p.amount ?? '';
  const hours = p.hours ?? '';
  const rate = p.rate ?? '';
  const who = p.who === 'emp' ? 'emp' : 'owner';
  const billClient = p.billClient !== false;
  const empName = esc(_unifiedEmployeeName());
  let html = '';

  if (type === 'hourly') {
    html = `
      <div class="unified-line-fields">
        <div class="form-group"><label class="form-label">Work description <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="form-input" id="uj_desc_${id}" value="${_unifiedAttr(description)}" placeholder="What work was completed?" oninput="updateUnifiedJobDescriptionSummary()" /></div>
        <div class="form-group"><label class="form-label">Hours</label><input class="form-input" id="uj_hours_${id}" type="number" min="0" step="0.25" value="${_unifiedAttr(hours)}" placeholder="0" oninput="updateUnifiedJobTotal()" /></div>
        <div class="form-group"><label class="form-label">Rate ($/hr)</label><input class="form-input" id="uj_rate_${id}" type="number" min="0" step="0.01" value="${_unifiedAttr(rate)}" placeholder="0.00" oninput="updateUnifiedJobTotal()" /></div>
      </div>
      <div class="unified-line-total" id="uj_lineTotal_${id}"></div>`;
  } else if (type === 'material') {
    html = `
      <div class="unified-line-fields">
        <div class="form-group"><label class="form-label">Work description <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="form-input" id="uj_desc_${id}" value="${_unifiedAttr(description)}" placeholder="What was purchased or used?" oninput="updateUnifiedJobDescriptionSummary()" /></div>
        <div class="form-group"><label class="form-label">Amount ($)</label><input class="form-input" id="uj_amount_${id}" type="number" min="0" step="0.01" value="${_unifiedAttr(amount)}" placeholder="0.00" oninput="updateUnifiedJobTotal()" /></div>
        <div class="form-group"><label class="form-label">Purchased by</label><select class="form-input" id="uj_who_${id}" onchange="updateUnifiedJobTotal()"><option value="owner"${who === 'owner' ? ' selected' : ''}>EHS</option><option value="emp"${who === 'emp' ? ' selected' : ''}>${empName}</option></select></div>
      </div>
      <div class="unified-checkbox"><input type="checkbox" id="uj_bill_${id}"${billClient ? ' checked' : ''} onchange="updateUnifiedJobTotal()" /><span>Bill this material to the client</span></div>`;
  } else {
    const isCredit = type === 'credit';
    html = `
      <div class="unified-line-fields unified-line-fields-two">
        <div class="form-group"><label class="form-label">Work description <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="form-input" id="uj_desc_${id}" value="${_unifiedAttr(description)}" placeholder="${isCredit ? 'Why is this credit applied?' : 'What work or charge was completed?'}" oninput="updateUnifiedJobDescriptionSummary()" /></div>
        <div class="form-group"><label class="form-label">Amount ($)</label><input class="form-input" id="uj_amount_${id}" type="number" min="0" step="0.01" value="${_unifiedAttr(amount)}" placeholder="0.00" oninput="updateUnifiedJobTotal()" /></div>
      </div>`;
  }
  document.getElementById(`uj_fields_${id}`).innerHTML = html;
  updateUnifiedJobTotal();
  updateUnifiedJobDescriptionSummary();
}

function removeUnifiedLine(id) {
  document.getElementById(`uj_line_${id}`)?.remove();
  updateUnifiedJobTotal();
  updateUnifiedJobDescriptionSummary();
}

function readUnifiedLines() {
  return [...document.querySelectorAll('#uj_lineList .unified-line-row')].map(row => {
    const id = row.dataset.lineId;
    const type = document.getElementById(`uj_type_${id}`)?.value || 'fixed';
    const description = document.getElementById(`uj_desc_${id}`)?.value.trim() || '';
    const label = description || _unifiedLineDefaultLabel(type);
    const hours = _roundMoney(parseFloat(document.getElementById(`uj_hours_${id}`)?.value) || 0);
    const rate = _roundMoney(parseFloat(document.getElementById(`uj_rate_${id}`)?.value) || 0);
    const amount = type === 'hourly'
      ? _roundMoney(hours * rate)
      : _roundMoney(parseFloat(document.getElementById(`uj_amount_${id}`)?.value) || 0);
    return {
      id: uid(),
      type,
      label,
      description,
      amount,
      hours,
      rate,
      who: document.getElementById(`uj_who_${id}`)?.value === 'emp' ? 'emp' : 'owner',
      billClient: document.getElementById(`uj_bill_${id}`)?.checked !== false
    };
  });
}

function updateUnifiedJobDescriptionSummary() {
  const summary = document.getElementById('uj_descriptionSummary');
  if (!summary) return;
  const descriptions = [...document.querySelectorAll('#uj_lineList .unified-line-row')]
    .map(row => document.getElementById(`uj_desc_${row.dataset.lineId}`)?.value.trim() || '')
    .filter(Boolean);
  summary.textContent = descriptions.length
    ? descriptions.join(', ')
    : 'Line item descriptions will appear here as a comma-separated list.';
  summary.classList.toggle('empty', !descriptions.length);
}

function updateUnifiedJobTotal() {
  let fixed = 0, hourly = 0, billedMaterials = 0, internalMaterials = 0, other = 0, credits = 0;
  document.querySelectorAll('#uj_lineList .unified-line-row').forEach(row => {
    const id = row.dataset.lineId;
    const type = document.getElementById(`uj_type_${id}`)?.value || 'fixed';
    const hours = parseFloat(document.getElementById(`uj_hours_${id}`)?.value) || 0;
    const rate = parseFloat(document.getElementById(`uj_rate_${id}`)?.value) || 0;
    const amount = type === 'hourly'
      ? _roundMoney(hours * rate)
      : _roundMoney(parseFloat(document.getElementById(`uj_amount_${id}`)?.value) || 0);
    const lineTotal = document.getElementById(`uj_lineTotal_${id}`);
    if (lineTotal) lineTotal.textContent = type === 'hourly' ? `${hours || 0}h x ${fmt(rate)} = ${fmt(amount)}` : '';
    if (type === 'fixed') fixed += amount;
    else if (type === 'other') other += amount;
    else if (type === 'hourly') hourly += amount;
    else if (type === 'material') {
      if (document.getElementById(`uj_bill_${id}`)?.checked !== false) billedMaterials += amount;
      else internalMaterials += amount;
    } else if (type === 'credit') credits += amount;
  });
  const clientTotal = _roundMoney(fixed + hourly + billedMaterials - credits);
  const summary = document.getElementById('uj_totalSummary');
  if (!summary) return;
  const rows = [];
  if (fixed > 0) rows.push(`<div class="unified-summary-row"><span>Fixed labor</span><strong>${fmt(fixed)}</strong></div>`);
  if (hourly > 0) rows.push(`<div class="unified-summary-row"><span>Hourly labor</span><strong>${fmt(hourly)}</strong></div>`);
  if (billedMaterials > 0) rows.push(`<div class="unified-summary-row"><span>Materials</span><strong>${fmt(billedMaterials)}</strong></div>`);
  if (other > 0) rows.push(`<div class="unified-summary-row"><span>Other charges</span><strong>${fmt(other)}</strong></div>`);
  if (credits > 0) rows.push(`<div class="unified-summary-row"><span>Credits</span><strong>-${fmt(credits)}</strong></div>`);
  summary.innerHTML = `${rows.join('')}
    <div class="unified-summary-row total"><span>Total client charges</span><strong>${fmt(clientTotal)}</strong></div>
    ${internalMaterials > 0 ? `<div class="unified-summary-row" style="color:var(--text3);font-size:12px"><span>Materials not billed to client</span><strong>${fmt(internalMaterials)}</strong></div>` : ''}`;
}

function updateUnifiedNewClientButtonState() {
  const input = document.getElementById('uj_clientName');
  const btn = document.getElementById('uj_newClientBtn');
  if (!input || !btn) return false;
  const existing = clientById(document.getElementById('uj_clientId')?.value) || clientByName(input.value.trim());
  btn.disabled = !!existing;
  btn.textContent = 'NEW CLIENT';
  if (existing && unifiedNewClientMode) {
    unifiedNewClientMode = false;
    const fields = document.getElementById('uj_newClientFields');
    if (fields) fields.style.display = 'none';
  }
  return !!existing;
}

function toggleUnifiedNewClient() {
  if (document.getElementById('uj_newClientBtn')?.disabled) return;
  unifiedNewClientMode = !unifiedNewClientMode;
  const fields = document.getElementById('uj_newClientFields');
  const btn = document.getElementById('uj_newClientBtn');
  if (unifiedNewClientMode) {
    document.getElementById('uj_clientId').value = '';
    hideUnifiedClientAC();
    const parts = document.getElementById('uj_clientName').value.trim().split(/\s+/).filter(Boolean);
    if (!document.getElementById('uj_firstName').value) document.getElementById('uj_firstName').value = parts[0] || '';
    if (!document.getElementById('uj_surname').value) document.getElementById('uj_surname').value = parts.slice(1).join(' ');
    fields.style.display = '';
    btn.textContent = 'NEW CLIENT';
    document.getElementById('uj_existingClientInfo').textContent = 'New client details will be saved with this job.';
  } else {
    fields.style.display = 'none';
    btn.textContent = 'NEW CLIENT';
    document.getElementById('uj_existingClientInfo').textContent = '';
  }
}

function showUnifiedClientAC() {
  const input = document.getElementById('uj_clientName');
  const list = document.getElementById('uj_clientAcList');
  if (!input || !list) return;
  const selected = clientById(document.getElementById('uj_clientId').value);
  if (selected && clientDisplayName(selected).toLowerCase() !== input.value.trim().toLowerCase()) {
    document.getElementById('uj_clientId').value = '';
    document.getElementById('uj_existingClientInfo').textContent = '';
  }
  updateUnifiedNewClientButtonState();
  const q = input.value.toLowerCase().trim();
  if (!q) { list.style.display = 'none'; return; }
  const matches = (state.clients || []).filter(c => {
    const haystack = [clientDisplayName(c), c.company, c.email].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  }).slice(0, 8);
  unifiedClientAcIdx = -1;
  list.innerHTML = matches.length ? matches.map(c => `
    <div class="ac-item" data-id="${_unifiedAttr(c.id)}" onmousedown="pickUnifiedClient('${_unifiedAttr(c.id)}')">
      <div>${esc(clientDisplayName(c))}</div>
      ${c.email || c.city ? `<div style="font-size:11px;color:var(--text3)">${esc([c.city, c.email].filter(Boolean).join(' | '))}</div>` : ''}
    </div>`).join('') : '';
  list.style.display = matches.length ? 'block' : 'none';
}

function hideUnifiedClientAC() {
  const list = document.getElementById('uj_clientAcList');
  if (list) list.style.display = 'none';
}

function pickUnifiedClient(id) {
  const c = clientById(id);
  if (!c) return;
  unifiedNewClientMode = false;
  document.getElementById('uj_clientId').value = c.id;
  document.getElementById('uj_clientName').value = clientDisplayName(c);
  document.getElementById('uj_existingClientInfo').textContent = [c.email, c.phone].filter(Boolean).join(' | ') || 'Existing client selected.';
  document.getElementById('uj_newClientFields').style.display = 'none';
  updateUnifiedNewClientButtonState();
  hideUnifiedClientAC();
}

function navigateUnifiedClientAC(e) {
  const list = document.getElementById('uj_clientAcList');
  if (!list || list.style.display === 'none') return;
  const items = list.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault(); unifiedClientAcIdx = Math.min(unifiedClientAcIdx + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); unifiedClientAcIdx = Math.max(unifiedClientAcIdx - 1, -1);
  } else if (e.key === 'Enter' && unifiedClientAcIdx >= 0) {
    e.preventDefault(); pickUnifiedClient(items[unifiedClientAcIdx].dataset.id); return;
  } else if (e.key === 'Escape') {
    hideUnifiedClientAC(); return;
  } else return;
  items.forEach((el, i) => el.classList.toggle('ac-active', i === unifiedClientAcIdx));
}

function addUnifiedMilestoneField(label = '', pct = '') {
  unifiedMilestoneCount++;
  const id = unifiedMilestoneCount;
  const div = document.createElement('div');
  div.className = 'milestone-row';
  div.id = `uj_mrow_${id}`;
  div.innerHTML = `
    <input class="form-input" placeholder="Label" value="${_unifiedAttr(label)}" id="uj_mllabel_${id}" style="flex:2" />
    <input class="form-input" placeholder="%" type="number" min="0" value="${_unifiedAttr(pct)}" id="uj_mlpct_${id}" style="flex:1;max-width:80px" oninput="updateUnifiedMilestonePreview()" />
    <button type="button" class="btn btn-danger btn-sm btn-icon-only" onclick="document.getElementById('uj_mrow_${id}').remove();updateUnifiedMilestonePreview()" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>`;
  document.getElementById('uj_milestoneList').appendChild(div);
  updateUnifiedMilestonePreview();
}

function updateUnifiedMilestonePreview() {
  let total = 0;
  document.querySelectorAll('#uj_milestoneList [id^="uj_mlpct_"]').forEach(el => { total += parseFloat(el.value) || 0; });
  const err = document.getElementById('uj_milestoneError');
  if (err) err.textContent = total > 0 && Math.abs(total - 100) > 0.01 ? `Milestones total ${total}%, must equal 100%.` : '';
}

function setUnifiedPaymentMode(mode) {
  const select = document.getElementById('uj_paymentMode');
  const dms = state.settings.defaultMilestones || [];
  if (mode === 'default' && !dms.length) {
    if (select) select.value = 'single';
    mode = 'single';
  }
  const editor = document.getElementById('uj_milestoneEditor');
  const hint = document.getElementById('uj_paymentHint');
  const list = document.getElementById('uj_milestoneList');
  if (!editor || !hint || !list) return;
  list.innerHTML = '';
  unifiedMilestoneCount = 0;
  if (mode === 'single') {
    editor.style.display = 'none';
    hint.textContent = 'One invoice for the full client total.';
    return;
  }
  editor.style.display = '';
  hint.textContent = mode === 'default' ? 'Using the saved milestone template.' : 'Milestones must add up to 100%.';
  if (mode === 'default') dms.forEach(m => addUnifiedMilestoneField(m.label, m.pct));
  else addUnifiedMilestoneField();
}

function _readUnifiedMilestones() {
  const mode = document.getElementById('uj_paymentMode')?.value || 'single';
  if (mode === 'single') return [{ label:'Invoice', pct:100, status:'pending' }];
  const milestones = [];
  let total = 0;
  document.querySelectorAll('#uj_milestoneList [id^="uj_mlpct_"]').forEach((el, i) => {
    const id = el.id.slice('uj_mlpct_'.length);
    const pct = _roundPct(parseFloat(el.value) || 0);
    const label = document.getElementById(`uj_mllabel_${id}`)?.value.trim() || `Milestone ${i + 1}`;
    if (pct > 0) milestones.push({ id:uid(), label, pct, status:'pending' });
    total += pct;
  });
  if (!milestones.length || Math.abs(total - 100) > 0.01) {
    showAlert(`Milestone percentages add up to ${total}%, not 100%.`);
    return null;
  }
  return milestones;
}

async function saveUnifiedJob() {
  if (!currentUser?.isAdmin || isSaving) return;
  const name = document.getElementById('uj_clientName').value.trim();
  const contactName = document.getElementById('uj_contactName').value.trim();
  const date = document.getElementById('uj_date').value || today();
  if (!name) { showAlert('Please enter a client name.'); return; }

  let client = clientById(document.getElementById('uj_clientId').value) || clientByName(name);
  if (!client && !unifiedNewClientMode) {
    showAlert('Select an existing client, or click New client details before saving.');
    return;
  }
  if (!client) {
    const parts = name.split(/\s+/).filter(Boolean);
    const firstName = document.getElementById('uj_firstName').value.trim() || parts[0] || '';
    const surname = document.getElementById('uj_surname').value.trim() || parts.slice(1).join(' ');
    const company = document.getElementById('uj_company').value.trim();
    if (!firstName && !surname && !company) { showAlert('Enter at least a client name or company.'); return; }
    client = {
      id: uid(), squareId:'', refId:'', firstName, surname, company,
      email: document.getElementById('uj_email').value.trim(),
      phone: document.getElementById('uj_phone').value.trim(),
      address1: document.getElementById('uj_address1').value.trim(),
      address2: document.getElementById('uj_address2').value.trim(),
      city: document.getElementById('uj_city').value.trim(),
      state: document.getElementById('uj_state').value.trim(),
      postal: document.getElementById('uj_postal').value.trim(),
      birthday:'', memo:'', emailSubStatus:'',
      firstVisit: date, lastVisit: date, txCount:0, lifetimeSpend:'', clientNotes:[]
    };
  }

  const lines = readUnifiedLines();
  if (!lines.length) { showAlert('Add at least one work or charge line.'); return; }
  if (lines.some(line => line.amount <= 0)) { showAlert('Every work and charge line needs an amount greater than $0.'); return; }

  const hourlyItems = lines.filter(line => line.type === 'hourly');
  const hourlyOnly = hourlyItems.length > 0 && !lines.some(line => ['fixed','other','credit'].includes(line.type));
  const quoteItems = lines
    .filter(line => line.type === 'fixed')
    .map(line => ({ id:line.id, label:line.label, description:line.description, amount:line.amount }));
  const materials = lines.filter(line => line.type === 'material').map(line => ({
    id: line.id,
    label: line.label,
    description: line.description,
    amount: line.amount,
    who: line.who,
    billClient: !!line.billClient,
    chargeAmount: line.billClient ? line.amount : 0,
    costAmount: line.amount
  }));
  const subtractions = lines.filter(line => line.type === 'credit').map(line => ({
    id:line.id, label:line.label, description:line.description, amount:line.amount, date, status:'pending', sourceItemId:null
  }));
  const addOns = [
    ...hourlyItems.map(line => ({
      id:line.id, label:line.label, description:line.description, amount:line.amount, date, status:'pending', isHours:true, hours:line.hours, rate:line.rate, chargeType:'hourly'
    })),
    ...lines.filter(line => line.type === 'other').map(line => ({
      id:line.id, label:line.label, description:line.description, amount:line.amount, date, status:'pending', chargeType:'other'
    })),
    ...(!hourlyOnly ? lines.filter(line => line.type === 'material' && line.billClient).map(line => ({
      id:uid(), label:line.label, description:line.description, amount:line.amount, date, status:'pending', chargeType:'materials', sourceItemId:line.id
    })) : [])
  ];
  const quote = _roundMoney(quoteItems.reduce((sum, line) => sum + line.amount, 0));
  const milestones = hourlyOnly || quote <= 0 ? [] : _readUnifiedMilestones();
  if (milestones === null) return;
  if (client.id && !clientById(client.id)) {
    if (!state.clients) state.clients = [];
    state.clients.push(client);
  }
  const hourlyRate = hourlyItems.length ? hourlyItems[0].rate : 0;
  const notes = document.getElementById('uj_notes').value.trim();
  const workSummary = lines.map(line => line.description).filter(Boolean).join(', ');
  const jobId = uid();
  const contactClient = clientByName(contactName);
  const job = {
    id: jobId,
    name,
    contactName,
    clientId: client.id,
    contactClientId: contactClient?.id || '',
    quote,
    date,
    isItemized: quoteItems.length > 0,
    quoteItems,
    status:'active',
    milestones,
    addOns,
    subtractions,
    materials,
    advances:[],
    fees:[],
    jobNotes: notes ? [{ id:uid(), text:notes, date, authorId:currentUser.id, authorName:currentUser.name }] : [],
    workSummary,
    hours:[],
    partialCollections:[],
    repaymentMode:false,
    revenueItems:[],
    jobType: hourlyOnly ? 'hourly' : 'quoted',
    hourlyRate,
    hourlyStatus:'pending',
    hourlySquareInvoiceId:'',
    employeeId:_unifiedEmployeeId(),
    createdVia:'unified-v2',
    unifiedLines: lines
  };
  state.jobs.push(job);
  expandedJobs.clear();
  expandedJobs.add(jobId);
  saveExpandedState();
  await save();
  renderAll();
  closeModal('unifiedJobModal');
}

// ─── ADD ITEM MODAL ───────────────────────────────────────────────────────────
function openAddItem(jobId, type, itemId = null) {
  addItemContext = { jobId, type, itemId };
  const job = state.jobs.find(j => j.id === jobId);
  const isHourly = _jobType(job) === 'hourly';
  const en = esc(getEmp(job?.employeeId)?.name || 'Employee');
  const isEdit = !!itemId;
  const existingMaterial = isEdit ? (job?.materials || []).find(x => x.id === itemId) : null;
  const defaultBillClient = existingMaterial?.billClient !== undefined
    ? !!existingMaterial.billClient
    : (isHourly ? Number(existingMaterial?.chargeAmount ?? existingMaterial?.amount ?? 0) > 0 : true);
  const titles = {
    revenue: isEdit ? 'Edit Revenue Entry' : 'Add Revenue Entry',
    addon: isEdit ? 'Edit Addition' : 'Add Addition',
    hours: isEdit ? 'Edit Hours' : 'Add Hours',
    subtraction: isEdit ? 'Edit Subtraction' : 'Add Subtraction',
    material: isEdit ? 'Edit Material' : 'Add Material',
    advance: isEdit ? 'Edit Employee Pay' : 'Add Employee Pay'
  };
  document.getElementById('addItemTitle').textContent = titles[type];
  let html='';
  if (type==='revenue') {
    html=`<div class="form-group"><label class="form-label">Description</label><input class="form-input" id="ai_label" placeholder="e.g. 4/26 labor + materials" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Amount ($)</label><input class="form-input" id="ai_amount" type="number" step="0.01" placeholder="0.00" /></div>
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="ai_date" type="date" value="${today()}" /></div>
      </div>`;
  } else if (type==='addon') {
    html=`<div class="form-group"><label class="form-label">Description</label><input class="form-input" id="ai_label" placeholder="e.g. Extra electrical work" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Amount ($)</label><input class="form-input" id="ai_amount" type="number" step="0.01" placeholder="0.00" /></div>
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="ai_date" type="date" value="${today()}" /></div>
      </div>`;
  } else if (type==='hours') {
    const defaultRate = Number(job?.hourlyRate || 0);
    html=`<div class="form-group"><label class="form-label">Description / Note</label><input class="form-input" id="ai_label" placeholder="e.g. Demo + trim install" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Hours</label><input class="form-input" id="ai_hours" type="number" step="0.25" min="0" placeholder="0.00" oninput="updateHoursAddItemTotal()" /></div>
        <div class="form-group"><label class="form-label">Rate ($/hr)</label><input class="form-input" id="ai_rate" type="number" step="0.01" min="0" placeholder="0.00" value="${defaultRate > 0 ? defaultRate.toFixed(2) : ''}" oninput="updateHoursAddItemTotal()" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Total ($)</label><input class="form-input" id="ai_amount" type="number" step="0.01" readonly /></div>
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="ai_date" type="date" value="${today()}" /></div>
      </div>`;
  } else if (type==='subtraction') {
    const subJob = state.jobs.find(j => j.id === jobId);
    const hasItems = subJob?.isItemized && subJob?.quoteItems?.length > 0;
    const usedSourceIds = (subJob?.subtractions||[]).filter(s => s.id !== itemId && s.sourceItemId).map(s => s.sourceItemId);
    const sourceHtml = hasItems ? `
      <div class="form-group"><label class="form-label">Line Item</label>
        <select class="form-input" id="ai_source" onchange="fillSubtractionFromItem()">
          <option value="">- Select a line item</option>
          ${(subJob.quoteItems).map(qi => {
            const used = usedSourceIds.includes(qi.id);
            return `<option value="${qi.id}"${used ? ' disabled' : ''}>${esc(qi.label)} (${fmt(qi.amount)})${used ? ' - already subtracted' : ''}</option>`;
          }).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <input type="checkbox" id="ai_manual" onchange="toggleManualSubtraction()" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" />
        <label for="ai_manual" style="cursor:pointer;font-family:var(--mono);font-size:14px;color:var(--text3);user-select:none">Manual entry (not a line item)</label>
      </div>` : '';
    html=sourceHtml+`<div class="form-group"><label class="form-label">Description</label><input class="form-input" id="ai_label" placeholder="e.g. Discount, returned materials..." /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Amount to subtract ($)</label><input class="form-input" id="ai_amount" type="number" step="0.01" placeholder="0.00" /></div>
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="ai_date" type="date" value="${today()}" /></div>
      </div>`;
  } else if (type==='material') {
    html=`<div class="form-group"><label class="form-label">Description</label><input class="form-input" id="ai_label" placeholder="e.g. Home Depot - lumber" /></div>
      <div class="form-group"><label class="form-label">Amount ($)</label><input class="form-input" id="ai_amount" type="number" step="0.01" placeholder="0.00" /></div>
      <div class="form-group"><label class="form-label">Purchased by</label>
        <select class="form-input" id="ai_who"><option value="owner">EHS</option><option value="emp">${en}</option></select>
      </div>
      <div class="unified-checkbox"><input type="checkbox" id="ai_billClient"${defaultBillClient ? ' checked' : ''} /><span>Bill this material to the client</span></div>`;
  } else if (type==='advance') {
    html=`<div class="form-group"><label class="form-label">Description / Note</label><input class="form-input" id="ai_label" placeholder="e.g. Weekly pay" /></div>
      <div class="form-group">
        <label class="form-label">Amount ($)</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="form-input" id="ai_amount" type="number" step="0.01" placeholder="0.00" />
          <button class="btn btn-ghost btn-sm" type="button" onclick="setAddItemAdvanceMax()" style="flex-shrink:0">Max</button>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="ai_date" type="date" value="${today()}" /></div>
        <div class="form-group"><label class="form-label">Type</label>
          <select class="form-input" id="ai_paytype">
            <option value="">General</option>
            <option value="advance">Advance</option>
            <option value="final">Final Pay</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>
      </div>`;
  }
  document.getElementById('addItemForm').innerHTML = html;
  if (isEdit) {
    const arr = type==='revenue' ? job?.revenueItems : (type==='addon' || type==='hours') ? job?.addOns : type==='subtraction' ? job?.subtractions : type==='material' ? job?.materials : job?.advances;
    const item = arr?.find(x => x.id === itemId);
    if (type === 'subtraction' && item?.appliedByPartial) {
      showAlert('This subtraction was applied by a partial payment and is locked.');
      return;
    }
    if (item) {
      document.getElementById('ai_label').value = item.label || '';
      document.getElementById('ai_amount').value = item.amount || '';
      if (type==='revenue'||type==='addon'||type==='hours'||type==='subtraction'||type==='advance') document.getElementById('ai_date').value = item.date || '';
      if (type==='hours') {
        document.getElementById('ai_hours').value = item.hours || '';
        document.getElementById('ai_rate').value = item.rate || '';
        updateHoursAddItemTotal();
      }
      if (type==='material') document.getElementById('ai_who').value = item.who || 'owner';
      if (type==='advance') document.getElementById('ai_paytype').value = item.payType || '';
      if (type === 'addon' && item.partialGroupId) {
        const parentAmt = item.partialParentAmount || item.amount || 0;
        const partLbl = item.partialState === 'remaining' ? 'Partial Left' : 'Partial Paid';
        const el = document.createElement('div');
        el.style.cssText = 'margin-top:10px;padding:10px 12px;border:1px solid var(--border2);border-radius:3px;background:var(--bg3);font-family:var(--mono);font-size:12px;color:var(--text2)';
        el.innerHTML = `
          <div style="margin-bottom:4px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3)">Split Breakdown</div>
          <div>${partLbl}: <strong>${fmt(item.amount || 0)}</strong></div>
          <div>Original addition: <strong>${fmt(parentAmt)}</strong></div>`;
        document.getElementById('addItemForm').appendChild(el);
      }
      if (type==='subtraction') {
        const sel = document.getElementById('ai_source');
        if (sel) {
          if (item.sourceItemId) {
            sel.value = item.sourceItemId;
            fillSubtractionFromItem();
          } else {
            document.getElementById('ai_manual').checked = true;
            toggleManualSubtraction();
          }
        }
      }
    }
  }
  if (type === 'hours' && !isEdit) updateHoursAddItemTotal();
  document.getElementById('addItemModal').classList.remove('hidden');
}
function setAddItemAdvanceMax() {
  if (!addItemContext || addItemContext.type !== 'advance') return;
  const { jobId, itemId } = addItemContext;
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  let maxAmount = Math.max(0, calcJob(job).empBalance);
  if (itemId) {
    const existing = (job.advances || []).find(x => x.id === itemId);
    if (existing) maxAmount += existing.amount || 0;
  }
  const input = document.getElementById('ai_amount');
  if (input) input.value = maxAmount > 0 ? maxAmount.toFixed(2) : '';
}
function updateHoursAddItemTotal() {
  const hrs = parseFloat(document.getElementById('ai_hours')?.value) || 0;
  const rate = parseFloat(document.getElementById('ai_rate')?.value) || 0;
  const amt = _roundMoney(hrs * rate);
  const amountEl = document.getElementById('ai_amount');
  if (amountEl) amountEl.value = amt > 0 ? amt.toFixed(2) : '';
}
function saveItem() {
  if (!addItemContext) return;
  const { jobId, type, itemId } = addItemContext;
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job) return;
  const isHourly = _jobType(job) === 'hourly';
  const label  = document.getElementById('ai_label')?.value.trim() || '';
  let amount = parseFloat(document.getElementById('ai_amount')?.value) || 0;
  let hours = 0;
  let rate = 0;
  if (type === 'hours') {
    hours = parseFloat(document.getElementById('ai_hours')?.value) || 0;
    rate = parseFloat(document.getElementById('ai_rate')?.value) || 0;
    amount = _roundMoney(hours * rate);
    if (hours <= 0 || rate <= 0 || amount <= 0) {
      showAlert('Please enter valid hours and hourly rate.');
      return;
    }
  } else if (type !== 'advance' && amount <= 0) {
    showAlert('Please enter a valid amount.');
    return;
  }
  if (type === 'advance' && Math.abs(amount) < 0.000001) {
    showAlert('Please enter a non-zero amount.');
    return;
  }
  if (isHourly && (type === 'revenue' || type === 'addon' || type === 'subtraction')) {
    showAlert('Hourly uses Hours + Materials only for client billing.');
    return;
  }
  if (type==='revenue') {
    const date = document.getElementById('ai_date')?.value||'';
    if (!job.revenueItems) job.revenueItems = [];
    if (itemId) {
      const item = job.revenueItems.find(x=>x.id===itemId);
      if (item) { item.label=label; item.amount=amount; item.date=date; }
    } else {
      job.revenueItems.push({ id:uid(), label, amount, date, status:'pending' });
    }
  } else if (type==='addon') {
    const date = document.getElementById('ai_date')?.value||'';
    if (itemId) {
      const item = job.addOns.find(x=>x.id===itemId);
      if (item) { item.label=label; item.amount=amount; item.date=date; item.isHours = false; item.hours = 0; item.rate = 0; }
    } else {
      job.addOns.push({ id:uid(), label, amount, date, status:'pending', isHours:false, hours:0, rate:0 });
    }
  } else if (type==='hours') {
    const date = document.getElementById('ai_date')?.value||'';
    if (itemId) {
      const item = job.addOns.find(x=>x.id===itemId);
      if (item) {
        item.label = label || 'Hours';
        item.amount = amount;
        item.date = date;
        item.isHours = true;
        item.hours = hours;
        item.rate = rate;
      }
    } else {
      job.addOns.push({
        id: uid(),
        label: label || 'Hours',
        amount,
        date,
        status: 'pending',
        isHours: true,
        hours,
        rate
      });
    }
  } else if (type==='subtraction') {
    const date = document.getElementById('ai_date')?.value||'';
    const sourceEl = document.getElementById('ai_source');
    const isManual = !sourceEl || document.getElementById('ai_manual')?.checked;
    const sourceItemId = (!isManual && sourceEl?.value) ? sourceEl.value : null;
    if (itemId) {
      const item = job.subtractions.find(x=>x.id===itemId);
      if (item?.appliedByPartial) { showAlert('This subtraction was applied by a partial payment and cannot be edited.'); return; }
      if (item) { item.label=label; item.amount=amount; item.date=date; item.sourceItemId=sourceItemId; }
    } else {
      job.subtractions.push({ id:uid(), label, amount, date, status:'pending', sourceItemId });
    }
  } else if (type==='material') {
    const who = document.getElementById('ai_who').value;
    const costAmount = amount;
    const billClient = document.getElementById('ai_billClient')?.checked !== false;
    const chargeAmount = billClient ? amount : 0;
    if (itemId) {
      const item = job.materials.find(x=>x.id===itemId);
      if (item) {
        item.label = label;
        item.amount = amount;
        item.who = who;
        item.billClient = billClient;
        item.chargeAmount = chargeAmount;
        item.costAmount = costAmount;
      }
    } else {
      job.materials.push({ id:uid(), label, amount, who, billClient, chargeAmount, costAmount: costAmount });
    }
  } else if (type==='advance') {
    const date = document.getElementById('ai_date')?.value||'';
    const payType = document.getElementById('ai_paytype')?.value||'';
    if (itemId) {
      const item = job.advances.find(x=>x.id===itemId);
      if (item) { item.label=label; item.amount=amount; item.date=date; item.payType=payType; }
    } else {
      job.advances.push({ id:uid(), label, amount, date, payType });
    }
  }
  save(); renderJobs(); closeModal('addItemModal');
}
function toggleManualSubtraction() {
  const manual = document.getElementById('ai_manual')?.checked;
  const sel = document.getElementById('ai_source');
  if (!sel) return;
  sel.disabled = manual;
  sel.style.opacity = manual ? '0.4' : '';
  if (manual) {
    sel.value = '';
    document.getElementById('ai_amount').readOnly = false;
    document.getElementById('ai_amount').style.opacity = '';
  } else {
    fillSubtractionFromItem();
  }
}
function fillSubtractionFromItem() {
  const sel = document.getElementById('ai_source');
  if (!sel || document.getElementById('ai_manual')?.checked) return;
  const qid = sel.value;
  const amtEl = document.getElementById('ai_amount');
  const lblEl = document.getElementById('ai_label');
  if (!qid) {
    amtEl.readOnly = false;
    amtEl.style.opacity = '';
    return;
  }
  const job = state.jobs.find(j => j.id === addItemContext?.jobId);
  const qi = (job?.quoteItems||[]).find(x => x.id === qid);
  if (!qi) return;
  lblEl.value = qi.label;
  amtEl.value = qi.amount;
  amtEl.readOnly = true;
  amtEl.style.opacity = '0.65';
}

// ─── QUOTE SNAPSHOT ───────────────────────────────────────────────────────────
function openQuoteSnapshot(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;

  const usedIds = (job.subtractions||[]).filter(s => s.sourceItemId).map(s => s.sourceItemId);
  const lineItemSubs = (job.subtractions||[]).filter(s => s.sourceItemId);
  const manualSubs   = (job.subtractions||[]).filter(s => !s.sourceItemId);
  const addOns       = job.addOns||[];

  const activeItemsTotal = (job.quoteItems||[]).filter(qi => !usedIds.includes(qi.id)).reduce((s,qi) => s+(qi.amount||0), 0);
  const addOnTotal       = addOns.reduce((s,a) => s+(a.amount||0), 0);
  const manualSubTotal   = manualSubs.reduce((s,a) => s+(a.amount||0), 0);
  const grandTotal       = activeItemsTotal + addOnTotal - manualSubTotal;

  const row = (label, value, opts={}) => {
    const {color='var(--text)', strikethrough=false, sub=''} = opts;
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:17px;${strikethrough?'text-decoration:line-through;color:var(--text3)':''}">${label}</span>
        <span style="font-family:var(--mono);font-size:17px;${strikethrough?'text-decoration:line-through;color:var(--text3)':'color:'+color}">${value}</span>
      </div>${sub ? `<div style="font-size:13px;font-family:var(--mono);color:var(--red);margin-top:4px">${sub}</div>` : ''}
    </div>`;
  };

  const lineItemsHtml = (job.quoteItems||[]).map(qi => {
    const sub = lineItemSubs.find(s => s.sourceItemId === qi.id);
    return sub
      ? row(esc(qi.label), fmt(qi.amount), { strikethrough:true, sub:`X Removed${sub.label ? ': ' + esc(sub.label) : ''}` })
      : row(esc(qi.label), fmt(qi.amount));
  }).join('');

  const sectionHead = (title) =>
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--text3);padding-bottom:6px;border-bottom:2px solid var(--border2);margin-bottom:2px">${title}</div>`;

  const addOnsHtml = addOns.length ? `<div style="margin-top:22px">${sectionHead('Additions')}${addOns.map(a=>row(esc(a.label),'+'+fmt(a.amount),{color:'var(--purple)'})).join('')}</div>` : '';
  const manualSubsHtml = manualSubs.length ? `<div style="margin-top:22px">${sectionHead('Deductions')}${manualSubs.map(a=>row(esc(a.label),'-'+fmt(a.amount),{color:'var(--red)'})).join('')}</div>` : '';

  document.getElementById('quoteSnapshotContent').innerHTML = `
    <div style="text-align:center;padding-bottom:20px;border-bottom:2px solid var(--accent);margin-bottom:24px">
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:0.2em;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Quote Snapshot</div>
      <div style="font-size:26px;font-weight:600;letter-spacing:0.02em">${esc(job.name)}</div>
      ${job.date ? `<div style="font-family:var(--mono);font-size:14px;color:var(--text3);margin-top:6px">${fmtDate(job.date)}</div>` : ''}
    </div>

    ${sectionHead('Scope of Work')}
    ${lineItemsHtml}
    <div style="display:flex;justify-content:space-between;padding:10px 0;margin-bottom:2px">
      <span style="font-family:var(--mono);font-size:14px;color:var(--text3)">Scope subtotal</span>
      <span style="font-family:var(--mono);font-size:14px;color:var(--text2)">${fmt(activeItemsTotal)}</span>
    </div>

    ${addOnsHtml}
    ${manualSubsHtml}

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding-top:18px;border-top:2px solid var(--accent)">
      <span style="font-family:var(--mono);font-size:15px;font-weight:600;color:var(--text2);letter-spacing:0.1em;text-transform:uppercase">Project Total</span>
      <span style="font-family:var(--mono);font-size:28px;font-weight:600;color:var(--accent)">${fmt(grandTotal)}</span>
    </div>`;

  document.getElementById('quoteSnapshotModal').classList.remove('hidden');
}
function printQuoteSnapshot() {
  const content = document.getElementById('quoteSnapshotContent').innerHTML;
  const win = window.open('', '_blank', 'width=600,height=800');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quote Snapshot</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'IBM Plex Sans', sans-serif; background:#fff; color:#111; padding:40px; max-width:520px; margin:0 auto; font-size:16px; }
    * { box-sizing:border-box; margin:0; padding:0; }
    span[style*="line-through"] { text-decoration:line-through; color:#999 !important; }
  </style></head><body>${content}</body></html>`);
  win.document.close();
  win.focus();
  win.onafterprint = function() { win.close(); };
  win.print();
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function settingsTab(name, btn) {
  document.querySelectorAll('#settingsModal .settings-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#settingsModal .settings-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('stab-' + name).classList.add('active');
  if (name === 'clients') _populateClientColSettings();
  if (name === 'square') refreshSquareAlerts();
}
function mySettingsTab(name, btn) {
  document.querySelectorAll('#mySettingsModal .settings-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#mySettingsModal .settings-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('mstab-' + name);
  if (panel) panel.classList.add('active');
  if (name === 'clients') _populateMyClientPrefs();
}
function _populateClientColSettings() {
  const expandCols = state.settings.clientExpandCols || CLIENT_COLS.map(c=>c.key);
  const quickCols  = state.settings.clientQuickCols  || [];
  const el1 = document.getElementById('s_expandColsList');
  const el2 = document.getElementById('s_quickColsList');
  if (el1) el1.innerHTML = CLIENT_COLS.map(col=>`
    <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;cursor:pointer">
      <input type="checkbox" ${expandCols.includes(col.key)?'checked':''} style="accent-color:var(--accent)"
        onchange="toggleClientExpandCol('${col.key}',this.checked)" />
      ${col.label}
    </label>`).join('');
  if (el2) el2.innerHTML = CLIENT_COLS.map(col=>`
    <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;cursor:pointer">
      <input type="checkbox" ${quickCols.includes(col.key)?'checked':''} style="accent-color:var(--accent)"
        onchange="toggleClientQuickCol('${col.key}',this.checked)" />
      ${col.label}
    </label>`).join('');
}
function toggleClientExpandCol(key, on) {
  let cols = [...(state.settings.clientExpandCols || CLIENT_COLS.map(c=>c.key))];
  if (on) { if (!cols.includes(key)) cols.push(key); }
  else { cols = cols.filter(k=>k!==key); }
  state.settings.clientExpandCols = cols;
  save(); renderClients();
}
function toggleClientQuickCol(key, on) {
  let cols = [...(state.settings.clientQuickCols || [])];
  if (on) { if (!cols.includes(key)) cols.push(key); }
  else { cols = cols.filter(k=>k!==key); }
  state.settings.clientQuickCols = cols;
  save();
}
function _populateMyClientPrefs() {
  const expandKeys = _clientExpandColsForView();
  const quickKeys = _clientQuickColsForView();
  const renderList = (containerId, activeKeys, toggleFn) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = CLIENT_COLS.map(col => `
      <label style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;cursor:pointer">
        <input type="checkbox" ${activeKeys.includes(col.key) ? 'checked' : ''} style="accent-color:var(--accent)"
          onchange="${toggleFn}('${col.key}',this.checked)" />
        ${col.label}
      </label>`).join('');
  };
  renderList('ms_expandColsList', expandKeys, 'toggleMyClientExpandCol');
  renderList('ms_quickColsList', quickKeys, 'toggleMyClientQuickCol');
}
function toggleMyClientExpandCol(key, on) {
  let cols = [..._clientExpandColsForView()];
  if (on) { if (!cols.includes(key)) cols.push(key); }
  else { cols = cols.filter(k => k !== key); }
  _writeClientPref('clientExpandCols', cols);
  save(); renderClients();
}
function toggleMyClientQuickCol(key, on) {
  let cols = [..._clientQuickColsForView()];
  if (on) { if (!cols.includes(key)) cols.push(key); }
  else { cols = cols.filter(k => k !== key); }
  _writeClientPref('clientQuickCols', cols);
  save();
}
function openSettings() {
  document.getElementById('s_feeRate').value         = +((state.settings.feeRate || 0.026) * 100).toFixed(3);
  document.getElementById('s_txnFee').value          = state.settings.txnFee ?? 0.30;
  document.getElementById('s_debtOriginal').value    = state.settings.debtOriginal || 2256.58;
  document.getElementById('s_debtOwnerShare').value  = Math.round((state.settings.debtOwnerShare || 0.50) * 100);
  document.getElementById('s_squareBaseUrl').value   = state.settings.square?.functionBaseUrl || '';
  document.getElementById('s_squareHighValue').value = state.settings.square?.highValueConfirmAmount || 1000;
  const debtEmp = getEmp(state.settings.debtEmployeeId);
  document.getElementById('s_debtHint').textContent  = debtEmp
    ? `Debt assigned to ${debtEmp.name}. Extra above their normal split counts toward debt.`
    : 'Extra above normal split counts toward debt.';
  // Populate default milestones
  document.getElementById('dmList').innerHTML = '';
  dmCount = 0;
  (state.settings.defaultMilestones || []).forEach(m => addDmField(m.label, m.pct));
  applyTheme();
  // Reset to Account tab
  settingsTab('employees', document.querySelector('#settingsModal .settings-nav-btn'));
  renderUserList();
  document.getElementById('nu_name').value = '';
  document.getElementById('nu_pin').value  = '';
  document.getElementById('nu_role').value = 'employee';
  document.getElementById('settingsModal').classList.remove('hidden');
  requestAnimationFrame(_initSettingsNavScroll);
}
function saveSettings() {
  state.settings.feeRate        = (parseFloat(document.getElementById('s_feeRate').value) || 2.6) / 100;
  state.settings.txnFee         = parseFloat(document.getElementById('s_txnFee').value) || 0;
  state.settings.debtOriginal   = parseFloat(document.getElementById('s_debtOriginal').value) || 0;
  state.settings.debtOwnerShare = (parseFloat(document.getElementById('s_debtOwnerShare').value) || 50) / 100;
  if (!state.settings.square || typeof state.settings.square !== 'object') state.settings.square = {};
  state.settings.square.functionBaseUrl = (document.getElementById('s_squareBaseUrl').value || '').trim().replace(/\/+$/,'');
  state.settings.square.highValueConfirmAmount = parseFloat(document.getElementById('s_squareHighValue').value) || 1000;
  const defaultMilestones = []; let dmTotal = 0;
  document.querySelectorAll('[id^="dmpct_"]').forEach((el, i) => {
    const pct = parseFloat(el.value) || 0;
    const dmId = el.id.slice('dmpct_'.length);
    const lbl = document.getElementById(`dmlabel_${dmId}`)?.value.trim() || `Milestone ${i+1}`;
    defaultMilestones.push({ label: lbl, pct }); dmTotal += pct;
  });
  if (defaultMilestones.length && Math.abs(dmTotal - 100) > 0.01) {
    showAlert(`Default milestones total ${dmTotal}% - must equal 100%.`); return;
  }
  state.settings.defaultMilestones = defaultMilestones;
  save(); renderAll(); closeModal('settingsModal');
}

function renderSquareAlerts(alerts = []) {
  const el = document.getElementById('squareAlertsList');
  if (!el) return;
  if (!alerts.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px">No active billing alerts.</div>';
    return;
  }
  el.innerHTML = alerts.map(a => `
    <div style="border:1px solid var(--border);background:var(--bg3);border-radius:3px;padding:8px 10px;margin-bottom:8px">
      <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:4px">${esc(a.status || 'alert')} ${a.type ? `| ${esc(a.type)}` : ''}</div>
      <div style="font-size:13px;color:var(--text2)">${esc(a.error?.message || a.eventType || a.objectId || 'See logs')}</div>
    </div>
  `).join('');
}

async function checkSquareHealth() {
  const out = document.getElementById('squareHealthOut');
  if (out) out.textContent = 'Checking...';
  try {
    const rsp = await callSquareFn('squareHealth', {});
    if (out) out.textContent = `env=${rsp.env} | enabled=${rsp.flags?.squareEnabled ? 'yes' : 'no'} | send=${rsp.flags?.squareSendEnabled ? 'yes' : 'no'}`;
  } catch (e) {
    if (out) out.textContent = `Error: ${e.message || 'failed'}`;
  }
}

async function refreshSquareAlerts() {
  const el = document.getElementById('squareAlertsList');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:13px">Loading alerts...</div>';
  try {
    const rsp = await callSquareFn('squareAlerts', { limit: 25 });
    renderSquareAlerts(rsp.alerts || []);
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);font-size:13px">Failed to load alerts: ${esc(e.message || 'unknown')}</div>`;
  }
}

async function runSquareReconcileNow() {
  const out = document.getElementById('squareHealthOut');
  if (out) out.textContent = 'Running reconcile...';
  try {
    const rsp = await callSquareFn('squareReconcileNow', {});
    if (out) out.textContent = `Reconciled ${rsp.checkedInvoices || 0} invoices, touched ${rsp.touchedItems || 0} items, errors ${rsp.errors || 0}.`;
    refreshSquareAlerts();
  } catch (e) {
    if (out) out.textContent = `Reconcile failed: ${e.message || 'unknown'}`;
  }
}
function openMySettings() {
  document.getElementById('ms_whoami').textContent = currentUser?.name || '';
  const splitEl = document.getElementById('ms_split');
  const emp = getEmp(currentUser?.id);
  if (splitEl) splitEl.textContent = `${Math.round((emp?.empShare ?? 0.66) * 100)}% split`;
  applyTheme();
  _populateMyClientPrefs();
  const firstTabBtn = document.querySelector('#mySettingsModal .settings-nav-btn');
  if (firstTabBtn) mySettingsTab('user', firstTabBtn);
  document.getElementById('mySettingsModal').classList.remove('hidden');
  requestAnimationFrame(_initSettingsNavScroll);
}

// ─── TABS & MODALS ────────────────────────────────────────────────────────────
function switchTab(name, el) {
  closeMobileMenu();
  closeDesktopMenu();
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'schedule') renderSchedule();
  if (name === 'homewatch') renderHomewatch();
  if (name === 'clients') renderClients();
  if (name === 'active' || name === 'complete' || name === 'all') renderSummary();
  else renderDebtPanel();
}
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function openDesktopMenu() {
  if (window.innerWidth <= 600) return;
  document.querySelector('.header-actions')?.classList.add('desktop-open');
}
function closeDesktopMenu() {
  document.querySelector('.header-actions')?.classList.remove('desktop-open');
}
function toggleDesktopMenu() {
  const actions = document.querySelector('.header-actions');
  if (!actions || window.innerWidth <= 600) return;
  if (actions.classList.contains('desktop-open')) closeDesktopMenu();
  else openDesktopMenu();
}
function openMobileMenu() {
  if (window.innerWidth > 600) return;
  document.querySelector('.header-actions')?.classList.add('open');
  document.getElementById('mobileMenuBackdrop')?.classList.add('open');
  const btn = document.getElementById('mobileMenuBtn');
  if (btn) {
    btn.classList.add('open');
    btn.innerHTML = jobIconSvg('close');
    btn.setAttribute('aria-label', 'Close menu');
    btn.setAttribute('aria-expanded', 'true');
  }
}
function closeMobileMenu() {
  document.querySelector('.header-actions')?.classList.remove('open');
  document.getElementById('mobileMenuBackdrop')?.classList.remove('open');
  const btn = document.getElementById('mobileMenuBtn');
  if (btn) {
    btn.classList.remove('open');
    btn.innerHTML = jobIconSvg('menu');
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-expanded', 'false');
  }
}
function toggleMobileMenu() {
  const actions = document.querySelector('.header-actions');
  if (!actions) return;
  if (actions.classList.contains('open')) closeMobileMenu();
  else openMobileMenu();
}

function showConfirm(msg, onOk, { title='Confirm', okLabel='Confirm', danger=true } = {}) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMsg').textContent   = msg;
  const okBtn = document.getElementById('confirmModalOk');
  okBtn.textContent  = okLabel;
  okBtn.className    = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  const cancelBtn = document.getElementById('confirmModalCancel');
  const cleanup = () => {
    okBtn.onclick     = null;
    cancelBtn.onclick = null;
    closeModal('confirmModal');
  };
  okBtn.onclick     = () => { cleanup(); onOk(); };
  cancelBtn.onclick = () => cleanup();
  document.getElementById('confirmModal').classList.remove('hidden');
}

function showAlert(msg, { title='', onClose=null } = {}) {
  const titleEl = document.getElementById('alertModalTitle');
  titleEl.textContent = title;
  titleEl.style.display = title ? '' : 'none';
  document.getElementById('alertModalMsg').textContent = msg;
  const okBtn = document.getElementById('alertModalOk');
  okBtn.onclick = () => { closeModal('alertModal'); if (onClose) onClose(); };
  document.getElementById('alertModal').classList.remove('hidden');
}

function openChangelog() { document.getElementById('changelogModal').classList.remove('hidden'); }
document.querySelectorAll('.modal-overlay').forEach(el=>{
  let _mdOnOverlay = false;
  el.addEventListener('mousedown', e=>{ _mdOnOverlay = e.target === el; });
  el.addEventListener('click', e=>{ if(_mdOnOverlay && e.target===el) el.classList.add('hidden'); });
});


// ─── LOGIN ────────────────────────────────────────────────────────────────────
function showLogin() {
  const overlay = document.getElementById('loginOverlay');
  const grid = document.getElementById('userPickGrid');
  overlay.style.display = 'flex';
  document.getElementById('loginPin').value = '';
  document.getElementById('loginError').textContent = '';

  // Try auto-login from localStorage (persistent) or sessionStorage (session)
  const saved = localStorage.getItem('ehs_user_persist') || sessionStorage.getItem('ehs_user');
  if (saved) {
    try {
      const u = JSON.parse(saved);
      const match = state.users.find(x => x.id === u.id);
      if (match) {
        currentUser = { id: match.id, name: match.name, isAdmin: match.isAdmin };
        overlay.style.display = 'none';
        applyUserView();
        renderAll();
        return;
      }
    } catch(e) {}
  }

  // Render user picker
  grid.innerHTML = state.users.map(u => `
    <div class="user-pick-btn" id="upick_${u.id}" onclick="selectUser('${u.id}')">${esc(u.name)}</div>
  `).join('');

  // Auto-select if only one user
  if (state.users.length === 1) selectUser(state.users[0].id);
}

let selectedLoginUserId = null;
function selectUser(id) {
  selectedLoginUserId = id;
  document.querySelectorAll('.user-pick-btn').forEach(b => b.classList.remove('selected'));
  const el = document.getElementById('upick_' + id);
  if (el) el.classList.add('selected');
  document.getElementById('loginPin').focus();
}

function doLogin() {
  if (!selectedLoginUserId) { document.getElementById('loginError').textContent = 'Please select your name.'; return; }
  const pin = document.getElementById('loginPin').value;
  const user = state.users.find(u => u.id === selectedLoginUserId);
  if (!user) return;
  if (user.pin !== pin) { document.getElementById('loginError').textContent = 'Incorrect PIN.'; document.getElementById('loginPin').value=''; return; }
  currentUser = { id: user.id, name: user.name, isAdmin: user.isAdmin };
  const keepIn = document.getElementById('keepLoggedIn');
  if (keepIn && keepIn.checked) {
    localStorage.setItem('ehs_user_persist', JSON.stringify(currentUser));
  } else {
    sessionStorage.setItem('ehs_user', JSON.stringify(currentUser));
  }
  document.getElementById('loginOverlay').style.display = 'none';
  applyUserView();
  renderAll();
}

function signOut() {
  currentUser = null;
  selectedLoginUserId = null;
  sessionStorage.removeItem('ehs_user');
  localStorage.removeItem('ehs_user_persist');
  applyTheme('default');
  showLogin();
}

function loadExpandedState() {
  try {
    const uid = currentUser?.id || 'default';
    expandedJobs = new Set(JSON.parse(localStorage.getItem(`exp_${uid}`)   || '[]'));
    if (expandedJobs.size > 1) {
      const latest = Array.from(expandedJobs).slice(-1);
      expandedJobs = new Set(latest);
    }
    expandedHW   = new Set(JSON.parse(localStorage.getItem(`expHW_${uid}`) || '[]'));
  } catch(e) { expandedJobs = new Set(); expandedHW = new Set(); }
}
function saveExpandedState() {
  try {
    const uid = currentUser?.id || 'default';
    localStorage.setItem(`exp_${uid}`,   JSON.stringify([...expandedJobs]));
    localStorage.setItem(`expHW_${uid}`, JSON.stringify([...expandedHW]));
  } catch(e) {}
}
function applyUserView() {
  const isAdmin = currentUser && currentUser.isAdmin;
  loadExpandedState();
  loadUserUiState();
  applyTheme();
  requestAnimationFrame(_initTabsScroll);
  // Header elements
  const lbl = document.getElementById('headerUserLabel');
  const sob = document.getElementById('signOutBtn');
  if (lbl) { lbl.textContent = currentUser ? currentUser.name : ''; lbl.style.display = 'inline'; }
  if (sob) sob.style.display = 'inline-block';

  // Apply admin-only / employee-only visibility (never touches header-admin/header-emp)
  applyAdminClasses();

  // Header buttons: simple display toggle — applyAdminClasses() never touches these
  document.querySelectorAll('.header-admin').forEach(el => { el.style.display = isAdmin ? '' : 'none'; });
  document.querySelectorAll('.header-emp').forEach(el => { el.style.display = isAdmin ? 'none' : ''; });
  const menuDivider = document.getElementById('headerMenuDivider');
  if (menuDivider) menuDivider.style.display = isAdmin ? '' : 'none';

  // All tabs visible for everyone; debt/summary panels are admin-only
  document.getElementById('summaryCards').style.display    = isAdmin ? '' : 'none';
  document.getElementById('empSummaryCards').style.display = isAdmin ? 'none' : '';
  document.getElementById('debtPanel').style.display       = isAdmin ? '' : 'none';

  if (!isAdmin) {
    switchTab('active', document.querySelector('.job-tab'));
  }
}

function renderAll() {
  renderJobs();
  if (document.getElementById('tab-schedule').classList.contains('active')) renderSchedule();
  if (document.getElementById('tab-homewatch').classList.contains('active')) renderHomewatch();
  if (document.getElementById('tab-clients').classList.contains('active')) renderClients();
}

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────
function openUserMgmt() {
  openSettings();
  settingsTab('employees', document.querySelectorAll('#settingsModal .settings-nav-btn')[1]);
}

function renderUserList() {
  const users = state.users || [];
  document.getElementById('userList').innerHTML = users.length
    ? users.map(u => `
      <div class="user-row">
        <div>
          <div class="user-row-name">${esc(u.name)}</div>
          <span class="user-row-badge${u.isAdmin?'':' emp'}">${u.isAdmin ? 'Admin' : `Employee | ${Math.round((u.empShare??0.66)*100)}%`}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${!u.isAdmin ? `<button class="btn btn-ghost btn-sm job-icon-btn" onclick="openEditEmp('${u.id}')" title="Edit employee" aria-label="Edit employee">${jobIconSvg('edit')}</button>` : ''}
          ${u.isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="openResetPin('${u.id}')">Reset PIN</button>` : ''}
          ${!u.isAdmin || users.filter(x=>x.isAdmin).length > 1
            ? `<button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteUser('${u.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>`
            : ''}
        </div>
      </div>`).join('')
    : '<div style="color:var(--text3);font-size:14px">No users yet.</div>';
}

async function addUser() {
  const name = document.getElementById('nu_name').value.trim();
  const pin  = document.getElementById('nu_pin').value;
  const role = document.getElementById('nu_role').value;
  if (!name) { showAlert('Please enter a name.'); return; }
  if (!pin)  { showAlert('Please set a PIN.'); return; }
  if ((state.users||[]).find(u => u.name.toLowerCase() === name.toLowerCase())) {
    showAlert('A user with that name already exists.'); return;
  }
  if (!state.users) state.users = [];
  state.users.push({ id: uid(), name, pin, isAdmin: role === 'admin',
    ...(role !== 'admin' ? { empShare: 0.66 } : {}) });
  await save();
  renderUserList();
  document.getElementById('nu_name').value = '';
  document.getElementById('nu_pin').value = '';
}

async function deleteUser(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  if (u.id === currentUser.id) { showAlert("You can't remove yourself."); return; }
  showConfirm(`Remove user "${u.name}"?`, async () => {
    state.users = state.users.filter(x => x.id !== id);
    await save();
    renderUserList();
  });
}

function openResetPin(userId) {
  resetPinUserId = userId;
  const u = state.users.find(x => x.id === userId);
  document.getElementById('resetPinLabel').textContent = `New PIN for ${u ? u.name : 'user'}`;
  document.getElementById('rp_pin').value = '';
  document.getElementById('resetPinModal').classList.remove('hidden');
}

async function doResetPin() {
  const pin = document.getElementById('rp_pin').value;
  if (!pin) { showAlert('Please enter a PIN.'); return; }
  const u = state.users.find(x => x.id === resetPinUserId);
  if (!u) return;
  u.pin = pin;
  await save();
  closeModal('resetPinModal');
  renderUserList();
}

let editEmpId = null;
function openEditEmp(userId) {
  const u = state.users.find(x => x.id === userId);
  if (!u) return;
  editEmpId = userId;
  document.getElementById('empEditTitle').textContent = `Edit - ${esc(u.name)}`;
  document.getElementById('ee_name').value  = u.name;
  document.getElementById('ee_share').value = Math.round((u.empShare ?? 0.66) * 100);
  const isDebtEmp = state.settings.debtEmployeeId === userId;
  const otherEmps = state.users.filter(x => !x.isAdmin && x.id !== userId);
  document.getElementById('ee_debtInfo').innerHTML = isDebtEmp
    ? `<span style="color:var(--accent)">Startup debt assigned to this employee.</span>${otherEmps.length ? ` <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="reassignDebt('${userId}',null)">Reassign</button>` : ''}`
    : `<span style="color:var(--text3)">No startup debt assigned.</span>${state.settings.debtOriginal ? ` <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="reassignDebt(null,'${userId}')">Assign here</button>` : ''}`;
  document.getElementById('empEditModal').classList.remove('hidden');
}
async function saveEmpEdit() {
  const u = state.users.find(x => x.id === editEmpId);
  if (!u) return;
  const name  = document.getElementById('ee_name').value.trim();
  const sharePct = parseFloat(document.getElementById('ee_share').value);
  if (!name) { showAlert('Name required.'); return; }
  if (isNaN(sharePct) || sharePct < 1 || sharePct > 99) { showAlert('Share must be between 1% and 99%.'); return; }
  u.name = name; u.empShare = sharePct / 100;
  await save(); closeModal('empEditModal'); renderUserList(); renderAll();
}
async function reassignDebt(fromId, toId) {
  if (toId) {
    const target = state.users.find(u => u.id === toId);
    if (target) {
      showConfirm(`Assign startup debt to ${target.name}?`, async () => {
        state.settings.debtEmployeeId = target.id;
        await save(); openEditEmp(editEmpId);
      });
    }
  } else if (fromId) {
    const others = state.users.filter(u => !u.isAdmin && u.id !== fromId);
    if (others.length === 1) {
      showConfirm(`Reassign debt to ${others[0].name}?`, async () => {
        state.settings.debtEmployeeId = others[0].id;
        await save(); openEditEmp(fromId);
      });
    } else if (others.length > 1) {
      showAlert('Multiple employees - use the Edit button on the target employee to assign debt there.');
    }
  }
}

function openChangePin() {
  document.getElementById('cp_old').value = '';
  document.getElementById('cp_new').value = '';
  document.getElementById('cp_confirm').value = '';
  document.getElementById('changePinModal').classList.remove('hidden');
}

async function doChangePin() {
  const old = document.getElementById('cp_old').value;
  const nw  = document.getElementById('cp_new').value;
  const conf= document.getElementById('cp_confirm').value;
  const u = state.users.find(x => x.id === currentUser.id);
  if (!u) return;
  if (u.pin !== old) { showAlert('Current PIN is incorrect.'); return; }
  if (!nw) { showAlert('Please enter a new PIN.'); return; }
  if (nw !== conf) { showAlert('New PINs do not match.'); return; }
  u.pin = nw;
  await save();
  closeModal('changePinModal');
  showAlert('PIN updated!');
}

// ─── SCHEDULE ─────────────────────────────────────────────────────────────────
// Generate synthetic HW payment calendar entries for a given year/month.
// Each active (or paused) client gets an entry on the same day-of-month as their startDate.
function hwCalEntries(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const result = [];
  (state.homewatch || []).forEach(hw => {
    if (!hw.startDate) return;
    const payDay = Math.min(new Date(hw.startDate + 'T00:00:00').getDate(), daysInMonth);
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(payDay).padStart(2,'0')}`;
    result.push({ id: `hw_${hw.id}_${dateStr}`, type: 'hw', hwId: hw.id,
      clientName: hw.name, monthlyRate: hw.monthlyRate, date: dateStr, paused: hw.status === 'paused' });
  });
  return result;
}

function goToHW(hwId) {
  expandedHW.clear();
  expandedHW.add(hwId);
  saveExpandedState();
  const hwTab = document.querySelector('.tab[onclick*="homewatch"]');
  if (hwTab) switchTab('homewatch', hwTab);
}

function renderSchedule() {
  const el = document.getElementById('scheduleContent');
  if (!el) return;
  const appts = (state.appointments || []).slice().sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  const isAdmin = currentUser && currentUser.isAdmin;

  el.innerHTML = `
    <div class="sched-toolbar">
      <div class="sched-view-toggle">
        <button class="sched-view-btn${schedView==='list'?' active':''}" onclick="setSchedView('list')">List</button>
        <button class="sched-view-btn${schedView==='month'?' active':''}" onclick="setSchedView('month')">Month</button>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openAppt()">+ Appointment</button>
    </div>
    <div id="schedViewContent"></div>
  `;

  renderSchedView(appts);
}

function setSchedView(v) {
  if (v !== 'list' || !selectedDayFilter) selectedDayFilter = null;
  schedView = v;
  saveScheduleUiState();
  const appts = (state.appointments || []).slice().sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  document.querySelectorAll('.sched-view-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === v));
  renderSchedView(appts);
}

function renderSchedView(appts) {
  const el = document.getElementById('schedViewContent');
  if (!el) return;
  if (schedView === 'list') el.innerHTML = renderListView(appts);
  else el.innerHTML = renderMonthView(appts);
}

function renderListView(appts) {
  const todayStr = today();
  const todayDate = new Date(todayStr + 'T00:00:00');
  const dayHeader = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    const day = Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-US', { weekday: 'long' });
    return `<div style="margin-top:14px;margin-bottom:8px;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3)">${day ? `${day} | ` : ''}${fmtDate(dateStr)}</div>`;
  };
  const renderGroupedByDate = (items, isPast) => {
    let html = '';
    let lastDate = '';
    items.forEach(a => {
      const dateKey = a.date || '';
      if (dateKey !== lastDate) {
        html += dayHeader(dateKey);
        lastDate = dateKey;
      }
      html += apptCard(a, isPast);
    });
    return html;
  };

  // Merge HW recurring entries for a 5-month window (1 past + current + 3 ahead)
  const allAppts = [...appts];
  for (let offset = -1; offset <= 3; offset++) {
    const d = new Date(todayDate.getFullYear(), todayDate.getMonth() + offset, 1);
    hwCalEntries(d.getFullYear(), d.getMonth()).forEach(e => allAppts.push(e));
  }
  allAppts.sort((a, b) => a.date.localeCompare(b.date));

  // Card renderer handles both regular appointments and HW entries
  const apptCard = (a, isPast) => a.type === 'hw' ? `
    <div class="appt-card hw-appt${isPast?' past':''}">
      <div style="flex:1;min-width:0">
        <div class="appt-name" style="display:flex;align-items:center;gap:6px">${esc(a.clientName)}${a.clientName && clientByName(a.clientName) ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;flex-shrink:0" onclick="event.stopPropagation();openClientQuick('${esc(a.clientName)}')" title="View Client">${jobIconSvg('client')}</button>` : ''}</div>
        <div class="appt-meta">
          <span style="color:var(--purple)">HomeWatch${a.paused?' | Paused':''}</span>
          <span>${fmt(a.monthlyRate)}/mo</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" style="color:var(--purple);border-color:var(--purple)" onclick="goToHW('${a.hwId}')">View</button>
    </div>` : `
    <div class="appt-card${isPast?' past':''}">
      <div style="flex:1;min-width:0">
        <div class="appt-name" style="display:flex;align-items:center;gap:6px">${esc(a.clientName||'')}${a.clientName && clientByName(a.clientName) ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;flex-shrink:0" onclick="event.stopPropagation();openClientQuick('${esc(a.clientName)}')" title="View Client">${jobIconSvg('client')}</button>` : ''}</div>
        ${a.contactName ? `<div style="font-size:13px;color:var(--blue);margin-top:2px;font-family:var(--mono);display:flex;align-items:center;gap:6px">via ${esc(a.contactName)}${clientByName(a.contactName) ? ` <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px" onclick="event.stopPropagation();openClientQuick('${esc(a.contactName)}')" title="View Client">${jobIconSvg('client')}</button>` : ''}</div>` : ''}
        <div class="appt-meta">
          ${fmtTimeRange(a.time, a.endTime)?`<span class="icon-inline">${jobIconSvg('time')} ${fmtTimeRange(a.time, a.endTime)}</span>`:''}
          ${a.address?`<span class="icon-inline">${jobIconSvg('location')} ${esc(a.address)}</span>`:''}
        </div>
        ${a.notes?`<div class="appt-notes">${esc(a.notes)}</div>`:''}
      </div>
      <div class="appt-actions">
        <button class="btn btn-ghost btn-sm job-icon-btn" onclick="openAppt('${a.id}')" title="Edit appointment" aria-label="Edit appointment">${jobIconSvg('edit')}</button>
        <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteAppt('${a.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
      </div>
    </div>`;

  // Mobile day filter: show only that day with a back button
  if (selectedDayFilter) {
    const dayAppts = allAppts.filter(a => a.endDate ? (a.date <= selectedDayFilter && a.endDate >= selectedDayFilter) : a.date === selectedDayFilter);
    const backBtn = `<button class="btn btn-ghost btn-sm" style="margin-bottom:14px" onclick="selectedDayFilter=null;setSchedView('month')">< Back to calendar</button>`;
    const header = `<div style="font-family:var(--mono);font-size:13px;color:var(--text3);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.08em">${fmtDate(selectedDayFilter)}</div>`;
    const cards = dayAppts.length
      ? dayAppts.map(a => apptCard(a, false)).join('')
      : '<div class="no-appts">No appointments on this day.</div>';
    return backBtn + header + cards + '<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="openApptOnDate(\'' + selectedDayFilter + '\')">+ Add on this day</button>';
  }

  const upcoming = allAppts.filter(a => (a.endDate || a.date) >= todayStr);
  const past     = allAppts.filter(a => (a.endDate || a.date) < todayStr).reverse();

  const upcomingHtml = upcoming.length ? renderGroupedByDate(upcoming, false) : '';
  const pastHtml     = past.length     ? renderGroupedByDate(past, true)     : '';

  return `
    ${upcomingHtml || `<div class="no-appts icon-inline">${jobIconSvg('calendar')} No upcoming appointments.<br>Tap + Appointment to add one.</div>`}
    ${pastHtml ? `
      <div style="margin-top:24px;margin-bottom:12px;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3)">Past</div>
      ${pastHtml}` : ''}
  `;
}

function renderMonthView(appts) {
  const year = calYear, month = calMonth;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const todayStr = today();

  // Build appt lookup by date (multi-day appts appear on each day in their range)
  const byDate = {};
  appts.forEach(a => {
    getApptDates(a).forEach(d => { if (!byDate[d]) byDate[d] = []; byDate[d].push(a); });
  });
  // Inject recurring HW payment entries
  hwCalEntries(year, month).forEach(e => { if (!byDate[e.date]) byDate[e.date] = []; byDate[e.date].push(e); });

  const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let cells = '';

  // Prev month fill
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells += `<div class="cal-cell other-month"><div class="cal-day-num">${d}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayAppts = byDate[dateStr] || [];
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedCalDay;
    const pills = dayAppts.slice(0,3).map(a => {
      if (a.type === 'hw') return `<div class="cal-hw-pill${a.paused?' hw-paused':''}" onclick="event.stopPropagation();goToHW('${a.hwId}')" title="${esc(a.clientName)} - ${fmt(a.monthlyRate)}/mo${a.paused?' (Paused)':''}">${esc(a.clientName)}</div>`;
      const isStart = a.date === dateStr;
      const isCont  = !isStart && a.endDate;
      return `<div class="cal-appt-pill${isCont?' cal-appt-cont':''}" onclick="event.stopPropagation();openAppt('${a.id}')" title="${esc(a.clientName||'Appt')}">${isCont?'-> ':''}${esc(a.clientName||'Appt')}</div>`;
    }).join('');
    const more = dayAppts.length > 3 ? `<div class="cal-more">+${dayAppts.length-3} more</div>` : '';
    cells += `<div class="cal-cell${isToday?' today':''}${dayAppts.length?' has-appts':''}${isSelected?' selected':''}"
      onclick="selectCalDay('${dateStr}')" style="${isSelected?'border-color:var(--accent)':''}">
      <div class="cal-day-num">${d}</div>
      ${pills}${more}
    </div>`;
  }

  // Next month fill
  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    cells += `<div class="cal-cell other-month"><div class="cal-day-num">${d}</div></div>`;
  }

  // Day drawer
  let drawer = '';
  if (selectedCalDay) {
    const dayAppts = byDate[selectedCalDay] || [];
    drawer = `
      <div class="day-drawer">
        <div class="day-drawer-title">${fmtDate(selectedCalDay)}${dayAppts.length===0?' - No appointments':''}</div>
        ${dayAppts.map(a => a.type === 'hw' ? `
          <div class="appt-card hw-appt${a.paused?' past':''}" style="margin-bottom:8px">
            <div style="flex:1;min-width:0">
              <div class="appt-name">${esc(a.clientName)}</div>
              <div class="appt-meta">
                <span style="color:var(--purple)">HomeWatch${a.paused?' | Paused':''}</span>
                <span>${fmt(a.monthlyRate)}/mo</span>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" style="color:var(--purple);border-color:var(--purple)" onclick="goToHW('${a.hwId}')">View</button>
          </div>` : `
          <div class="appt-card" style="margin-bottom:8px">
            <div style="flex:1">
              <div class="appt-name">${esc(a.clientName||'')}</div>
              <div class="appt-meta">
                ${a.endDate?`<span class="icon-inline">${jobIconSvg('calendar')} ${fmtDate(a.date)} - ${fmtDate(a.endDate)}</span>`:''}
                ${fmtTimeRange(a.time, a.endTime)?`<span class="icon-inline">${jobIconSvg('time')} ${fmtTimeRange(a.time, a.endTime)}</span>`:''}
                ${a.address?`<span class="icon-inline">${jobIconSvg('location')} ${esc(a.address)}</span>`:''}
              </div>
              ${a.notes?`<div class="appt-notes">${esc(a.notes)}</div>`:''}
            </div>
            <div class="appt-actions">
              <button class="btn btn-ghost btn-sm job-icon-btn" onclick="openAppt('${a.id}')" title="Edit appointment" aria-label="Edit appointment">${jobIconSvg('edit')}</button>
              <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteAppt('${a.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
            </div>
          </div>`).join('')}
        <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="openApptOnDate('${selectedCalDay}')">+ Add on this day</button>
      </div>`;
  }

  return `
    <div class="cal-nav">
      <button class="btn btn-ghost btn-sm" onclick="changeMonth(-1)">< Prev</button>
      <div class="cal-month-label">${monthNames[month]} ${year}</div>
      <button class="btn btn-ghost btn-sm" onclick="changeMonth(1)">Next ></button>
    </div>
    <div class="cal-grid">
      ${dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>
    ${drawer}
  `;
}

function selectCalDay(dateStr) {
  // On mobile, switch to list view filtered to that day instead of drawer
  if (window.innerWidth <= 600) {
    selectedCalDay = dateStr;
    schedView = 'list';
    selectedDayFilter = dateStr;
    saveScheduleUiState();
    document.querySelectorAll('.sched-view-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === 'list'));
    const appts = (state.appointments||[]).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    renderSchedView(appts);
    return;
  }
  selectedCalDay = selectedCalDay === dateStr ? null : dateStr;
  saveScheduleUiState();
  const appts = (state.appointments||[]).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  renderSchedView(appts);
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  selectedCalDay = null;
  saveScheduleUiState();
  const appts = (state.appointments||[]).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  renderSchedView(appts);
}

function fmtTime(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2,'0')} ${ampm}`;
}
function fmtTimeRange(start, end) {
  const s = fmtTime(start);
  const e = fmtTime(end);
  if (s && e) return `${s} - ${e}`;
  return s || '';
}

// ─── APPOINTMENT CRUD ─────────────────────────────────────────────────────────
function getApptDates(a) {
  if (!a.allDay || !a.endDate || a.endDate <= a.date) return [a.date];
  const dates = [];
  const end = new Date(a.endDate + 'T00:00:00');
  let cur = new Date(a.date + 'T00:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function openAppt(id) {
  editingApptId = id || null;
  const appt = id ? (state.appointments||[]).find(a=>a.id===id) : null;
  document.getElementById('apptModalTitle').textContent = appt ? 'Edit Appointment' : 'New Appointment';
  document.getElementById('ap_name').value    = appt ? (appt.clientName||'') : '';
  document.getElementById('ap_contact').value = appt ? (appt.contactName||'') : '';
  document.getElementById('ap_date').value     = appt ? (appt.date||'') : today();
  document.getElementById('ap_time').value     = appt ? (appt.time||'') : '';
  document.getElementById('ap_endTime').value  = appt ? (appt.endTime||'') : '';
  document.getElementById('ap_endTime').dataset.manual = appt && appt.endTime ? 'true' : 'false';
  document.getElementById('ap_endDate').value  = appt ? (appt.endDate||'') : '';
  document.getElementById('ap_address').value  = appt ? (appt.address||'') : '';
  document.getElementById('ap_notes').value    = appt ? (appt.notes||'') : '';
  document.getElementById('ap_allDay').checked = appt ? !!appt.allDay : false;
  toggleApptAllDay();
  if (!appt) onApptStartTimeChange();
  document.getElementById('apptModal').classList.remove('hidden');
}

function _addOneHourTimeStr(t) {
  const [hh, mm] = String(t || '').split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
  const mins = (hh * 60 + mm + 60) % (24 * 60);
  const h2 = Math.floor(mins / 60);
  const m2 = mins % 60;
  return `${String(h2).padStart(2,'0')}:${String(m2).padStart(2,'0')}`;
}
function markApptEndTimeManual() {
  const endEl = document.getElementById('ap_endTime');
  if (!endEl) return;
  endEl.dataset.manual = endEl.value ? 'true' : 'false';
}
function onApptStartTimeChange() {
  const allDay = document.getElementById('ap_allDay')?.checked;
  const startEl = document.getElementById('ap_time');
  const endEl = document.getElementById('ap_endTime');
  if (!startEl || !endEl || allDay) return;
  if (!startEl.value) return;
  if (endEl.dataset.manual === 'true' && endEl.value) return;
  endEl.value = _addOneHourTimeStr(startEl.value);
  endEl.dataset.manual = 'false';
}

function toggleApptAllDay() {
  const allDay = document.getElementById('ap_allDay').checked;
  const timeRow = document.getElementById('ap_timeRow');
  const timeEl = document.getElementById('ap_time');
  const endTimeEl = document.getElementById('ap_endTime');
  const endEl  = document.getElementById('ap_endDate');
  const label  = document.getElementById('ap_timeLabel');
  if (timeRow) timeRow.style.display = allDay ? 'none' : 'grid';
  endEl.style.display   = allDay ? '' : 'none';
  label.textContent     = allDay ? 'End date' : 'Time';
  if (allDay) {
    timeEl.value = '';
    endTimeEl.value = '';
    endTimeEl.dataset.manual = 'false';
    if (!endEl.value) endEl.value = document.getElementById('ap_date').value || '';
  } else {
    endEl.value = '';
    onApptStartTimeChange();
  }
}
function openApptOnDate(dateStr) {
  openAppt();
  document.getElementById('ap_date').value = dateStr;
}

async function saveAppt() {
  const clientName = document.getElementById('ap_name').value.trim();
  const date       = document.getElementById('ap_date').value;
  if (!clientName) { showAlert('Please enter a client name.'); return; }
  if (!date)       { showAlert('Please select a date.'); return; }
  const allDay = document.getElementById('ap_allDay').checked;
  const startTime = document.getElementById('ap_time').value;
  const endTime = document.getElementById('ap_endTime').value;
  const rawEnd = document.getElementById('ap_endDate').value;
  const endDate = (allDay && rawEnd && rawEnd > date) ? rawEnd : null;
  if (!allDay && endTime && !startTime) {
    showAlert('Please set a start time when using an end time.');
    return;
  }
  if (!allDay && startTime && endTime && endTime <= startTime) {
    showAlert('End time must be later than start time.');
    return;
  }
  const appt = {
    clientName,
    contactName: document.getElementById('ap_contact').value.trim(),
    date,
    allDay,
    endDate:  endDate || null,
    time:     allDay ? '' : startTime,
    endTime:  allDay ? '' : endTime,
    address:  document.getElementById('ap_address').value.trim(),
    notes:    document.getElementById('ap_notes').value.trim(),
    createdBy: currentUser ? currentUser.id : ''
  };
  if (!state.appointments) state.appointments = [];
  if (editingApptId) {
    const idx = state.appointments.findIndex(a=>a.id===editingApptId);
    if (idx>=0) state.appointments[idx] = { ...state.appointments[idx], ...appt };
  } else {
    state.appointments.push({ id: uid(), ...appt });
  }
  await save();
  closeModal('apptModal');
  renderSchedule();
}

async function deleteAppt(id) {
  showConfirm('Delete this appointment?', async () => {
    state.appointments = (state.appointments||[]).filter(a=>a.id!==id);
    await save();
    renderSchedule();
  });
}

// ─── EXPORT / IMPORT ──────────────────────────────────────────────────────────
function exportData() {
  const filename = `ehs-tracker-backup-${today()}.json`;
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  showConfirm(`Import "${file.name}"? This will overwrite all current data.`, () => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported.jobs) || !imported.settings || typeof imported.settings !== 'object') throw new Error('Invalid backup file.');
        state = migrateState(imported);
        await save();
        renderAll();
        showAlert('Import successful!');
      } catch(err) {
        showAlert('Import failed: ' + err.message);
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  }, { okLabel: 'Import', danger: true });
  event.target.value = '';
}

// ─── CLIENTS ──────────────────────────────────────────────────────────────────
const CLIENT_COLS = [
  { key:'company',       label:'Company' },
  { key:'email',         label:'Email' },
  { key:'phone',         label:'Phone' },
  { key:'address1',      label:'Address' },
  { key:'city',          label:'City' },
  { key:'state',         label:'State' },
  { key:'postal',        label:'Zip' },
  { key:'birthday',      label:'Birthday' },
  { key:'txCount',       label:'# Visits' },
  { key:'lifetimeSpend', label:'Lifetime $' },
  { key:'firstVisit',    label:'First Visit' },
  { key:'lastVisit',     label:'Last Visit' },
  { key:'emailSubStatus',label:'Email Sub' },
  { key:'memo',          label:'Square Memo' },
];
const CLIENT_DEFAULT_COLS = ['email','phone','city','lastVisit','lifetimeSpend'];
const CLIENT_DIFF_FIELDS  = ['firstName','surname','company','email','phone','address1','address2','city','state','postal','birthday','memo','emailSubStatus','firstVisit','lastVisit','txCount','lifetimeSpend'];
const CLIENT_FIELD_LABELS = { firstName:'First Name', surname:'Last Name', company:'Company', email:'Email', phone:'Phone', address1:'Address 1', address2:'Address 2', city:'City', state:'State', postal:'Zip', birthday:'Birthday', memo:'Square Memo', emailSubStatus:'Email Sub', firstVisit:'First Visit', lastVisit:'Last Visit', txCount:'# Visits', lifetimeSpend:'Lifetime $' };

let clientConflictQueue = [];
let viewingClientId = null;
let pendingNewClientName = null;

function _getCurrentUserRecord() {
  const id = currentUser?.id;
  if (!id) return null;
  return (state.users || []).find(u => u.id === id) || null;
}
function _sanitizeClientKeys(keys) {
  if (!Array.isArray(keys)) return null;
  const allowed = new Set(CLIENT_COLS.map(c => c.key));
  return keys.filter(k => allowed.has(k));
}
function _readClientPref(prefKey, fallback) {
  if (!currentUser || currentUser.isAdmin) return fallback;
  const user = _getCurrentUserRecord();
  const raw = user?.clientPrefs?.[prefKey];
  const clean = _sanitizeClientKeys(raw);
  return clean === null ? fallback : clean;
}
function _writeClientPref(prefKey, keys) {
  const user = _getCurrentUserRecord();
  if (!user || user.isAdmin) return;
  if (!user.clientPrefs || typeof user.clientPrefs !== 'object') user.clientPrefs = {};
  user.clientPrefs[prefKey] = _sanitizeClientKeys(keys) || [];
  currentUser = user;
}
function _clientColumnsForView() {
  const base = state.settings.clientColumns && state.settings.clientColumns.length
    ? state.settings.clientColumns
    : CLIENT_DEFAULT_COLS;
  return _readClientPref('clientColumns', base);
}
function _clientExpandColsForView() {
  const base = state.settings.clientExpandCols || CLIENT_COLS.map(c=>c.key);
  return _readClientPref('clientExpandCols', base);
}
function _clientQuickColsForView() {
  const base = state.settings.clientQuickCols || [];
  return _readClientPref('clientQuickCols', base);
}

function parseCSVRobust(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], col = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i+1] === '"') { col += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { col += c; }
    } else {
      if (c === '"') { inQuote = true; }
      else if (c === ',') { row.push(col.trim()); col = ''; }
      else if (c === '\n') {
        row.push(col.trim()); col = '';
        if (row.some(v => v)) rows.push(row);
        row = [];
      } else { col += c; }
    }
  }
  if (col || row.length) { row.push(col.trim()); if (row.some(v => v)) rows.push(row); }
  return rows;
}

function squareRowToClient(headers, row) {
  const h = k => { const i = headers.indexOf(k); return i >= 0 ? (row[i]||'').trim() : ''; };
  return {
    id: uid(),
    squareId:      h('Square Customer ID'),
    refId:         h('Reference ID'),
    firstName:     h('First Name'),
    surname:       h('Surname'),
    company:       h('Company Name'),
    email:         h('Email Address'),
    phone:         h('Phone Number').replace(/^'/, ''),
    address1:      h('Street Address 1'),
    address2:      h('Street Address 2'),
    city:          h('City'),
    state:         h('State'),
    postal:        h('Postal Code'),
    birthday:      h('Birthday'),
    memo:          h('Memo'),
    emailSubStatus:h('Email Subscription Status'),
    firstVisit:    h('First Visit'),
    lastVisit:     h('Last Visit'),
    txCount:       parseInt(h('Transaction Count'))||0,
    lifetimeSpend: h('Lifetime spend').replace(/[$,]/g,''),
    clientNotes:   [],
  };
}

function triggerClientImport() { document.getElementById('clientCsvInput').click(); }

function handleClientCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => processClientImport(ev.target.result);
  reader.readAsText(file);
  e.target.value = '';
}

function processClientImport(text) {
  const rows = parseCSVRobust(text);
  if (rows.length < 2) { showAlert('No client data found in CSV.'); return; }
  const headers = rows[0];
  if (!headers.includes('Square Customer ID') && !headers.includes('First Name')) {
    showAlert("This doesn't look like a Square customer export. Please check the file."); return;
  }
  const incoming = rows.slice(1).filter(r => r.some(v=>v)).map(r => squareRowToClient(headers, r));
  if (!state.clients) state.clients = [];
  const conflicts = [], newClients = [];
  incoming.forEach(inc => {
    let existing = null;
    if (inc.squareId) existing = state.clients.find(c => c.squareId === inc.squareId);
    if (!existing && inc.email) existing = state.clients.find(c => c.email && c.email.toLowerCase() === inc.email.toLowerCase());
    if (!existing) {
      newClients.push(inc);
    } else {
      const changes = CLIENT_DIFF_FIELDS
        .filter(f => String(existing[f]??'') !== String(inc[f]??''))
        .map(f => ({ field:f, old:String(existing[f]??''), neo:String(inc[f]??''), chosen:'new' }));
      if (changes.length) conflicts.push({ existingId:existing.id, name:`${inc.firstName} ${inc.surname}`.trim()||inc.email, changes });
    }
  });
  newClients.forEach(c => state.clients.push(c));
  state.settings.clientsLastImport = today();
  if (conflicts.length > 0) {
    clientConflictQueue = conflicts;
    const added = newClients.length;
    document.getElementById('conflictModalTitle').textContent = 'Review Changes';
    document.getElementById('conflictModalSub').textContent =
      `${added} new client${added!==1?'s':''} added automatically. ${conflicts.length} existing record${conflicts.length!==1?' have':' has'} changed fields - review below.`;
    renderConflictBody();
    document.getElementById('clientConflictModal').classList.remove('hidden');
  } else {
    save(); renderClients();
    const parts = [];
    if (newClients.length) parts.push(`${newClients.length} new client${newClients.length>1?'s':''} added`);
    parts.push('No conflicts found');
    showAlert(parts.join('. ') + '.');
  }
}

function renderConflictBody() {
  document.getElementById('conflictModalBody').innerHTML = clientConflictQueue.map((conflict, ci) => `
    <div style="margin-bottom:22px">
      <div style="font-family:var(--mono);font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${esc(conflict.name)}</div>
      ${conflict.changes.map((ch, fi) => `
        <div class="conflict-row">
          <div class="conflict-field">${CLIENT_FIELD_LABELS[ch.field]||ch.field}</div>
          <div class="conflict-old">${ch.old ? esc(ch.old) : '<em style="opacity:0.5">empty</em>'}</div>
          <div class="conflict-new">${ch.neo ? esc(ch.neo) : '<em style="opacity:0.5">empty</em>'}</div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm ${ch.chosen==='keep'?'btn-primary':'btn-ghost'}" onclick="setConflictChoice(${ci},${fi},'keep')">Keep</button>
            <button class="btn btn-sm ${ch.chosen==='new'?'btn-primary':'btn-ghost'}"  onclick="setConflictChoice(${ci},${fi},'new')">New</button>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function setConflictChoice(ci, fi, choice) {
  clientConflictQueue[ci].changes[fi].chosen = choice;
  renderConflictBody();
}
function resolveAllConflicts(choice) {
  clientConflictQueue.forEach(c => c.changes.forEach(ch => ch.chosen = choice));
  renderConflictBody();
}
function applyConflictResolutions() {
  clientConflictQueue.forEach(conflict => {
    const client = state.clients.find(c => c.id === conflict.existingId);
    if (!client) return;
    conflict.changes.forEach(ch => { if (ch.chosen === 'new') client[ch.field] = ch.neo; });
  });
  clientConflictQueue = [];
  save(); closeModal('clientConflictModal'); renderClients();
}

function toggleColPanel() {
  const panel = document.getElementById('colTogglePanel');
  const open = panel.style.display !== 'none' && panel.style.display !== '';
  if (open) { panel.style.display = 'none'; return; }
  const visible = _clientColumnsForView();
  panel.innerHTML = CLIENT_COLS.map(col => `
    <label>
      <input type="checkbox" ${visible.includes(col.key)?'checked':''} onchange="toggleClientCol('${col.key}',this.checked)" style="accent-color:var(--accent);cursor:pointer" />
      ${col.label}
    </label>
  `).join('');
  panel.style.display = 'block';
}
document.addEventListener('click', e => {
  const wrap = document.querySelector('.col-toggle-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const p = document.getElementById('colTogglePanel');
    if (p) p.style.display = 'none';
  }
});

function toggleClientCol(key, on) {
  let cols = [..._clientColumnsForView()];
  if (on) { if (!cols.includes(key)) cols.push(key); }
  else { cols = cols.filter(k => k !== key); }
  if (currentUser?.isAdmin) state.settings.clientColumns = cols;
  else _writeClientPref('clientColumns', cols);
  save(); renderClients();
}

function formatPhone(p) {
  const d = (p||'').replace(/\D/g,'');
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p;
}

function renderClients() {
  if (!document.getElementById('tab-clients').classList.contains('active')) return;
  const clients = state.clients || [];
  const search = (document.getElementById('clientSearchInput')?.value || '').toLowerCase().trim();
  const filtered = search
    ? clients.filter(c => [c.firstName, c.surname, c.company, c.email, c.phone, c.city].some(v => v && v.toLowerCase().includes(search)))
    : clients;
  const cols = (() => {
    const visible = _clientColumnsForView();
    return CLIENT_COLS.filter(c => visible.includes(c.key));
  })();
  const expandColsSetting = _clientExpandColsForView();
  document.getElementById('clientCount').textContent = `${clients.length} Client${clients.length!==1?'s':''}`;
  const lastImport = state.settings.clientsLastImport;
  document.getElementById('clientsLastImport').textContent = lastImport ? `Last import: ${fmtDate(lastImport)}` : '';
  if (clients.length === 0) {
    document.getElementById('clientsList').innerHTML = `<div style="font-family:var(--mono);font-size:14px;color:var(--text3);padding:48px 0;text-align:center">No clients yet.<br><br><button class="btn btn-ghost btn-sm admin-only" onclick="triggerClientImport()">Import Square CSV</button></div>`;
    applyAdminClasses(); return;
  }
  const fmtVal = (c, key) => {
    const v = c[key];
    if (v === undefined || v === null || v === '') return `<span style="color:var(--text3)">-</span>`;
    if (key === 'lifetimeSpend') return `$${parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    if (key === 'firstVisit' || key === 'lastVisit') return fmtDate(v);
    if (key === 'phone') return formatPhone(v);
    if (key === 'txCount') return String(v);
    return esc(String(v));
  };
  const sorted = [...filtered].sort((a, b) => (a.firstName || '').localeCompare(b.firstName || ''));
  const colSpan = cols.length + 1; // name + visible cols
  document.getElementById('clientsList').innerHTML = `
    <div class="clients-table-wrap">
      <table class="clients-table">
        <thead><tr>
          <th>Name</th>
          ${cols.map(c=>`<th>${c.label}</th>`).join('')}
          <th style="width:24px"></th>
        </tr></thead>
        <tbody>
          ${sorted.map(c => {
            const name = [c.firstName, c.surname].filter(Boolean).join(' ') || c.company || c.email || '(unknown)';
            const sub  = c.company && (c.firstName||c.surname) ? `<br><span style="font-size:11px;color:var(--text3)">${esc(c.company)}</span>` : '';
            const note = (c.clientNotes||[]).length ? ` <span title="Has notes" style="color:var(--accent);display:inline-flex;align-items:center">${jobIconSvg('notes')}</span>` : '';
            const isExpanded = expandedClients.has(c.id);
            const expandCols = (() => {
              if (window.innerWidth <= 600) return CLIENT_COLS;
              const ec = expandColsSetting;
              if (!ec || !ec.length) return CLIENT_COLS;
              return CLIENT_COLS.filter(col => ec.includes(col.key));
            })();
            const allDetails = expandCols.map(col => {
              const v = c[col.key];
              if (v === undefined || v === null || v === '') return '';
              const fv = fmtVal(c, col.key);
              return `<div style="display:flex;flex-direction:column;gap:2px"><span style="font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em">${col.label}</span><span style="color:var(--text2);font-size:13px">${fv}</span></div>`;
            }).filter(Boolean).join('');
            const sqParts = [
              c.firstVisit    ? `First visit: ${fmtDate(c.firstVisit)}` : '',
              c.lastVisit     ? `Last visit: ${fmtDate(c.lastVisit)}` : '',
              c.txCount       ? `${c.txCount} visit${c.txCount!==1?'s':''}` : '',
              c.lifetimeSpend ? `$${parseFloat(c.lifetimeSpend).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} lifetime` : '',
            ].filter(Boolean).join(' | ');
            return `<tr class="client-row${isExpanded?' client-row-expanded':''}" id="crow_${c.id}" onclick="toggleClientExpand('${c.id}')">
              <td style="color:var(--text);font-weight:500">${esc(name)}${sub}${note}</td>
              ${cols.map(col=>`<td title="${esc(String(c[col.key]||''))}">${fmtVal(c,col.key)}</td>`).join('')}
              <td style="text-align:right;white-space:nowrap;color:var(--text3);font-size:11px;font-family:var(--mono);width:24px">${isExpanded?'^':'v'}</td>
            </tr>
            <tr class="client-expand-row" id="cexp_${c.id}" style="${isExpanded?'':'display:none'}">
              <td colspan="${cols.length + 2}" style="padding:0;border-bottom:1px solid var(--border)">
                <div style="padding:14px 16px;background:var(--bg2)">
                  ${sqParts ? `<div class="icon-inline" style="font-family:var(--mono);font-size:12px;color:var(--text3);padding:7px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;margin-bottom:8px">${jobIconSvg('chart')} ${sqParts}</div>` : ''}
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px 24px;margin-bottom:12px">
                    ${allDetails || '<span style="color:var(--text3);font-size:13px">No additional info.</span>'}
                  </div>
                  ${(() => {
                    const recentNotes = (c.clientNotes||[]).slice(-3).reverse();
                    const notesInlineHtml = recentNotes.length
                      ? `<div style="max-height:110px;overflow-y:auto;display:flex;flex-direction:column;gap:5px">
                          ${recentNotes.map(n=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:6px 10px">
                            <div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:2px">${esc(n.authorName)} | ${fmtDate(n.date)}</div>
                            <div style="font-size:12px;color:var(--text2);white-space:pre-wrap;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(n.text)}</div>
                          </div>`).join('')}
                        </div>`
                      : '<div style="font-size:12px;color:var(--text3)">No notes.</div>';
                    return `<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px;margin-bottom:10px">
                      <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);margin-bottom:6px">Notes (${(c.clientNotes||[]).length})</div>
                      ${notesInlineHtml}
                    </div>`;
                  })()}
                  <div style="display:flex;gap:8px;margin-top:8px;padding-top:10px;border-top:1px solid var(--border)">
                    <button class="btn btn-ghost btn-sm admin-only job-icon-btn" onclick="event.stopPropagation();openClientDetail('${c.id}')" title="Edit client" aria-label="Edit client">${jobIconSvg('edit')}</button>
                    <button class="btn btn-ghost btn-sm employee-only" onclick="event.stopPropagation();openClientDetail('${c.id}')">Notes</button>
                    <button class="btn btn-danger btn-sm btn-icon-only admin-only" onclick="event.stopPropagation();deleteClient('${c.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
                  </div>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  applyAdminClasses();
}

function toggleClientExpand(id) {
  const wasExpanded = expandedClients.has(id);
  expandedClients.clear();
  if (!wasExpanded) expandedClients.add(id);
  saveExpandedClientsState();
  renderClients();
}

let clientDetailIsNew = false;

function openClientDetail(id) {
  viewingClientId = id;
  clientDetailIsNew = false;
  const c = (state.clients||[]).find(cl=>cl.id===id);
  if (!c) return;
  _clientNotesSnapshot = JSON.parse(JSON.stringify(c.clientNotes || []));
  _editingNoteId = null;
  _renderClientDetailModal(c);
  document.getElementById('clientDetailModal').classList.remove('hidden');
  applyAdminClasses();
}

function openNewClientDetail(c) {
  viewingClientId = c.id;
  clientDetailIsNew = true;
  _clientNotesSnapshot = [];
  _editingNoteId = null;
  _renderClientDetailModal(c);
  document.getElementById('clientDetailModal').classList.remove('hidden');
  applyAdminClasses();
}

function _renderClientDetailModal(c) {
  const isAdmin = currentUser?.isAdmin;
  const name = [c.firstName, c.surname].filter(Boolean).join(' ') || c.company || c.email || 'New Client';
  document.getElementById('clientDetailName').textContent = name;
  const sqParts = [
    c.firstVisit    ? `First visit: ${fmtDate(c.firstVisit)}` : '',
    c.lastVisit     ? `Last visit: ${fmtDate(c.lastVisit)}` : '',
    c.txCount       ? `${c.txCount} visit${c.txCount!==1?'s':''}` : '',
    c.lifetimeSpend ? `$${parseFloat(c.lifetimeSpend).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} lifetime` : '',
  ].filter(Boolean).join(' | ');
  const id = c.id;
  const sqBar = sqParts ? `<div class="icon-inline" style="font-family:var(--mono);font-size:12px;color:var(--text3);margin-bottom:14px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px">${jobIconSvg('chart')} ${sqParts}</div>` : '';
  const notesSection = `
    <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
      <div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);margin-bottom:10px">Notes</div>
      <div id="clientNotesThread"></div>
      <div style="display:flex;gap:8px;margin-top:10px" id="clientNotesAddRow">
        <textarea class="form-input" id="clientNoteInput" rows="2" placeholder="Add a note..." style="flex:1;resize:none"></textarea>
        <button class="btn btn-ghost btn-sm" style="align-self:flex-end" onclick="addClientNote()">Add</button>
      </div>
    </div>`;
  if (isAdmin) {
    document.getElementById('clientDetailBody').innerHTML = `
      ${sqBar}
      <div class="form-row">
        <div class="form-group"><label class="form-label">First Name</label><input class="form-input" id="cd_firstName" value="${esc(c.firstName||'')}" oninput="_cdUpdateTitle()" /></div>
        <div class="form-group"><label class="form-label">Last Name</label><input class="form-input" id="cd_surname" value="${esc(c.surname||'')}" oninput="_cdUpdateTitle()" /></div>
      </div>
      <div class="form-group"><label class="form-label">Company</label><input class="form-input" id="cd_company" value="${esc(c.company||'')}" oninput="_cdUpdateTitle()" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="cd_email" type="email" value="${esc(c.email||'')}" /></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="cd_phone" type="tel" value="${esc(c.phone||'')}" /></div>
      </div>
      <div class="form-group">
        <label class="form-label">Address</label>
        <input class="form-input" id="cd_address1" value="${esc(c.address1||'')}" placeholder="Street address" style="margin-bottom:6px" />
        <input class="form-input" id="cd_address2" value="${esc(c.address2||'')}" placeholder="Suite, unit, etc." />
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">City</label><input class="form-input" id="cd_city" value="${esc(c.city||'')}" /></div>
        <div class="form-group"><label class="form-label">State</label><input class="form-input" id="cd_state" value="${esc(c.state||'')}" style="max-width:80px" /></div>
        <div class="form-group"><label class="form-label">Zip</label><input class="form-input" id="cd_postal" value="${esc(c.postal||'')}" style="max-width:110px" /></div>
      </div>
      <div class="form-group"><label class="form-label">Birthday</label><input class="form-input" id="cd_birthday" value="${esc(c.birthday||'')}" placeholder="e.g. 1985-06-15" style="max-width:160px" /></div>
      ${!clientDetailIsNew ? `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="syncClientToSquare('${id}')">Sync to Square API</button><button class="btn btn-ghost btn-sm" onclick="exportClientToSquare('${id}')">Export to Square CSV</button></div>` : ''}
      ${notesSection}
    `;
  } else {
    const ro = (label, val) => `<div><div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);margin-bottom:3px">${label}</div><div style="font-family:var(--mono);font-size:14px;color:var(--text2)">${esc(val||'-')}</div></div>`;
    document.getElementById('clientDetailBody').innerHTML = `
      ${sqBar}
      <div class="form-row">
        ${ro('First Name', c.firstName)}
        ${ro('Last Name', c.surname)}
      </div>
      ${ro('Company', c.company)}
      <div class="form-row" style="margin-top:10px">
        ${ro('Email', c.email)}
        ${ro('Phone', c.phone)}
      </div>
      <div style="margin-top:10px">${ro('Address', [c.address1, c.address2].filter(Boolean).join(', '))}</div>
      <div class="form-row" style="margin-top:10px">
        ${ro('City', c.city)}
        ${ro('State', c.state)}
        ${ro('Zip', c.postal)}
      </div>
      <div style="margin-top:10px">${ro('Birthday', c.birthday)}</div>
      ${notesSection}
    `;
  }
  // Update modal action buttons based on role
  const saveBtn = document.getElementById('clientDetailSaveBtn');
  const cancelBtn = document.getElementById('clientDetailCancelBtn');
  if (saveBtn) {
    saveBtn.textContent = isAdmin ? 'Save' : 'Close';
    saveBtn.onclick = isAdmin ? saveClientDetail : () => closeModal('clientDetailModal');
  }
  if (cancelBtn) cancelBtn.style.display = isAdmin ? '' : 'none';
  _renderClientNotesThread(c);
}
function _cdUpdateTitle() {
  const fn = document.getElementById('cd_firstName')?.value || '';
  const sn = document.getElementById('cd_surname')?.value || '';
  const co = document.getElementById('cd_company')?.value || '';
  document.getElementById('clientDetailName').textContent = `${fn} ${sn}`.trim() || co || 'New Client';
}

function _renderClientNotesThread(c) {
  const isAdmin = currentUser?.isAdmin;
  const notes = c.clientNotes || [];
  const el = document.getElementById('clientNotesThread');
  if (!el) return;
  if (!notes.length) {
    el.innerHTML = `<div style="font-family:var(--mono);font-size:13px;color:var(--text3);padding:4px 0">No notes yet.</div>`;
    return;
  }
  const now = Date.now();
  el.innerHTML = notes.map(n => {
    if (_editingNoteId === n.id) {
      return `<div style="background:var(--bg3);border:1px solid var(--accent);border-radius:3px;padding:8px 12px;margin-bottom:6px">
        <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:6px">${esc(n.authorName||'Unknown')} | ${fmtDate(n.date)||n.date}</div>
        <textarea class="form-input" id="noteEditInput_${n.id}" style="width:100%;resize:vertical;min-height:60px;margin-bottom:6px">${esc(n.text)}</textarea>
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" onclick="saveNoteEdit('${c.id}','${n.id}')">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="cancelNoteEdit('${c.id}')">Cancel</button>
        </div>
      </div>`;
    }
    const empExpiry = _empNoteTimers[n.id];
    const empCanAct = !isAdmin && currentUser?.id && n.authorId === currentUser.id && empExpiry && now < empExpiry;
    const secsLeft = empCanAct ? Math.ceil((empExpiry - now) / 1000) : 0;
    const actionBtns = isAdmin
      ? `<div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm job-icon-btn" style="padding:1px 6px;font-size:11px" onclick="startNoteEdit('${c.id}','${n.id}')" title="Edit note" aria-label="Edit note">${jobIconSvg('edit')}</button>
          <button class="btn btn-danger btn-sm btn-icon-only" style="padding:1px 6px;font-size:11px" onclick="deleteClientNote('${c.id}','${n.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
        </div>`
      : empCanAct
      ? `<div style="display:flex;gap:4px;align-items:center">
          <span style="font-family:var(--mono);font-size:10px;color:var(--text3)">${secsLeft}s</span>
          <button class="btn btn-ghost btn-sm job-icon-btn" style="padding:1px 6px;font-size:11px" onclick="startNoteEdit('${c.id}','${n.id}')" title="Edit note" aria-label="Edit note">${jobIconSvg('edit')}</button>
          <button class="btn btn-danger btn-sm btn-icon-only" style="padding:1px 6px;font-size:11px" onclick="empDeleteNote('${c.id}','${n.id}')" title="Delete" aria-label="Delete">${jobIconSvg('trash')}</button>
        </div>`
      : '';
    return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-family:var(--mono);font-size:11px;color:var(--text3)">${esc(n.authorName||'Unknown')} | ${fmtDate(n.date)||n.date}</span>
        ${actionBtns}
      </div>
      <div style="font-family:var(--mono);font-size:13px;color:var(--text2);white-space:pre-wrap">${esc(n.text)}</div>
    </div>`;
  }).join('');
  // Start countdown interval if any employee timers are active
  const hasActive = notes.some(n => _empNoteTimers[n.id] && now < _empNoteTimers[n.id]);
  if (hasActive && !_noteCountdownInterval) {
    _noteCountdownInterval = setInterval(() => {
      const c2 = (state.clients||[]).find(cl=>cl.id===viewingClientId);
      if (!c2 || !document.getElementById('clientNotesThread')) {
        clearInterval(_noteCountdownInterval); _noteCountdownInterval = null; return;
      }
      const t = Date.now();
      let anyLeft = false;
      for (const [nid, exp] of Object.entries(_empNoteTimers)) { if (t < exp) anyLeft = true; else delete _empNoteTimers[nid]; }
      // Skip re-render while employee is mid-edit — would reset the textarea
      if (!_editingNoteId) _renderClientNotesThread(c2);
      if (!anyLeft) { clearInterval(_noteCountdownInterval); _noteCountdownInterval = null; }
    }, 1000);
  }
}
function startNoteEdit(clientId, noteId) {
  _editingNoteId = noteId;
  const c = (state.clients||[]).find(cl=>cl.id===clientId);
  if (c) _renderClientNotesThread(c);
}
function saveNoteEdit(clientId, noteId) {
  const c = (state.clients||[]).find(cl=>cl.id===clientId);
  if (!c) return;
  const textarea = document.getElementById(`noteEditInput_${noteId}`);
  const text = textarea?.value.trim();
  if (!text) { showAlert('Note cannot be empty.'); return; }
  const note = (c.clientNotes||[]).find(n=>n.id===noteId);
  if (note) note.text = text;
  _editingNoteId = null;
  if (!currentUser?.isAdmin && !clientDetailIsNew) {
    // Restart the 30s window from the moment of save
    if (_empNoteTimers[noteId] !== undefined) _empNoteTimers[noteId] = Date.now() + 30000;
    save();
  }
  _renderClientNotesThread(c);
}
function cancelNoteEdit(clientId) {
  _editingNoteId = null;
  const c = (state.clients||[]).find(cl=>cl.id===clientId);
  if (c) _renderClientNotesThread(c);
}
function empDeleteNote(clientId, noteId) {
  const c = (state.clients||[]).find(cl=>cl.id===clientId);
  if (!c) return;
  delete _empNoteTimers[noteId];
  c.clientNotes = (c.clientNotes||[]).filter(n=>n.id!==noteId);
  save();
  _renderClientNotesThread(c);
  renderClients();
}

function addClientNote() {
  const text = document.getElementById('clientNoteInput')?.value.trim();
  if (!text) { showAlert('Please enter a note.'); return; }
  const c = (state.clients||[]).find(cl=>cl.id===viewingClientId);
  if (!c) return;
  if (!Array.isArray(c.clientNotes)) c.clientNotes = [];
  const newNote = { id: uid(), text, date: today(), authorId: currentUser?.id || '', authorName: currentUser?.name || 'Unknown' };
  c.clientNotes.push(newNote);
  document.getElementById('clientNoteInput').value = '';
  if (!currentUser?.isAdmin && !clientDetailIsNew) {
    // Employee: save immediately and start 30s edit window
    _empNoteTimers[newNote.id] = Date.now() + 30000;
    save();
  }
  _renderClientNotesThread(c);
}

function deleteClientNote(clientId, noteId) {
  showConfirm('Delete this note?', () => {
    const c = (state.clients||[]).find(cl=>cl.id===clientId);
    if (!c) return;
    c.clientNotes = (c.clientNotes||[]).filter(n=>n.id!==noteId);
    _editingNoteId = null;
    // Admins: committed on Save. Employees can't delete notes.
    if (!currentUser?.isAdmin && !clientDetailIsNew) save();
    _renderClientNotesThread(c);
    if (currentUser?.isAdmin) renderClients(); // update note indicator live
  });
}

function saveClientDetail() {
  if (!currentUser?.isAdmin) { closeModal('clientDetailModal'); return; }
  let c = clientDetailIsNew
    ? { id: viewingClientId, squareId:'', refId:'', memo:'', emailSubStatus:'', firstVisit:today(), lastVisit:today(), txCount:0, lifetimeSpend:'', clientNotes:[] }
    : (state.clients||[]).find(cl=>cl.id===viewingClientId);
  if (!c) return;
  const oldMatchNames = clientMatchNames(c);
  c.firstName   = document.getElementById('cd_firstName')?.value.trim()  || '';
  c.surname     = document.getElementById('cd_surname')?.value.trim()     || '';
  c.company     = document.getElementById('cd_company')?.value.trim()     || '';
  c.email       = document.getElementById('cd_email')?.value.trim()       || '';
  c.phone       = document.getElementById('cd_phone')?.value.trim()       || '';
  c.address1    = document.getElementById('cd_address1')?.value.trim()    || '';
  c.address2    = document.getElementById('cd_address2')?.value.trim()    || '';
  c.city        = document.getElementById('cd_city')?.value.trim()        || '';
  c.state       = document.getElementById('cd_state')?.value.trim()       || '';
  c.postal      = document.getElementById('cd_postal')?.value.trim()      || '';
  c.birthday    = document.getElementById('cd_birthday')?.value.trim()    || '';
  if (clientDetailIsNew) {
    if (!state.clients) state.clients = [];
    state.clients.push(c);
  }
  _linkClientToMatchingRecords(c.id, [...oldMatchNames, ...clientMatchNames(c)]);
  clientDetailIsNew = false;
  pendingNewClientName = null;
  if (_noteCountdownInterval) { clearInterval(_noteCountdownInterval); _noteCountdownInterval = null; }
  save(); closeModal('clientDetailModal'); renderAll();
}

function cancelClientDetail() {
  // Restore notes to pre-edit state
  if (!clientDetailIsNew && _clientNotesSnapshot !== null) {
    const c = (state.clients||[]).find(cl=>cl.id===viewingClientId);
    if (c) c.clientNotes = JSON.parse(JSON.stringify(_clientNotesSnapshot));
  }
  _clientNotesSnapshot = null;
  _editingNoteId = null;
  if (_noteCountdownInterval) { clearInterval(_noteCountdownInterval); _noteCountdownInterval = null; }
  clientDetailIsNew = false;
  pendingNewClientName = null;
  closeModal('clientDetailModal');
  renderClients();
}

function deleteClient(id) {
  showConfirm('Remove this client from your list?', () => {
    state.clients = (state.clients||[]).filter(c=>c.id!==id);
    save(); renderClients();
  });
}

function exportClientToSquare(id) {
  const c = (state.clients||[]).find(cl=>cl.id===id);
  if (!c) return;
  const headers = ['First Name','Surname','Company Name','Email Address','Phone Number','Street Address 1','Street Address 2','City','State','Postal Code','Reference ID','Birthday','Email Subscription Status'];
  const vals    = [c.firstName, c.surname, c.company, c.email, c.phone, c.address1, c.address2, c.city, c.state, c.postal, c.refId, c.birthday, c.emailSubStatus];
  const line    = vals.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',');
  downloadCSV(headers.join(',') + '\n' + line + '\n', `square-import-${(c.firstName||'client').toLowerCase().replace(/\s+/g,'-')}.csv`);
}

async function syncClientToSquare(id) {
  try {
    const rsp = await callSquareFn('squareCustomerSync', { clientId: id });
    const c = (state.clients||[]).find(cl=>cl.id===id);
    if (c && rsp.squareCustomerId) {
      c.squareId = rsp.squareCustomerId;
      c.squareCustomerId = rsp.squareCustomerId;
      c.contactSyncSource = 'square';
      c.lastSyncedAt = new Date().toISOString();
      c.syncVersion = Number(c.syncVersion || 0) + 1;
      save();
      _renderClientDetailModal(c);
      renderClients();
    }
    showAlert('Client synced to Square.');
  } catch (e) {
    showAlert(`Client sync failed: ${e.message || 'unknown error'}`);
  }
}

function downloadCSV(csv, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download: filename });
  a.click(); URL.revokeObjectURL(a.href);
}

// ─── CLIENT AUTOCOMPLETE ──────────────────────────────────────────────────────
let _acIdx = -1;

function showAC(inputId) {
  const input = document.getElementById(inputId);
  const listId = inputId + '_acList';
  let list = document.getElementById(listId);
  if (!list) {
    list = document.createElement('div');
    list.id = listId; list.className = 'ac-list';
    input.parentElement.appendChild(list);
  }
  const q = input.value.toLowerCase().trim();
  if (!q || !state.clients) { list.style.display = 'none'; return; }
  const matches = state.clients.filter(c => {
    const name = `${c.firstName||''} ${c.surname||''}`.trim();
    return name.toLowerCase().includes(q) || (c.company||'').toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q);
  }).slice(0, 8);
  if (!matches.length) { list.style.display = 'none'; return; }
  _acIdx = -1;
  list.innerHTML = matches.map((c, i) => {
    const name = [c.firstName, c.surname].filter(Boolean).join(' ') || c.company || c.email;
    const sub  = [c.city, c.email].filter(Boolean).join(' | ');
    return `<div class="ac-item" data-idx="${i}" data-name="${esc(name)}" onmousedown="pickAC('${inputId}','${esc(name).replace(/'/g,"\\'")}')">
      <div>${esc(name)}</div>
      ${sub?`<div style="font-size:11px;color:var(--text3)">${esc(sub)}</div>`:''}
    </div>`;
  }).join('');
  list.style.display = 'block';
}

function hideAC(inputId) {
  const list = document.getElementById(inputId + '_acList');
  if (list) list.style.display = 'none';
}

function pickAC(inputId, name) {
  document.getElementById(inputId).value = name;
  hideAC(inputId);
}

function navigateAC(e, inputId) {
  const list = document.getElementById(inputId + '_acList');
  if (!list || list.style.display === 'none') return;
  const items = list.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown')  { e.preventDefault(); _acIdx = Math.min(_acIdx+1, items.length-1); _acHighlight(list); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _acIdx = Math.max(_acIdx-1, -1); _acHighlight(list); }
  else if (e.key === 'Enter' && _acIdx >= 0) { e.preventDefault(); pickAC(inputId, items[_acIdx].dataset.name); }
  else if (e.key === 'Escape') { hideAC(inputId); }
}
function _acHighlight(list) {
  list.querySelectorAll('.ac-item').forEach((el,i) => el.classList.toggle('ac-active', i === _acIdx));
}

// ─── "ADD AS CLIENT" PROMPT ──────────────────────────────────────────────────
function clientByName(name) {
  if (!name) return null;
  const q = name.toLowerCase().trim();
  return (state.clients||[]).find(c => {
    const full = `${c.firstName||''} ${c.surname||''}`.trim();
    return full.toLowerCase() === q || (c.company||'').toLowerCase() === q;
  }) || null;
}

function clientById(id) {
  if (!id) return null;
  return (state.clients || []).find(c => c.id === id) || null;
}

function clientDisplayName(c) {
  if (!c) return '';
  return [c.firstName, c.surname].filter(Boolean).join(' ') || c.company || c.email || '';
}

function clientMatchNames(c) {
  if (!c) return [];
  return [
    [c.firstName, c.surname].filter(Boolean).join(' '),
    c.company || '',
    c.email || ''
  ].map(v => v.trim()).filter(Boolean);
}

function _linkClientToMatchingRecords(clientId, names) {
  const keys = new Set((names || []).map(n => n.toLowerCase().trim()).filter(Boolean));
  if (!clientId || !keys.size) return;
  const matches = (value) => keys.has(String(value || '').toLowerCase().trim());
  (state.jobs || []).forEach(job => {
    if (!job.clientId && matches(job.name)) job.clientId = clientId;
    if (!job.contactClientId && matches(job.contactName)) job.contactClientId = clientId;
  });
  (state.homewatch || []).forEach(hw => {
    if (!hw.clientId && matches(hw.name)) hw.clientId = clientId;
  });
  (state.appointments || []).forEach(a => {
    if (!a.clientId && matches(a.clientName)) a.clientId = clientId;
    if (!a.contactClientId && matches(a.contactName)) a.contactClientId = clientId;
  });
}

function goToClient(name) {
  const match = clientByName(name);
  const tab = document.getElementById('clientsTab');
  if (tab) switchTab('clients', tab);
  if (match) {
    setTimeout(() => openClientDetail(match.id), 60);
  } else {
    setTimeout(() => {
      const si = document.getElementById('clientSearchInput');
      if (si) { si.value = name; renderClients(); }
    }, 60);
  }
}

let _cqClientId = null;
let _editingNoteId = null;
let _clientNotesSnapshot = null;
const _empNoteTimers = {}; // noteId to expiry timestamp (ms) for employee 30s edit window
let _noteCountdownInterval = null;
function openClientQuick(name) {
  const c = clientByName(name);
  if (!c) return;
  _linkClientToMatchingRecords(c.id, [name, ...clientMatchNames(c)]);
  openClientQuickById(c.id);
}
function openClientQuickById(id) {
  const c = clientById(id);
  if (!c) return;
  _cqClientId = c.id;
  document.getElementById('cqName').textContent = clientDisplayName(c) || 'Client';
  const fmtV = (key) => {
    const v = c[key];
    if (v === undefined || v === null || v === '') return null;
    if (key === 'lifetimeSpend') return `$${parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    if (key === 'firstVisit' || key === 'lastVisit') return fmtDate(v);
    if (key === 'phone') return formatPhone(v);
    if (key === 'txCount') return String(v);
    return esc(String(v));
  };
  const sqParts = [
    c.firstVisit    ? `First visit: ${fmtDate(c.firstVisit)}` : '',
    c.lastVisit     ? `Last visit: ${fmtDate(c.lastVisit)}` : '',
    c.txCount       ? `${c.txCount} visit${c.txCount!==1?'s':''}` : '',
    c.lifetimeSpend ? `$${parseFloat(c.lifetimeSpend).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} lifetime` : '',
  ].filter(Boolean).join(' | ');
  const quickCols = (() => {
    const qc = _clientQuickColsForView();
    if (!qc || !qc.length) return CLIENT_COLS;
    return CLIENT_COLS.filter(col => qc.includes(col.key));
  })();
  const rows = quickCols.map(col => {
    const fv = fmtV(col.key);
    if (!fv) return '';
    return `<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:5px"><span style="font-family:var(--mono);font-size:11px;color:var(--text3);min-width:90px;text-transform:uppercase;letter-spacing:0.05em">${col.label}</span><span style="color:var(--text2);font-size:13px">${fv}</span></div>`;
  }).filter(Boolean).join('');
  const notes = (c.clientNotes||[]);
  const notesHtml = notes.length ? notes.map(n=>`
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:8px 10px;margin-bottom:6px">
      <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:4px">${esc(n.authorName)} | ${fmtDate(n.date)}</div>
      <div style="color:var(--text2);font-size:13px;white-space:pre-wrap">${esc(n.text)}</div>
    </div>`).join('') : '<div style="color:var(--text3);font-size:13px">No notes.</div>';
  document.getElementById('cqBody').innerHTML = `
    ${sqParts ? `<div class="icon-inline" style="font-family:var(--mono);font-size:12px;color:var(--text3);padding:7px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;margin-bottom:12px">${jobIconSvg('chart')} ${sqParts}</div>` : ''}
    ${rows || '<div style="color:var(--text3);font-size:13px;margin-bottom:12px">No contact info on file.</div>'}
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
      <div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);margin-bottom:8px">Notes</div>
      ${notesHtml}
    </div>`;
  document.getElementById('clientQuickModal').classList.remove('hidden');
  applyAdminClasses();
}
function cqShowInClients() {
  closeModal('clientQuickModal');
  const tab = document.getElementById('clientsTab');
  if (tab) switchTab('clients', tab);
  if (_cqClientId) {
    expandedClients.add(_cqClientId);
    saveExpandedClientsState();
    setTimeout(() => {
      renderClients();
      const row = document.getElementById(`crow_${_cqClientId}`);
      if (row) row.scrollIntoView({ behavior:'smooth', block:'center' });
    }, 60);
  }
}
function cqEdit() {
  closeModal('clientQuickModal');
  if (_cqClientId) openClientDetail(_cqClientId);
}

function exportAllClientsToSquare() {
  const clients = state.clients || [];
  if (!clients.length) { showAlert('No clients to export.'); return; }
  const headers = ['First Name','Surname','Company Name','Email Address','Phone Number','Street Address 1','Street Address 2','City','State','Postal Code','Reference ID','Birthday','Email Subscription Status'];
  const rows = clients.map(c => {
    const vals = [c.firstName, c.surname, c.company, c.email, c.phone, c.address1, c.address2, c.city, c.state, c.postal, c.refId, c.birthday, c.emailSubStatus];
    return vals.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',');
  });
  downloadCSV(headers.join(',') + '\n' + rows.join('\n') + '\n', 'square-import-all-clients.csv');
}

function checkNewClientPrompt(name) {
  if (!name || !currentUser?.isAdmin) return;
  const already = (state.clients||[]).some(c => {
    const full = `${c.firstName||''} ${c.surname||''}`.trim();
    return full.toLowerCase() === name.toLowerCase() || (c.company||'').toLowerCase() === name.toLowerCase();
  });
  if (already) return;
  pendingNewClientName = name;
  document.getElementById('addClientPromptMsg').textContent =
    `"${name}" isn't in your client list yet. Add them now?`;
  document.getElementById('addClientPromptModal').classList.remove('hidden');
}

function confirmAddNewClient() {
  if (!pendingNewClientName) return;
  const parts = pendingNewClientName.trim().split(/\s+/);
  const newClient = {
    id: uid(), squareId:'', refId:'', firstName:parts[0]||'', surname:parts.slice(1).join(' ')||'',
    company:'', email:'', phone:'', address1:'', address2:'', city:'', state:'', postal:'',
    birthday:'', memo:'', emailSubStatus:'', firstVisit:today(), lastVisit:today(),
    txCount:0, lifetimeSpend:'', clientNotes:[],
  };
  closeModal('addClientPromptModal');
  openNewClientDetail(newClient); // not saved yet — save/cancel handled in detail modal
}

firebase.auth().onAuthStateChanged(user => { if (user) load(); });
firebase.auth().signInAnonymously().catch(e => {
  document.getElementById('loadingOverlay').innerHTML = `
    <div style="font-family:var(--mono);font-size:16px;color:var(--red)">Authentication failed</div>
    <div style="font-family:var(--mono);font-size:13px;color:var(--text3);margin-top:8px">${e.message}</div>
    <div style="font-family:var(--mono);font-size:13px;color:var(--text3);margin-top:4px">Make sure Anonymous auth is enabled in Firebase console.</div>`;
});

function goToTab(name) {
  closeMobileMenu();
  closeDesktopMenu();
  const btn = document.querySelector(`.tabs .tab[onclick*="'${name}'"]`);
  if (btn) switchTab(name, btn);
}
function goHeaderHome() {
  expandedJobs.clear();
  expandedHW.clear();
  saveExpandedState();
  goToTab('active');
  renderJobs();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── TABS SCROLL INDICATOR ────────────────────────────────────────────────────
function _initSettingsNavScroll() {
  document.querySelectorAll('.settings-nav-wrap').forEach(wrap => {
    const nav = wrap.querySelector('.settings-nav');
    if (!nav) return;
    function update() {
      const atStart = nav.scrollLeft <= 2;
      const atEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2;
      wrap.classList.toggle('snav-has-left', !atStart);
      wrap.classList.toggle('snav-has-right', !atEnd);
    }
    nav.removeEventListener('scroll', nav._snavHandler);
    nav._snavHandler = update;
    nav.addEventListener('scroll', update, { passive: true });
    requestAnimationFrame(update);
  });
}

function _initTabsScroll() {
  const tabs = document.querySelector('.tabs');
  const wrap = document.querySelector('.tabs-wrap');
  if (!tabs || !wrap) return;
  function update() {
    const atStart = tabs.scrollLeft <= 2;
    const atEnd = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 2;
    wrap.classList.toggle('tabs-has-left', !atStart);
    wrap.classList.toggle('tabs-has-right', !atEnd);
  }
  tabs.removeEventListener('scroll', tabs._scrollHandler);
  tabs._scrollHandler = update;
  tabs.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
}

// ─── BODY SCROLL LOCK — prevent background scroll when any modal is open ───────
(function() {
  const observer = new MutationObserver(() => {
    const anyOpen = !!document.querySelector('.modal-overlay:not(.hidden)');
    document.body.style.overflow = anyOpen ? 'hidden' : '';
  });
  document.querySelectorAll('.modal-overlay').forEach(el =>
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
  );
})();

// Header actions behavior (desktop dropdown + mobile drawer)
(function() {
  const actions = document.querySelector('.header-actions');
  if (!actions) return;
  actions.addEventListener('click', (e) => {
    const target = e.target.closest('button, a');
    if (!target) return;
    if (window.innerWidth > 600) {
      if (target.id === 'desktopMenuBtn') return;
      closeDesktopMenu();
      return;
    }
    closeMobileMenu();
  });
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 600) return;
    if (!actions.contains(e.target)) closeDesktopMenu();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 600) closeMobileMenu();
    if (window.innerWidth <= 600) closeDesktopMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileMenu();
      closeDesktopMenu();
    }
  });
})();

document.addEventListener('keydown', e => {
  const anyOpen = document.querySelector('.modal-overlay:not(.hidden)');
  if (anyOpen || !currentUser?.isAdmin) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoAction();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redoAction();
  }
});













