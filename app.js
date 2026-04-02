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
  settings: { empName: 'Employee', empShare: 0.66, feeRate: 0.026, txnFee: 0.30, debtOriginal: 2256.58, debtOwnerShare: 0.50, defaultMilestones: [] },
  debtPayments: [],
  jobs: [],
  users: [],
  appointments: [],
  homewatch: []
};
let editingJobId = null;
let addItemContext = null;
let expandedJobs = new Set(); // local only — never saved to Firestore
let expandedHW   = new Set(); // local only — never saved to Firestore
const expandedClients = new Set();
let notesCtx = null; // { type: 'job'|'hw', id }
let empSummaryTimeframe = localStorage.getItem('empSummaryTF') || '30'; // days, or 'all'
let hoursJobId = null;
let editNoteCtx = null;
let isSaving = false;
let currentUser = null; // { id, name, isAdmin }
let editingApptId = null;
let resetPinUserId = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let schedView = 'list'; // 'list' | 'month'
let selectedCalDay = null;
let selectedDayFilter = null; // mobile day-drill-down

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
  if (!s.debtPayments) s.debtPayments = [];
  (s.debtPayments).forEach(p => {
    if (p.linkedJobId === undefined) p.linkedJobId = null;
    if (p.linkedHWId  === undefined) p.linkedHWId  = null;
  });
  if (!s.users) s.users = [];
  if (!s.appointments) s.appointments = [];
  (s.appointments||[]).forEach(a => { if (a.contactName === undefined) a.contactName = ''; });
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
  (s.users).forEach(u => { if (!u.isAdmin && u.empShare === undefined) u.empShare = legacyEmpShare; });
  const defaultEmp = (s.users).find(u => !u.isAdmin);
  if (!s.settings.debtEmployeeId && defaultEmp) s.settings.debtEmployeeId = defaultEmp.id;
  if (!s.homewatch) s.homewatch = [];
  (s.homewatch || []).forEach(hw => {
    if (!hw.payments) hw.payments = [];
    if (!hw.hwNotes) hw.hwNotes = [];
    if (!hw.advances) hw.advances = [];
    if (!hw.status) hw.status = 'active';
    hw.payments.forEach(p => { if (!p.status) p.status = 'pending'; });
    if (!hw.employeeId && defaultEmp) hw.employeeId = defaultEmp.id;
  });
  (s.jobs || []).forEach(job => {
    delete job._expanded; // moved to local localStorage — not stored in Firestore
    if (!job.employeeId && defaultEmp) job.employeeId = defaultEmp.id;
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
    (job.milestones || []).forEach(m => {
      if (m.status === undefined) { m.status = m.collected ? 'collected' : 'pending'; delete m.collected; }
    });
    (job.addOns || []).forEach(a => {
      if (a.status === undefined) { a.status = a.collected ? 'collected' : 'pending'; delete a.collected; }
      if (a.date === undefined) a.date = '';
    });
    if (!job.subtractions) job.subtractions = [];
    (job.subtractions || []).forEach(a => {
      if (a.status === undefined) { a.status = 'pending'; }
      if (a.date === undefined) a.date = '';
      if (a.sourceItemId === undefined) a.sourceItemId = null;
    });
    if (job.isItemized === undefined) job.isItemized = false;
    if (!job.quoteItems) job.quoteItems = [];
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
    showAlert('Save failed — check your connection.');
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
  _showUndoToast('↩ ' + description);
  isSaving = true;
  try {
    await DOC.set(prev);
    // Apply directly — don't rely on onSnapshot (it fires before set() resolves and gets suppressed by isSaving)
    _applyRestoredState(prev);
  } catch(e) {
    console.error('Undo failed:', e);
    showAlert('Undo failed — check your connection.');
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
  _showUndoToast('↻ ' + description);
  isSaving = true;
  try {
    await DOC.set(next);
    _applyRestoredState(next);
  } catch(e) {
    console.error('Redo failed:', e);
    showAlert('Redo failed — check your connection.');
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
  t.textContent = msg || '↩ Undo applied';
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
      // First time using Firebase — migrate local data up
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

  // Real-time listener — keeps all open tabs/devices in sync
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
        renderAll();
      }
    }
  });
}
function uid() { return crypto.randomUUID(); }
function today() { return new Date().toISOString().slice(0,10); }
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '$0.00';
  if (Object.is(n, -0) || (n < 0 && n > -0.005)) n = 0;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return (n < 0 ? '-$' : '$') + s;
}
function fmtDate(d) {
  if (!d) return '';
  const p = d.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : d;
}
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ─── CALCULATIONS ─────────────────────────────────────────────────────────────
function calcSplit(gross, { empShare, feeRate, txnFee = 0, txnCount = 0 }) {
  const totalFees  = gross * feeRate + txnFee * txnCount;
  const netRevenue = gross - totalFees;
  const empOwed    = netRevenue * empShare;
  const ownerOwed  = netRevenue * (1 - empShare);
  return { totalFees, netRevenue, empOwed, ownerOwed };
}

function getEmp(userId) {
  return state.users.find(u => u.id === userId);
}

function calcJob(job) {
  const emp = getEmp(job.employeeId);
  const empShare = emp?.empShare ?? 0.66;
  const { feeRate, txnFee = 0, debtOwnerShare } = state.settings;
  const normalOwnerShare = 1 - empShare;
  const effectiveOwnerShare = job.repaymentMode ? (debtOwnerShare || 0.50) : normalOwnerShare;
  const effectiveEmpShare   = 1 - effectiveOwnerShare;
  const ownerShare = effectiveOwnerShare;

  const addOnTotal      = (job.addOns       || []).reduce((s,a) => s + (a.amount||0), 0);
  const subtractionTotal= (job.subtractions || []).reduce((s,a) => s + (a.amount||0), 0);
  const contractTotal   = (job.quote || 0) + addOnTotal - subtractionTotal;

  let collectedGross = 0, estimatedFees = 0, collectedTxns = 0;
  (job.milestones || []).forEach(m => {
    if (m.status === 'collected') {
      const g = (m.pct/100) * (job.quote||0);
      collectedGross += g; estimatedFees += g * feeRate; collectedTxns++;
    }
  });
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
  estimatedFees += txnFee * collectedTxns;
  const manualFees = (job.fees || []).reduce((s,f) => s + (f.amount||0), 0);
  const totalFees = estimatedFees + manualFees;
  const netRevenue = collectedGross - totalFees;

  let pendingGross = 0, pendingTxns = 0;
  (job.milestones || []).forEach(m => { if (m.status !== 'collected') pendingGross += (m.pct/100)*(job.quote||0); });
  (job.milestones || []).forEach(m => { if (m.status !== 'collected') pendingTxns++; });
  (job.addOns       || []).forEach(a => { if (a.status !== 'collected') { pendingGross += a.amount||0; pendingTxns++; } });
  (job.subtractions || []).forEach(a => { if (a.status !== 'collected') pendingGross -= a.amount||0; });

  const ownerMats = (job.materials||[]).filter(m=>m.who==='owner').reduce((s,m)=>s+(m.amount||0),0);
  const empMats   = (job.materials||[]).filter(m=>m.who==='emp').reduce((s,m)=>s+(m.amount||0),0);
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
  const ownerTotal      = ownerProfit + ownerMats;
  const totalHours      = (job.hours||[]).reduce((s,h)=>s+(h.hours||0),0);

  return { contractTotal, addOnTotal, subtractionTotal, collectedGross, pendingGross,
    totalFees, netRevenue, totalMats, ownerMats, empMats,
    profitPool, empProfit, ownerProfit, debtContribution,
    empTotalOwed, advancesPaid, linkedDebtPaid, empBalance,
    outstanding, projectedGross, projectedFees, projectedNetRevenue, projectedProfitPool,
    potentialEmpTotalOwed, potentialEmpBalance, ownerTotal, totalHours };
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
  return { collectedGross, pendingGross, totalFees, netRevenue, empOwed, ownerOwed, advancesPaid, linkedDebtPaid, empBalance };
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
    <div class="job-card${isExp?' expanded':''}${paused?' job-complete':''}">
      <div class="job-header">
        <div class="job-header-main" onclick="toggleHW('${hw.id}')">
          <div class="job-name" style="display:flex;align-items:center;gap:8px">
            ${esc(hw.name)}${paused?' <span style="font-size:13px;color:var(--text3)">(paused)</span>':''}
            ${clientByName(hw.name) ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;flex-shrink:0" onclick="event.stopPropagation();openClientQuick('${esc(hw.name)}')" title="View in Clients">👤</button>` : ''}
          </div>
          <div class="job-meta"><span style="font-size:13px;color:var(--text3)">Since ${hw.startDate ? fmtDate(hw.startDate) : '—'} · ${fmt(hw.monthlyRate)}/mo</span>${hwEmpName ? `<span style="font-size:13px;color:var(--text3)"> · </span><span style="color:var(--purple);font-size:13px">${esc(hwEmpName)}</span>` : ''}</div>
        </div>
        <div class="job-header-btns">
          <button class="btn btn-ghost btn-sm" onclick="openNotes('hw','${hw.id}')" title="Notes">📝${nc>0?` ${nc}`:''}</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="toggleHWPause('${hw.id}')" title="${paused?'Resume':'Pause'}">${paused?'▶ Resume':'⏸ Pause'}</button>
          <button class="btn btn-ghost btn-sm admin-only" onclick="openEditHW('${hw.id}')" title="Edit">Edit</button>
          <button class="btn btn-danger btn-sm admin-only" onclick="deleteHW('${hw.id}')" title="Delete">DEL</button>
          <div class="job-chevron" onclick="toggleHW('${hw.id}')">▾</div>
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
        <button class="btn btn-ghost btn-sm admin-only" onclick="openAddHWPayment('${hw.id}')">+ Log Payment</button>
      </div>
      ${payments.length
        ? payments.slice().reverse().map((p,i)=>`
          <div class="line-item" style="gap:8px">
            ${hwPayBadgeHtml(p.status, hw.id, p.id)}
            <span style="flex:1">${fmtDate(p.date)||p.date||'—'} · ${fmt(p.amount)}</span>
            <button class="btn btn-danger btn-sm admin-only" onclick="removeHWPayment('${hw.id}','${p.id}')">DEL</button>
          </div>`).join('')
        : '<div style="color:var(--text3);font-size:15px;padding:4px 0">No payments logged yet.</div>'}
      <div class="section-header admin-only" style="margin-top:12px">
        <span class="section-title">Paid to ${en}</span>
        <button class="btn btn-ghost btn-sm" onclick="openAddHWAdvance('${hw.id}')">+ Pay Employee</button>
      </div>
      ${advances.length
        ? advances.slice().reverse().map(a=>`
          <div class="line-item admin-only" style="gap:8px">
            <span style="flex:1;color:var(--text2)">${fmtDate(a.date)||a.date||'—'}</span>
            <span class="green">-${fmt(a.amount)}</span>
            <button class="btn btn-danger btn-sm" onclick="removeHWAdvance('${hw.id}','${a.id}')">DEL</button>
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
  if (expandedHW.has(hwId)) expandedHW.delete(hwId); else expandedHW.add(hwId);
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
  document.getElementById('hwPayModalTitle').textContent = `Log Client Payment — ${hw?.name||''}`;
  document.getElementById('hwp_amount').value = hw?.monthlyRate||'';
  document.getElementById('hwp_date').value   = today();
  document.getElementById('hwPayModal').classList.remove('hidden');
}
function openAddHWAdvance(hwId) {
  hwPayContext = hwId; hwPayMode = 'advance';
  const hw = (state.homewatch||[]).find(h=>h.id===hwId);
  document.getElementById('hwPayModalTitle').textContent = `Pay Employee — ${hw?.name||''}`;
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
  const s = state.settings;
  const originalDebt = s.debtOriginal || 0;
  if (!originalDebt) { document.getElementById('debtPanel').innerHTML = ''; return; }

  let jobRepaid = 0;
  state.jobs.forEach(j => { jobRepaid += calcJob(j).debtContribution; });
  const manualRepaid = (state.debtPayments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalRepaid = jobRepaid + manualRepaid;
  const remaining = Math.max(0, originalDebt - totalRepaid);
  const pct = Math.min(100, (totalRepaid / originalDebt) * 100);
  const paid = remaining <= 0;
  const debtEmp = getEmp(s.debtEmployeeId);
  const en = esc(debtEmp?.name || 'Employee');
  const normalPct = Math.round((1 - (debtEmp?.empShare ?? 0.66)) * 100);
  const repayPct  = Math.round((s.debtOwnerShare || 0.50) * 100);

  const paymentsHtml = (state.debtPayments || []).length
    ? [...state.debtPayments].reverse().map(p => {
        const linkedJob = p.linkedJobId ? state.jobs.find(j => j.id === p.linkedJobId) : null;
        const linkedHW  = p.linkedHWId  ? (state.homewatch||[]).find(h => h.id === p.linkedHWId) : null;
        const jobTag = linkedJob ? `<span style="font-size:11px;background:rgba(91,141,239,0.15);color:var(--blue);border-radius:2px;padding:1px 6px;font-family:var(--mono);margin-left:6px;white-space:nowrap;display:inline-block">⇒ ${esc(linkedJob.name)}</span>` : '';
        const hwTag  = linkedHW  ? `<span style="font-size:11px;background:rgba(76,175,130,0.15);color:var(--green);border-radius:2px;padding:1px 6px;font-family:var(--mono);margin-left:6px;white-space:nowrap;display:inline-block">⇒ HW: ${esc(linkedHW.name)}</span>` : '';
        return `<div class="line-item line-item-simple" style="padding:6px 0">
          <div class="line-item-label" style="font-size:15px;display:flex;flex-direction:column;gap:3px;align-items:flex-start">
            <span>${esc(p.label||'Manual payment')}<span style="font-size:11px;color:var(--text3);margin-left:8px;font-family:var(--mono)">${fmtDate(p.date)||''}</span></span>
            ${jobTag||hwTag ? `<span style="display:flex;flex-wrap:wrap;gap:4px">${jobTag}${hwTag}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <div class="line-item-value green">+${fmt(p.amount)}</div>
            <button class="btn btn-danger btn-sm" onclick="deleteDebtPayment('${p.id}')">DEL</button>
          </div>
        </div>`;
      }).join('')
    : '';

  document.getElementById('debtPanel').innerHTML = `
    <div class="debt-panel${paid?' paid':''}">
      <div class="debt-panel-header">
        <span class="debt-panel-title">⚖ Fee Debt Repayment — ${en}</span>
        <span class="debt-panel-status${paid?' paid':''}">${paid ? '✓ PAID OFF' : `${repayPct}/${100-repayPct} split active`}</span>
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
      </div>
      <div class="debt-progress-track">
        <div class="debt-progress-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="debt-progress-label" style="margin-bottom:${paymentsHtml||!paid?'12px':'0'}">
        <span>${pct.toFixed(1)}% repaid</span>
        <span>Normal split ${normalPct}/${100-normalPct} · Repayment split ${repayPct}/${100-repayPct}</span>
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
  const empCardsHtml = employees.map(emp => {
    const empJobs = state.jobs.filter(j => j.employeeId === emp.id && j.status !== 'complete');
    const empHW   = (state.homewatch||[]).filter(hw => hw.employeeId === emp.id);
    const jobBal  = empJobs.reduce((s,j) => s + calcJob(j).empBalance, 0);
    const hwBal   = empHW.reduce((s,hw) => s + calcHW(hw).empBalance, 0);
    const total   = jobBal + hwBal;
    return `<div class="summary-card"><div class="summary-label">Owed to ${esc(emp.name)}</div><div class="summary-value ${total < 0 ? 'red' : 'orange'}">${fmt(Math.max(0, total))}</div><div class="summary-sub">jobs ${fmt(jobBal)} + HW ${fmt(hwBal)}</div></div>`;
  }).join('');
  document.getElementById('summaryCards').innerHTML = `
    <div class="summary-card" onclick="goToTab('active')" style="cursor:pointer"><div class="summary-label">Active Jobs</div><div class="summary-value">${active.length}</div></div>
    <div class="summary-card" onclick="goToTab('homewatch')" style="cursor:pointer"><div class="summary-label">HomeWatch</div><div class="summary-value">${activeHW.length}</div><div class="summary-sub">${pausedHW.length > 0 ? `${pausedHW.length} paused` : 'none paused'}</div></div>
    <div class="summary-card"><div class="summary-label">Total Contract Value</div><div class="summary-value orange">${fmt(tContract)}</div></div>
    <div class="summary-card"><div class="summary-label">Collected</div><div class="summary-value green">${fmt(tCollected)}</div><div class="summary-sub">${fmt(tPending)} pending</div></div>
    <div class="summary-card"><div class="summary-label">Your Profit (active)</div><div class="summary-value green">${fmt(tOwner)}</div><div class="summary-sub">from collected revenue</div></div>
    ${empCardsHtml}`;
}

function renderEmpSummary() {
  const el = document.getElementById('empSummaryCards');
  if (!el || !currentUser || currentUser.isAdmin) return;
  const { feeRate } = state.settings;
  const myId     = currentUser.id;
  const empShare = getEmp(myId)?.empShare ?? 0.66;
  const active   = state.jobs.filter(j => j.status !== 'complete' && j.employeeId === myId);
  const activeHW = (state.homewatch||[]).filter(hw => hw.status !== 'paused' && hw.employeeId === myId);
  const pausedHW = (state.homewatch||[]).filter(hw => hw.status === 'paused' && hw.employeeId === myId);
  const allHW    = (state.homewatch||[]).filter(hw => hw.employeeId === myId);

  // Currently owed (collected but not yet paid out — includes paused clients with collected invoices)
  let tOwed = 0;
  active.forEach(j => { tOwed += calcJob(j).empBalance; });
  allHW.forEach(hw => { tOwed += calcHW(hw).empBalance; });

  // Potential pay (owed now + employee share of all still-pending work on active items)
  let tPotential = tOwed;
  active.forEach(j => {
    const c = calcJob(j);
    tPotential += c.pendingGross * (1 - feeRate) * empShare;
  });
  activeHW.forEach(hw => {
    const c = calcHW(hw);
    tPotential += c.pendingGross * (1 - feeRate) * empShare;
  });

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
        <select onchange="empSummaryTimeframe=this.value;localStorage.setItem('empSummaryTF',this.value);renderEmpSummary()" style="font-size:12px;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:1px 4px">${tfOpts}</select>
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
function emptyState(msg) { return `<div class="empty-state"><div class="empty-state-icon">📋</div>${msg}</div>`; }

function jobCard(job) {
  const c = calcJob(job);
  const isExp = expandedJobs.has(job.id);
  const sc    = job.status === 'complete' ? 'complete' : 'active';
  const sl    = job.status === 'complete' ? 'Complete' : 'Active';
  const sb    = job.status === 'complete' ? 'status-complete' : 'status-active';
  const nc    = (job.jobNotes||[]).length;
  const th    = c.totalHours;
  const jobEmpName = currentUser?.isAdmin ? (getEmp(job.employeeId)?.name || '') : '';
  return `
  <div class="job-card ${sc} ${isExp?'expanded':''}" id="job_${job.id}">
    <div class="job-header">
      <div class="job-header-main job-header-main-grid" onclick="toggleJob('${job.id}')">
        <div class="job-name-block">
          <div class="job-name" style="display:flex;align-items:center;gap:8px">
            ${esc(job.name)}
            ${clientByName(job.name) ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;flex-shrink:0" onclick="event.stopPropagation();openClientQuick('${esc(job.name)}')" title="View in Clients">CL</button>` : ''}
          </div>
          ${job.contactName ? `<div style="font-size:13px;color:var(--blue);margin-top:2px;font-family:var(--mono);display:flex;align-items:center;gap:6px">via ${esc(job.contactName)} <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px" onclick="event.stopPropagation();openClientQuick('${esc(job.contactName)}')" title="View in Clients">CL</button></div>` : ''}
          <div style="font-size:15px;color:var(--text3);margin-top:2px;font-family:var(--mono)">${job.date||''}</div>
        </div>
        <div class="job-status-wrap">
          <span class="job-status ${sb}">${sl}</span>
          ${jobEmpName ? `<span style="font-family:var(--mono);font-size:13px;color:var(--purple);white-space:nowrap">${esc(jobEmpName)}</span>` : ''}
        </div>
        <div class="job-quick-stats job-quick-stats-grid">
          <div class="job-stat"><div class="job-stat-label">Quote</div><div class="job-stat-value">${fmt(job.quote)}</div></div>
          <div class="job-stat"><div class="job-stat-label">Adjustments</div><div class="job-stat-value" style="color:${c.addOnTotal-c.subtractionTotal>=0?'var(--purple)':'var(--red)'}">${fmt(c.addOnTotal-c.subtractionTotal)}</div></div>
          <div class="job-stat"><div class="job-stat-label">Contract Total</div><div class="job-stat-value">${fmt(c.contractTotal)}</div></div>
          <div class="job-stat"><div class="job-stat-label">Collected</div><div class="job-stat-value" style="color:var(--green)">${fmt(c.collectedGross)}</div></div>
          <div class="job-stat"><div class="job-stat-label">Outstanding</div><div class="job-stat-value" style="color:${c.outstanding>0?'var(--blue)':'var(--text2)'}">${fmt(c.outstanding)}</div></div>
          <div class="job-stat"><div class="job-stat-label">Emp. Balance</div><div class="job-stat-value" style="color:var(--accent)">${fmt(c.empBalance)}</div></div>
          <div class="job-stat"><div class="job-stat-label">Potential Emp.</div><div class="job-stat-value" style="color:${c.potentialEmpBalance>0?'var(--yellow)':'var(--text2)'}">${fmt(c.potentialEmpBalance)}</div></div>
        </div>
      </div>
      <div class="job-header-btns job-header-btns-stacked">
        <div class="job-header-btn-grid">
          <div class="job-header-btn-row">
            ${job.isItemized ? `<button class="btn btn-ghost btn-sm" onclick="openQuoteSnapshot('${job.id}')" title="View Quote Snapshot" style="color:var(--accent);border-color:var(--accent)">EST</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="openNotes('job','${job.id}')" title="Notes">NOTES${nc>0?` ${nc}`:''}</button>
          </div>
          <div class="job-header-btn-row">
            <button class="btn btn-ghost btn-sm" onclick="openHours('${job.id}')" title="Hours">HRS${th>0?` ${th}h`:''}</button>
          </div>
        </div>
        <div class="job-chevron" onclick="toggleJob('${job.id}')">v</div>
      </div>
    </div>
    ${isExp ? jobDetail(job, c) : ''}
  </div>`;
}

function badgeHtml(status, jobId, itemType, idx) {
  const cfg = {
    pending:   { cls:'badge-pending',   label:'○ Pending'  },
    invoiced:  { cls:'badge-invoiced',  label:'◑ Invoiced' },
    collected: { cls:'badge-collected', label:'✓ Collected'}
  };
  const { cls, label } = cfg[status] || cfg.pending;
  const admin = currentUser?.isAdmin;
  return `<span class="status-badge ${cls}"${admin ? ` onclick="cycleStatus('${jobId}','${itemType}',${idx})" title="Click to cycle"` : ''}>${label}</span>`;
}

function payTypeBadgeHtml(payType, jobId, idx) {
  const cfg = {
    '':       { cls:'badge-pending',   label:'— Pay'      },
    'advance': { cls:'badge-invoiced',  label:'◑ Advance'  },
    'final':   { cls:'badge-collected', label:'✓ Final Pay'}
  };
  const { cls, label } = cfg[payType] || cfg[''];
  const admin = currentUser?.isAdmin;
  return `<span class="status-badge ${cls}"${admin ? ` onclick="cyclePayType('${jobId}',${idx})" title="Click to cycle type"` : ''}>${label}</span>`;
}
function cyclePayType(jobId, idx) {
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job||!job.advances||job.advances[idx]===undefined) return;
  const cycle = {'':'advance','advance':'final','final':''};
  job.advances[idx].payType = cycle[job.advances[idx].payType||''];
  save(); renderJobs();
}

function jobDetail(job, c) {
  const emp    = getEmp(job.employeeId);
  const en     = esc(emp?.name || 'Employee');
  const admin  = currentUser?.isAdmin;
  const empShare = emp?.empShare ?? 0.66;
  const empPct = Math.round((job.repaymentMode ? (1-(state.settings.debtOwnerShare||0.5)) : empShare)*100);

  const milestonesHtml = (job.milestones||[]).map((m,i) => {
    const amt = (m.pct/100)*(job.quote||0);
    const st  = m.status||'pending';
    return `<div class="line-item">
      <div class="line-item-label">${esc(m.label||`Milestone ${i+1}`)} (${m.pct}%)</div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value ${st==='collected'?'green':'dim'}">${fmt(amt)}</div>
        ${badgeHtml(st,job.id,'milestones',i)}
      </div>
    </div>`;
  }).join('');

  const subtractionsHtml = (job.subtractions||[]).map((a,i) => {
    const st = a.status||'pending';
    return `<div class="line-item">
      <div class="line-item-label">${esc(a.label||'Subtraction')}${a.date?`<span style="font-size:14px;color:var(--text3);margin-left:6px">${fmtDate(a.date)}</span>`:''}</div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value red">-${fmt(a.amount)}</div>
        ${badgeHtml(st,job.id,'subtractions',i)}
        <button class="btn btn-ghost btn-sm admin-only" onclick="openAddItem('${job.id}','subtraction','${a.id}')">✏</button>
        <button class="btn btn-danger btn-sm admin-only" onclick="removeItem('${job.id}','subtractions',${i})">DEL</button>
      </div>
    </div>`;
  }).join('');

  const addOnsHtml = (job.addOns||[]).map((a,i) => {
    const st = a.status||'pending';
    return `<div class="line-item">
      <div class="line-item-label">${esc(a.label||'Addition')}${a.date?`<span style="font-size:14px;color:var(--text3);margin-left:6px">${fmtDate(a.date)}</span>`:''}</div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value ${st==='collected'?'green':'dim'}">${fmt(a.amount)}</div>
        ${badgeHtml(st,job.id,'addOns',i)}
        <button class="btn btn-ghost btn-sm admin-only" onclick="openAddItem('${job.id}','addon','${a.id}')">✏</button>
        <button class="btn btn-danger btn-sm admin-only" onclick="removeItem('${job.id}','addOns',${i})">DEL</button>
      </div>
    </div>`;
  }).join('');

  const matsHtml = (job.materials||[]).map((m,i) => `
    <div class="line-item">
      <div class="line-item-label">${esc(m.label||'Materials')}<span class="tag ${m.who==='owner'?'tag-mine':'tag-his'}">${m.who==='owner'?'EHS':en}</span></div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value red">${fmt(m.amount)}</div>
        <button class="btn btn-ghost btn-sm admin-only" onclick="openAddItem('${job.id}','material','${m.id}')">✏</button>
        <button class="btn btn-danger btn-sm admin-only" onclick="removeItem('${job.id}','materials',${i})">DEL</button>
      </div>
    </div>`).join('');

  const advHtml = (job.advances||[]).map((a,i) => `
    <div class="line-item">
      <div class="line-item-label">${esc(a.label||'Pay')} <span style="font-size:15px;color:var(--text3)">${fmtDate(a.date)||''}</span></div>
      <div class="line-item-actions" style="display:flex;align-items:center;gap:8px">
        <div class="line-item-value red">${fmt(a.amount)}</div>
        ${payTypeBadgeHtml(a.payType||'', job.id, i)}
        <button class="btn btn-ghost btn-sm admin-only" onclick="openAddItem('${job.id}','advance','${a.id}')">✏</button>
        <button class="btn btn-danger btn-sm admin-only" onclick="removeItem('${job.id}','advances',${i})">DEL</button>
      </div>
    </div>`).join('');

  return `
  <div class="job-detail">
    <div class="detail-grid">

      <div class="detail-section">
        <div class="detail-section-title">Revenue</div>
        <div class="line-item line-item-simple"><div class="line-item-label">Base Quote</div><div class="line-item-value">${fmt(job.quote)}</div></div>
        ${milestonesHtml}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Collected / Net Revenue</div>
        <div class="total-line"><span style="color:var(--text2)">Collected (gross)</span><span class="line-item-value green">${fmt(c.collectedGross)}</span></div>
        <div class="admin-only">
          <div class="line-item" style="padding-top:6px">
            <div class="line-item-label" style="font-size:16px">Est. Square fees (~${(state.settings.feeRate*100).toFixed(1)}%${state.settings.txnFee ? ` + $${state.settings.txnFee.toFixed(2)}/txn` : ''})</div>
            <div class="line-item-value red" style="font-size:16px">-${fmt(c.totalFees)}</div>
          </div>
          <div class="total-line"><span style="color:var(--text2)">Net Revenue</span><span class="line-item-value orange">${fmt(c.netRevenue)}</span></div>
        </div>
      </div>

      <div class="detail-section">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Subtractions</div>
          <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','subtraction')">+</button>
        </div>
        ${subtractionsHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None</div>'}
        ${c.subtractionTotal>0?`<div class="total-line"><span style="color:var(--text2)">Total</span><span class="line-item-value red">-${fmt(c.subtractionTotal)}</span></div>`:''}
      </div>

      <div class="detail-section">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Additions</div>
          <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','addon')">+</button>
        </div>
        ${addOnsHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None</div>'}
        ${c.addOnTotal>0?`<div class="total-line"><span style="color:var(--text2)">Total</span><span class="line-item-value" style="color:var(--purple)">+${fmt(c.addOnTotal)}</span></div>`:''}
      </div>

      <div class="detail-section">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Materials</div>
          <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','material')">+</button>
        </div>
        ${matsHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None logged</div>'}
        <div style="margin-top:4px;padding-top:4px">
          <div class="line-item admin-only"><div class="line-item-label" style="font-size:16px">EHS materials</div><div class="line-item-value dim" style="font-size:16px">-${fmt(c.ownerMats)}</div></div>
          <div class="line-item"><div class="line-item-label" style="font-size:16px">${en}'s materials</div><div class="line-item-value dim" style="font-size:16px">-${fmt(c.empMats)}</div></div>
        </div>
        <div class="total-line"><span style="color:var(--text2)">Total Materials</span><span class="line-item-value red">-${fmt(c.totalMats)}</span></div>
      </div>

      <div class="detail-section">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          <div class="detail-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">Employee Pay</div>
          <button class="btn btn-ghost btn-sm admin-only" style="padding:2px 8px" onclick="openAddItem('${job.id}','advance')">+</button>
        </div>
        ${advHtml||'<div style="color:var(--text3);font-size:16px;padding:4px 0">None logged</div>'}
        <div class="total-line"><span style="color:var(--text2)">Total Paid</span><span class="line-item-value red">-${fmt(c.advancesPaid)}</span></div>
      </div>

    </div>

    <div class="settlement-box">
      <div class="settlement-title">Settlement Breakdown${job.repaymentMode?` <span style="color:var(--red);font-size:14px;margin-left:8px">⚖ REPAYMENT SPLIT ${Math.round((state.settings.debtOwnerShare||0.5)*100)}/${Math.round((1-(state.settings.debtOwnerShare||0.5))*100)}</span>`:''}</div>
      <div class="settlement-grid" style="${admin?'':'grid-template-columns:1fr'}">
        <div class="admin-only">
          <div class="settlement-col-title">Your ${Math.round((job.repaymentMode?(state.settings.debtOwnerShare||0.5):(1-empShare))*100)}%</div>
          <div class="settlement-big orange">${fmt(c.ownerProfit)}</div>
          <div style="font-size:16px;color:var(--text3);font-family:var(--mono)">profit share</div>
          ${job.repaymentMode&&c.debtContribution>0?`<div style="font-size:16px;color:var(--red);font-family:var(--mono);margin-top:4px">⚖ ${fmt(c.debtContribution)} → debt</div>`:''}
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
            <div style="font-size:16px;color:var(--text2);font-family:var(--mono)">− Paid out: ${fmt(c.advancesPaid)}</div>
            ${c.linkedDebtPaid>0?`<div style="font-size:16px;color:var(--red);font-family:var(--mono)">− Debt repayment: ${fmt(c.linkedDebtPaid)}</div>`:''}
          </div>
          <div style="font-size:15px;color:var(--text3);font-family:var(--mono);margin-top:6px">Profit pool: ${fmt(c.profitPool)}</div>
        </div>
      </div>
    </div>

    <div class="admin-only job-detail-footer">
      <div class="job-detail-admin-actions">
        <button class="btn btn-ghost btn-sm" onclick="editJob('${job.id}')">Edit Job</button>
        <button class="btn btn-${job.status==='complete'?'ghost':'green'} btn-sm" onclick="toggleComplete('${job.id}')">
          ${job.status==='complete'?'Reopen':'Complete'}
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteJob('${job.id}')">DEL</button>
      </div>
      <div class="job-detail-mode-actions">
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
    '<option value="">— Select —</option>' +
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

// ─── SPLIT PAY ────────────────────────────────────────────────────────────────
function openSplitPay() {
  document.getElementById('sp_total').value = '';
  document.getElementById('sp_date').value  = today();
  document.getElementById('sp_label').value = '';
  const activeJobs = state.jobs.filter(j => j.status !== 'complete');
  const activeHW   = (state.homewatch || []).filter(hw => hw.status !== 'paused');
  const allocEl    = document.getElementById('sp_allocList');
  const row = (id, name, bal) => {
    const balColor = Math.round(bal * 100) > 0 ? 'var(--accent)' : 'var(--text3)';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:17px;font-weight:500">${name}</div>
        <div style="font-family:var(--mono);font-size:13px;color:${balColor}">owes: ${fmt(bal)}</div>
      </div>
      <select class="form-input sp-type-select" id="${id}_type" style="display:none;width:100px;font-size:12px;padding:4px 6px;flex-shrink:0">
        <option value="">General</option>
        <option value="advance">Advance</option>
        <option value="final">Final Pay</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="maxAlloc('${id}',${bal})" style="flex-shrink:0">Max</button>
      <input class="form-input sp-alloc-input" type="number" step="0.01" placeholder="0.00"
        id="${id}" style="max-width:100px" oninput="updateSplitTotals()" />
    </div>`;
  };
  let html = '';
  if (activeJobs.length) {
    if (activeHW.length) html += `<div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);padding:4px 0 6px">Jobs</div>`;
    html += activeJobs.map(j => row(`sp_job_${j.id}`, esc(j.name), calcJob(j).empBalance)).join('');
  }
  if (activeHW.length) {
    html += `<div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);padding:${activeJobs.length?'12px':'4px'} 0 6px">HomeWatch</div>`;
    html += activeHW.map(hw => row(`sp_hw_${hw.id}`, esc(hw.name), calcHW(hw).empBalance)).join('');
  }
  allocEl.innerHTML = html || '<div style="color:var(--text3);font-size:16px;padding:8px 0">No active jobs or HomeWatch clients.</div>';
  updateSplitTotals();
  document.getElementById('splitPayModal').classList.remove('hidden');
}
function maxAlloc(inputId, bal) {
  const total = parseFloat(document.getElementById('sp_total').value) || 0;
  let otherAllocated = 0;
  document.querySelectorAll('.sp-alloc-input').forEach(el => {
    if (el.id !== inputId) otherAllocated += parseFloat(el.value) || 0;
  });
  const remaining = total - otherAllocated;
  const value = Math.max(0, Math.min(bal, remaining));
  document.getElementById(inputId).value = value > 0 ? value.toFixed(2) : '';
  updateSplitTotals();
}
function updateSplitTotals() {
  const total = parseFloat(document.getElementById('sp_total').value) || 0;
  let allocated = 0;
  document.querySelectorAll('.sp-alloc-input').forEach(el => {
    const amt = parseFloat(el.value) || 0;
    allocated += amt;
    const typeEl = document.getElementById(el.id + '_type');
    if (typeEl) typeEl.style.display = amt > 0 ? '' : 'none';
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
    if (amt <= 0) return;
    allocated += amt;
    const payType = (document.getElementById(el.id + '_type') || {}).value || '';
    if (el.id.startsWith('sp_job_')) jobEntries.push({ jobId: el.id.slice('sp_job_'.length), amount: amt, payType });
    if (el.id.startsWith('sp_hw_'))  hwEntries.push({  hwId:  el.id.slice('sp_hw_'.length),  amount: amt, payType });
  });
  if (!jobEntries.length && !hwEntries.length) { showAlert('Please allocate at least one amount.'); return; }
  const remaining = total - allocated;
  const doSave = async () => {
    jobEntries.forEach(({ jobId, amount, payType }) => {
      const job = state.jobs.find(j => j.id === jobId);
      if (job) {
        if (!job.advances) job.advances = [];
        job.advances.push({ id: uid(), label: label || 'Split payment', amount, date, payType });
      }
    });
    hwEntries.forEach(({ hwId, amount, payType }) => {
      const hw = (state.homewatch || []).find(h => h.id === hwId);
      if (hw) {
        if (!hw.advances) hw.advances = [];
        hw.advances.push({ id: uid(), label: label || 'Split payment', amount, date, payType });
      }
    });
    await save(); renderAll(); closeModal('splitPayModal');
  };
  if (Math.abs(remaining) > 0.01) {
    showConfirm(`${fmt(Math.abs(remaining))} is ${remaining > 0 ? 'unallocated' : 'over-allocated'}. Save anyway?`, doSave);
  } else {
    doSave();
  }
}

function toggleRepayment(id) {
  const j = state.jobs.find(j=>j.id===id);
  if (!j) return;
  j.repaymentMode = !j.repaymentMode;
  save(); renderJobs();
}
function toggleJob(id) {
  if (expandedJobs.has(id)) expandedJobs.delete(id); else expandedJobs.add(id);
  saveExpandedState();
  renderJobs();
}
function cycleStatus(jobId, itemType, idx) {
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job||!job[itemType]||!job[itemType][idx]) return;
  const item = job[itemType][idx];
  if (item.status === 'collected') {
    showConfirm('Mark this as Pending? This will remove it from collected revenue.', () => {
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
  if (j&&j[key]) { j[key].splice(idx,1); save(); renderJobs(); }
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
  document.getElementById('notesModalTitle').textContent = `Notes — ${entity.name}`;
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
          <span class="note-date-label">${fmtDate(n.date)||n.date||'—'}</span>
          <div class="note-actions">
            <button class="btn btn-ghost btn-sm" onclick="openEditNote('${n.id}')">✏</button>
            <button class="btn btn-danger btn-sm" onclick="deleteNote('${n.id}')">DEL</button>
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
  document.getElementById('hoursModalTitle').textContent = `Hours — ${job.name}`;
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
          <button class="btn btn-danger btn-sm" onclick="deleteHoursEntry('${h.id}')">DEL</button>
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
function setMilestoneMode(mode) {
  const dms = state.settings.defaultMilestones || [];
  if (mode === 'default' && !dms.length) {
    document.getElementById('milestoneHint').textContent = 'No defaults set — configure them in Settings → Jobs.';
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
    hint.textContent = 'Full invoice — one payment to track.';
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
function openNewJobModal() {
  editingJobId = null;
  document.getElementById('jobModalTitle').textContent = 'New Job';
  document.getElementById('f_name').value    = '';
  document.getElementById('f_contact').value = '';
  document.getElementById('f_quote').value   = '';
  document.getElementById('f_date').value    = today();
  document.getElementById('f_itemized').checked = false;
  document.getElementById('quoteItemList').innerHTML = '';
  quoteItemCount = 0;
  toggleItemizedQuote();
  setMilestoneMode('single');
  populateEmpDropdown('f_emp', 'f_emp_wrap', null);
  document.getElementById('jobModal').classList.remove('hidden');
}
function editJob(id) {
  const job = state.jobs.find(j=>j.id===id);
  if (!job) return;
  editingJobId = id;
  document.getElementById('jobModalTitle').textContent = 'Edit Job';
  document.getElementById('f_name').value    = job.name;
  document.getElementById('f_contact').value = job.contactName || '';
  document.getElementById('f_quote').value   = job.quote;
  document.getElementById('f_date').value    = job.date||'';
  document.getElementById('f_itemized').checked = job.isItemized||false;
  document.getElementById('quoteItemList').innerHTML = '';
  quoteItemCount = 0;
  if (job.isItemized && job.quoteItems?.length) {
    job.quoteItems.forEach(qi => addQuoteItemField(qi.label, qi.amount));
  }
  toggleItemizedQuote();
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
  populateEmpDropdown('f_emp', 'f_emp_wrap', job.employeeId);
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
    <button class="btn btn-danger btn-sm" onclick="document.getElementById('dmrow_${id}').remove();updateDmPreview()">DEL</button>`;
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
    <button class="btn btn-danger btn-sm" onclick="document.getElementById('mrow_${id}').remove();updateMilestonePreview()">DEL</button>`;
  document.getElementById('milestoneList').appendChild(div);
  updateMilestonePreview();
}
function updateMilestonePreview() {
  let total=0;
  document.querySelectorAll('[id^="mpct_"]').forEach(el=>{total+=parseFloat(el.value)||0;});
  const err = document.getElementById('milestoneError');
  err.textContent = (Math.abs(total-100)>0.01&&total>0) ? `Milestones total ${total}% — must equal 100%` : '';
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
    <button class="btn btn-danger btn-sm" onclick="document.getElementById('qitem_${id}').remove();updateQuoteItemTotal()">DEL</button>`;
  document.getElementById('quoteItemList').appendChild(div);
  updateQuoteItemTotal();
}
function updateQuoteItemTotal() {
  let total = 0;
  document.querySelectorAll('[id^="qiamt_"]').forEach(el => { total += parseFloat(el.value)||0; });
  const el = document.getElementById('quoteItemTotal');
  if (el) el.textContent = '$' + total.toFixed(2);
}
function saveJob() {
  const name        = document.getElementById('f_name').value.trim();
  const contactName = document.getElementById('f_contact').value.trim();
  const date        = document.getElementById('f_date').value;
  const isItemized  = document.getElementById('f_itemized').checked;
  if (!name) { showAlert('Please enter a client name.'); return; }
  let quote, quoteItems = [];
  if (isItemized) {
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
  if (milestoneMode === 'single') {
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
      job.name=name; job.contactName=contactName; job.quote=quote; job.date=date; job.isItemized=isItemized; job.quoteItems=quoteItems;
      if (employeeId) job.employeeId = employeeId;
      milestones.forEach((m,i)=>{ if(job.milestones[i]) m.status=job.milestones[i].status||'pending'; });
      job.milestones=milestones;
    }
  } else {
    const newId = uid();
    expandedJobs.add(newId);
    saveExpandedState();
    state.jobs.push({ id:newId, name, contactName, quote, date, isItemized, quoteItems, status:'active',
      milestones, addOns:[], subtractions:[], materials:[], advances:[], fees:[], jobNotes:[], hours:[], repaymentMode:false,
      employeeId: employeeId || '' });
  }
  save(); renderJobs(); closeModal('jobModal');
  if (isNew || name.toLowerCase() !== originalName.toLowerCase()) checkNewClientPrompt(name);
}

// ─── ADD ITEM MODAL ───────────────────────────────────────────────────────────
function openAddItem(jobId, type, itemId = null) {
  addItemContext = { jobId, type, itemId };
  const job = state.jobs.find(j => j.id === jobId);
  const en = esc(getEmp(job?.employeeId)?.name || 'Employee');
  const isEdit = !!itemId;
  const titles = { addon: isEdit?'Edit Addition':'Add Addition', subtraction: isEdit?'Edit Subtraction':'Add Subtraction', material: isEdit?'Edit Material':'Add Material', advance: isEdit?'Edit Employee Pay':'Add Employee Pay' };
  document.getElementById('addItemTitle').textContent = titles[type];
  let html='';
  if (type==='addon') {
    html=`<div class="form-group"><label class="form-label">Description</label><input class="form-input" id="ai_label" placeholder="e.g. Extra electrical work" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Amount ($)</label><input class="form-input" id="ai_amount" type="number" step="0.01" placeholder="0.00" /></div>
        <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="ai_date" type="date" value="${today()}" /></div>
      </div>`;
  } else if (type==='subtraction') {
    const subJob = state.jobs.find(j => j.id === jobId);
    const hasItems = subJob?.isItemized && subJob?.quoteItems?.length > 0;
    const usedSourceIds = (subJob?.subtractions||[]).filter(s => s.id !== itemId && s.sourceItemId).map(s => s.sourceItemId);
    const sourceHtml = hasItems ? `
      <div class="form-group"><label class="form-label">Line Item</label>
        <select class="form-input" id="ai_source" onchange="fillSubtractionFromItem()">
          <option value="">— Select a line item</option>
          ${(subJob.quoteItems).map(qi => {
            const used = usedSourceIds.includes(qi.id);
            return `<option value="${qi.id}"${used ? ' disabled' : ''}>${esc(qi.label)} (${fmt(qi.amount)})${used ? ' — already subtracted' : ''}</option>`;
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
      </div>`;
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
          </select>
        </div>
      </div>`;
  }
  document.getElementById('addItemForm').innerHTML = html;
  if (isEdit) {
    const arr = type==='addon' ? job?.addOns : type==='subtraction' ? job?.subtractions : type==='material' ? job?.materials : job?.advances;
    const item = arr?.find(x => x.id === itemId);
    if (item) {
      document.getElementById('ai_label').value = item.label || '';
      document.getElementById('ai_amount').value = item.amount || '';
      if (type==='addon'||type==='subtraction'||type==='advance') document.getElementById('ai_date').value = item.date || '';
      if (type==='material') document.getElementById('ai_who').value = item.who || 'owner';
      if (type==='advance') document.getElementById('ai_paytype').value = item.payType || '';
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
function saveItem() {
  if (!addItemContext) return;
  const { jobId, type, itemId } = addItemContext;
  const job = state.jobs.find(j=>j.id===jobId);
  if (!job) return;
  const label  = document.getElementById('ai_label')?.value.trim()||'';
  const amount = parseFloat(document.getElementById('ai_amount')?.value)||0;
  if (amount<=0) { showAlert('Please enter a valid amount.'); return; }
  if (type==='addon') {
    const date = document.getElementById('ai_date')?.value||'';
    if (itemId) {
      const item = job.addOns.find(x=>x.id===itemId);
      if (item) { item.label=label; item.amount=amount; item.date=date; }
    } else {
      job.addOns.push({ id:uid(), label, amount, date, status:'pending' });
    }
  } else if (type==='subtraction') {
    const date = document.getElementById('ai_date')?.value||'';
    const sourceEl = document.getElementById('ai_source');
    const isManual = !sourceEl || document.getElementById('ai_manual')?.checked;
    const sourceItemId = (!isManual && sourceEl?.value) ? sourceEl.value : null;
    if (itemId) {
      const item = job.subtractions.find(x=>x.id===itemId);
      if (item) { item.label=label; item.amount=amount; item.date=date; item.sourceItemId=sourceItemId; }
    } else {
      job.subtractions.push({ id:uid(), label, amount, date, status:'pending', sourceItemId });
    }
  } else if (type==='material') {
    const who = document.getElementById('ai_who').value;
    if (itemId) {
      const item = job.materials.find(x=>x.id===itemId);
      if (item) { item.label=label; item.amount=amount; item.who=who; }
    } else {
      job.materials.push({ id:uid(), label, amount, who });
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
      ? row(esc(qi.label), fmt(qi.amount), { strikethrough:true, sub:`✕ Removed${sub.label ? ': ' + esc(sub.label) : ''}` })
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
function openSettings() {
  document.getElementById('s_feeRate').value         = +((state.settings.feeRate || 0.026) * 100).toFixed(3);
  document.getElementById('s_txnFee').value          = state.settings.txnFee ?? 0.30;
  document.getElementById('s_debtOriginal').value    = state.settings.debtOriginal || 2256.58;
  document.getElementById('s_debtOwnerShare').value  = Math.round((state.settings.debtOwnerShare || 0.50) * 100);
  const debtEmp = getEmp(state.settings.debtEmployeeId);
  document.getElementById('s_debtHint').textContent  = debtEmp
    ? `Debt assigned to ${debtEmp.name}. Extra above their normal split counts toward debt.`
    : 'Extra above normal split counts toward debt.';
  // Populate default milestones
  document.getElementById('dmList').innerHTML = '';
  dmCount = 0;
  (state.settings.defaultMilestones || []).forEach(m => addDmField(m.label, m.pct));
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
  const defaultMilestones = []; let dmTotal = 0;
  document.querySelectorAll('[id^="dmpct_"]').forEach((el, i) => {
    const pct = parseFloat(el.value) || 0;
    const dmId = el.id.slice('dmpct_'.length);
    const lbl = document.getElementById(`dmlabel_${dmId}`)?.value.trim() || `Milestone ${i+1}`;
    defaultMilestones.push({ label: lbl, pct }); dmTotal += pct;
  });
  if (defaultMilestones.length && Math.abs(dmTotal - 100) > 0.01) {
    showAlert(`Default milestones total ${dmTotal}% — must equal 100%.`); return;
  }
  state.settings.defaultMilestones = defaultMilestones;
  save(); renderAll(); closeModal('settingsModal');
}
function openMySettings() {
  document.getElementById('ms_whoami').textContent = currentUser?.name || '';
  document.getElementById('mySettingsModal').classList.remove('hidden');
}

// ─── TABS & MODALS ────────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'schedule') renderSchedule();
  if (name === 'homewatch') renderHomewatch();
  if (name === 'clients') renderClients();
}
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

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
  showLogin();
}

function loadExpandedState() {
  try {
    const uid = currentUser?.id || 'default';
    expandedJobs = new Set(JSON.parse(localStorage.getItem(`exp_${uid}`)   || '[]'));
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
          <span class="user-row-badge${u.isAdmin?'':' emp'}">${u.isAdmin ? 'Admin' : `Employee · ${Math.round((u.empShare??0.66)*100)}%`}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${!u.isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="openEditEmp('${u.id}')">Edit</button>` : ''}
          ${u.isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="openResetPin('${u.id}')">Reset PIN</button>` : ''}
          ${!u.isAdmin || users.filter(x=>x.isAdmin).length > 1
            ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">DEL</button>`
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
  document.getElementById('empEditTitle').textContent = `Edit — ${esc(u.name)}`;
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
      showAlert('Multiple employees — use the Edit button on the target employee to assign debt there.');
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
        <div class="appt-name" style="display:flex;align-items:center;gap:6px">${esc(a.clientName)}${a.clientName && clientByName(a.clientName) ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;flex-shrink:0" onclick="event.stopPropagation();openClientQuick('${esc(a.clientName)}')" title="View Client">👤</button>` : ''}</div>
        <div class="appt-meta">
          <span>📅 ${fmtDate(a.date)}</span>
          <span style="color:var(--purple)">HomeWatch${a.paused?' · Paused':''}</span>
          <span>${fmt(a.monthlyRate)}/mo</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" style="color:var(--purple);border-color:var(--purple)" onclick="goToHW('${a.hwId}')">View</button>
    </div>` : `
    <div class="appt-card${isPast?' past':''}">
      <div style="flex:1;min-width:0">
        <div class="appt-name" style="display:flex;align-items:center;gap:6px">${esc(a.clientName||'')}${a.clientName && clientByName(a.clientName) ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px;flex-shrink:0" onclick="event.stopPropagation();openClientQuick('${esc(a.clientName)}')" title="View Client">👤</button>` : ''}</div>
        ${a.contactName ? `<div style="font-size:13px;color:var(--blue);margin-top:2px;font-family:var(--mono);display:flex;align-items:center;gap:6px">via ${esc(a.contactName)}${clientByName(a.contactName) ? ` <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px" onclick="event.stopPropagation();openClientQuick('${esc(a.contactName)}')" title="View Client">👤</button>` : ''}</div>` : ''}
        <div class="appt-meta">
          <span>📅 ${a.endDate ? `${fmtDate(a.date)} – ${fmtDate(a.endDate)}` : fmtDate(a.date)}</span>
          ${a.time?`<span>🕐 ${fmtTime(a.time)}</span>`:''}
          ${a.address?`<span>📍 ${esc(a.address)}</span>`:''}
        </div>
        ${a.notes?`<div class="appt-notes">${esc(a.notes)}</div>`:''}
      </div>
      <div class="appt-actions">
        <button class="btn btn-ghost btn-sm" onclick="openAppt('${a.id}')">✏</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAppt('${a.id}')">DEL</button>
      </div>
    </div>`;

  // Mobile day filter: show only that day with a back button
  if (selectedDayFilter) {
    const dayAppts = allAppts.filter(a => a.endDate ? (a.date <= selectedDayFilter && a.endDate >= selectedDayFilter) : a.date === selectedDayFilter);
    const backBtn = `<button class="btn btn-ghost btn-sm" style="margin-bottom:14px" onclick="selectedDayFilter=null;setSchedView('month')">‹ Back to calendar</button>`;
    const header = `<div style="font-family:var(--mono);font-size:13px;color:var(--text3);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.08em">${fmtDate(selectedDayFilter)}</div>`;
    const cards = dayAppts.length
      ? dayAppts.map(a => apptCard(a, false)).join('')
      : '<div class="no-appts">No appointments on this day.</div>';
    return backBtn + header + cards + '<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="openApptOnDate(\'' + selectedDayFilter + '\')">+ Add on this day</button>';
  }

  const upcoming = allAppts.filter(a => (a.endDate || a.date) >= todayStr);
  const past     = allAppts.filter(a => (a.endDate || a.date) < todayStr).reverse();

  const upcomingHtml = upcoming.length ? upcoming.map(a => apptCard(a, false)).join('') : '';
  const pastHtml     = past.length     ? past.map(a => apptCard(a, true)).join('')     : '';

  return `
    ${upcomingHtml || '<div class="no-appts">📅 No upcoming appointments.<br>Tap + Appointment to add one.</div>'}
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
      if (a.type === 'hw') return `<div class="cal-hw-pill${a.paused?' hw-paused':''}" onclick="event.stopPropagation();goToHW('${a.hwId}')" title="${esc(a.clientName)} — ${fmt(a.monthlyRate)}/mo${a.paused?' (Paused)':''}">${esc(a.clientName)}</div>`;
      const isStart = a.date === dateStr;
      const isCont  = !isStart && a.endDate;
      return `<div class="cal-appt-pill${isCont?' cal-appt-cont':''}" onclick="event.stopPropagation();openAppt('${a.id}')" title="${esc(a.clientName||'Appt')}">${isCont?'↳ ':''}${esc(a.clientName||'Appt')}</div>`;
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
        <div class="day-drawer-title">${fmtDate(selectedCalDay)}${dayAppts.length===0?' — No appointments':''}</div>
        ${dayAppts.map(a => a.type === 'hw' ? `
          <div class="appt-card hw-appt${a.paused?' past':''}" style="margin-bottom:8px">
            <div style="flex:1;min-width:0">
              <div class="appt-name">${esc(a.clientName)}</div>
              <div class="appt-meta">
                <span style="color:var(--purple)">HomeWatch${a.paused?' · Paused':''}</span>
                <span>${fmt(a.monthlyRate)}/mo</span>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" style="color:var(--purple);border-color:var(--purple)" onclick="goToHW('${a.hwId}')">View</button>
          </div>` : `
          <div class="appt-card" style="margin-bottom:8px">
            <div style="flex:1">
              <div class="appt-name">${esc(a.clientName||'')}</div>
              <div class="appt-meta">
                ${a.endDate?`<span>📅 ${fmtDate(a.date)} – ${fmtDate(a.endDate)}</span>`:''}
                ${a.time?`<span>🕐 ${fmtTime(a.time)}</span>`:''}
                ${a.address?`<span>📍 ${esc(a.address)}</span>`:''}
              </div>
              ${a.notes?`<div class="appt-notes">${esc(a.notes)}</div>`:''}
            </div>
            <div class="appt-actions">
              <button class="btn btn-ghost btn-sm" onclick="openAppt('${a.id}')">✏</button>
              <button class="btn btn-danger btn-sm" onclick="deleteAppt('${a.id}')">DEL</button>
            </div>
          </div>`).join('')}
        <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="openApptOnDate('${selectedCalDay}')">+ Add on this day</button>
      </div>`;
  }

  return `
    <div class="cal-nav">
      <button class="btn btn-ghost btn-sm" onclick="changeMonth(-1)">‹ Prev</button>
      <div class="cal-month-label">${monthNames[month]} ${year}</div>
      <button class="btn btn-ghost btn-sm" onclick="changeMonth(1)">Next ›</button>
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
    document.querySelectorAll('.sched-view-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === 'list'));
    const appts = (state.appointments||[]).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    renderSchedView(appts);
    return;
  }
  selectedCalDay = selectedCalDay === dateStr ? null : dateStr;
  const appts = (state.appointments||[]).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  renderSchedView(appts);
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  selectedCalDay = null;
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
  document.getElementById('ap_endDate').value  = appt ? (appt.endDate||'') : '';
  document.getElementById('ap_address').value  = appt ? (appt.address||'') : '';
  document.getElementById('ap_notes').value    = appt ? (appt.notes||'') : '';
  document.getElementById('ap_allDay').checked = appt ? !!appt.allDay : false;
  toggleApptAllDay();
  document.getElementById('apptModal').classList.remove('hidden');
}

function toggleApptAllDay() {
  const allDay = document.getElementById('ap_allDay').checked;
  const timeEl = document.getElementById('ap_time');
  const endEl  = document.getElementById('ap_endDate');
  const label  = document.getElementById('ap_timeLabel');
  timeEl.style.display  = allDay ? 'none' : '';
  endEl.style.display   = allDay ? '' : 'none';
  label.textContent     = allDay ? 'End date' : 'Time';
  if (allDay) {
    timeEl.value = '';
    if (!endEl.value) endEl.value = document.getElementById('ap_date').value || '';
  } else {
    endEl.value = '';
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
  const rawEnd = document.getElementById('ap_endDate').value;
  const endDate = (allDay && rawEnd && rawEnd > date) ? rawEnd : null;
  const appt = {
    clientName,
    contactName: document.getElementById('ap_contact').value.trim(),
    date,
    allDay,
    endDate:  endDate || null,
    time:     allDay ? '' : document.getElementById('ap_time').value,
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
      `${added} new client${added!==1?'s':''} added automatically. ${conflicts.length} existing record${conflicts.length!==1?' have':' has'} changed fields — review below.`;
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
  const visible = state.settings.clientColumns || CLIENT_DEFAULT_COLS;
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
  let cols = [...(state.settings.clientColumns || CLIENT_DEFAULT_COLS)];
  if (on) { if (!cols.includes(key)) cols.push(key); }
  else { cols = cols.filter(k => k !== key); }
  state.settings.clientColumns = cols;
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
    const visible = state.settings.clientColumns && state.settings.clientColumns.length ? state.settings.clientColumns : CLIENT_DEFAULT_COLS;
    return CLIENT_COLS.filter(c => visible.includes(c.key));
  })();
  document.getElementById('clientCount').textContent = `${clients.length} Client${clients.length!==1?'s':''}`;
  const lastImport = state.settings.clientsLastImport;
  document.getElementById('clientsLastImport').textContent = lastImport ? `Last import: ${fmtDate(lastImport)}` : '';
  if (clients.length === 0) {
    document.getElementById('clientsList').innerHTML = `<div style="font-family:var(--mono);font-size:14px;color:var(--text3);padding:48px 0;text-align:center">No clients yet.<br><br><button class="btn btn-ghost btn-sm admin-only" onclick="triggerClientImport()">⬆ Import Square CSV</button></div>`;
    applyAdminClasses(); return;
  }
  const fmtVal = (c, key) => {
    const v = c[key];
    if (v === undefined || v === null || v === '') return `<span style="color:var(--text3)">—</span>`;
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
            const note = (c.clientNotes||[]).length ? ` <span title="Has notes" style="color:var(--accent)">✎</span>` : '';
            const isExpanded = expandedClients.has(c.id);
            const expandCols = (() => {
              const ec = state.settings.clientExpandCols;
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
            ].filter(Boolean).join(' · ');
            return `<tr class="client-row${isExpanded?' client-row-expanded':''}" id="crow_${c.id}" onclick="toggleClientExpand('${c.id}')">
              <td style="color:var(--text);font-weight:500">${esc(name)}${sub}${note}</td>
              ${cols.map(col=>`<td title="${esc(String(c[col.key]||''))}">${fmtVal(c,col.key)}</td>`).join('')}
              <td style="text-align:right;white-space:nowrap;color:var(--text3);font-size:11px;font-family:var(--mono);width:24px">${isExpanded?'▲':'▼'}</td>
            </tr>
            <tr class="client-expand-row" id="cexp_${c.id}" style="${isExpanded?'':'display:none'}">
              <td colspan="${cols.length + 2}" style="padding:0;border-bottom:1px solid var(--border)">
                <div style="padding:14px 16px;background:var(--bg2)">
                  ${sqParts ? `<div style="font-family:var(--mono);font-size:12px;color:var(--text3);padding:7px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;margin-bottom:8px">📊 ${sqParts}</div>` : ''}
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px 24px;margin-bottom:12px">
                    ${allDetails || '<span style="color:var(--text3);font-size:13px">No additional info.</span>'}
                  </div>
                  ${(() => {
                    const recentNotes = (c.clientNotes||[]).slice(-3).reverse();
                    const notesInlineHtml = recentNotes.length
                      ? `<div style="max-height:110px;overflow-y:auto;display:flex;flex-direction:column;gap:5px">
                          ${recentNotes.map(n=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:6px 10px">
                            <div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:2px">${esc(n.authorName)} · ${fmtDate(n.date)}</div>
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
                    <button class="btn btn-ghost btn-sm admin-only" onclick="event.stopPropagation();openClientDetail('${c.id}')">✏ Edit</button>
                    <button class="btn btn-ghost btn-sm employee-only" onclick="event.stopPropagation();openClientDetail('${c.id}')">✎ Notes</button>
                    <button class="btn btn-danger btn-sm admin-only" onclick="event.stopPropagation();deleteClient('${c.id}')">DEL</button>
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
  ].filter(Boolean).join(' · ');
  const id = c.id;
  const sqBar = sqParts ? `<div style="font-family:var(--mono);font-size:12px;color:var(--text3);margin-bottom:14px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px">📊 ${sqParts}</div>` : '';
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
      ${!clientDetailIsNew ? `<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="exportClientToSquare('${id}')">⬇ Export to Square CSV</button></div>` : ''}
      ${notesSection}
    `;
  } else {
    const ro = (label, val) => `<div><div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);margin-bottom:3px">${label}</div><div style="font-family:var(--mono);font-size:14px;color:var(--text2)">${esc(val||'—')}</div></div>`;
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
        <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:6px">${esc(n.authorName||'Unknown')} · ${fmtDate(n.date)||n.date}</div>
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
          <button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:11px" onclick="startNoteEdit('${c.id}','${n.id}')">✏</button>
          <button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:11px" onclick="deleteClientNote('${c.id}','${n.id}')">DEL</button>
        </div>`
      : empCanAct
      ? `<div style="display:flex;gap:4px;align-items:center">
          <span style="font-family:var(--mono);font-size:10px;color:var(--text3)">${secsLeft}s</span>
          <button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:11px" onclick="startNoteEdit('${c.id}','${n.id}')">✏</button>
          <button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:11px" onclick="empDeleteNote('${c.id}','${n.id}')">DEL</button>
        </div>`
      : '';
    return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-family:var(--mono);font-size:11px;color:var(--text3)">${esc(n.authorName||'Unknown')} · ${fmtDate(n.date)||n.date}</span>
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
  clientDetailIsNew = false;
  pendingNewClientName = null;
  if (_noteCountdownInterval) { clearInterval(_noteCountdownInterval); _noteCountdownInterval = null; }
  save(); closeModal('clientDetailModal'); renderClients();
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
    const sub  = [c.city, c.email].filter(Boolean).join(' · ');
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
const _empNoteTimers = {}; // noteId → expiry timestamp (ms) for employee 30s edit window
let _noteCountdownInterval = null;
function openClientQuick(name) {
  const c = clientByName(name);
  if (!c) return;
  _cqClientId = c.id;
  document.getElementById('cqName').textContent = [c.firstName, c.surname].filter(Boolean).join(' ') || c.company || c.email || name;
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
  ].filter(Boolean).join(' · ');
  const quickCols = (() => {
    const qc = state.settings.clientQuickCols;
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
      <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-bottom:4px">${esc(n.authorName)} · ${fmtDate(n.date)}</div>
      <div style="color:var(--text2);font-size:13px;white-space:pre-wrap">${esc(n.text)}</div>
    </div>`).join('') : '<div style="color:var(--text3);font-size:13px">No notes.</div>';
  document.getElementById('cqBody').innerHTML = `
    ${sqParts ? `<div style="font-family:var(--mono);font-size:12px;color:var(--text3);padding:7px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;margin-bottom:12px">📊 ${sqParts}</div>` : ''}
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
  const btn = document.querySelector(`.tabs .tab[onclick*="'${name}'"]`);
  if (btn) switchTab(name, btn);
}

// ─── TABS SCROLL INDICATOR ────────────────────────────────────────────────────
function _initSettingsNavScroll() {
  const nav = document.querySelector('.settings-nav');
  const wrap = document.querySelector('.settings-nav-wrap');
  if (!nav || !wrap) return;
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
