(function attachTracker2JobDomain(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2JobDomain = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createJobDomain() {
  'use strict';

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function validateJobDraft({ name, lines, existingJob = null, financialLocked = false } = {}) {
    const errors = [];
    const cleanName = String(name || '').trim();
    const cleanLines = Array.isArray(lines) ? lines : [];

    if (!cleanName) errors.push('Please enter a client name.');
    if (!cleanLines.length) errors.push('Add at least one work or charge line.');
    if (cleanLines.some(line => line.type !== 'material' && Number(line.amount || 0) <= 0)) {
      errors.push('Every work and charge line needs an amount greater than $0.');
    }
    if (cleanLines.some(line => line.type === 'material' && Number(line.reimbursementAmount || 0) <= 0)) {
      errors.push('Materials need a reimbursement / cost amount greater than $0.');
    }
    if (cleanLines.some(line => line.type === 'material' && line.billClient && Number(line.amount || 0) <= 0)) {
      errors.push('Billed materials need a client charge greater than $0, or turn off billing for that material.');
    }

    if (financialLocked && existingJob && ['hourly', 'hourly2'].includes(existingJob.jobType)) {
      const originalIds = new Set((existingJob.unifiedLines || []).map(line => line?.id).filter(Boolean));
      if (cleanLines.some(line => !originalIds.has(line.id) && !['hourly', 'material'].includes(line.type))) {
        errors.push('Hourly jobs can add hours or materials only.');
      }
    }

    return { ok: errors.length === 0, errors };
  }

  function applyProtectedEdits({
    job,
    lines = [],
    contactName = '',
    date = '',
    notes = '',
    primaryNoteId = '',
    author = {},
    idFactory = () => globalThis.crypto.randomUUID(),
    isMaterialBillingLocked = () => false,
    syncMaterialCharge = () => {},
    recordMaterialChange = () => {}
  } = {}) {
    const next = clone(job || {});
    const originalLines = Array.isArray(job?.unifiedLines) && job.unifiedLines.length
      ? clone(job.unifiedLines)
      : legacyLines(job);
    const originalIds = new Set(originalLines.map(line => line?.id).filter(Boolean));
    const originalById = new Map(originalLines.map(line => [line.id, line]));
    const storedLines = lines.map(line => {
      const stored = { ...clone(line) };
      const prior = originalById.get(line.id);
      if (!originalIds.has(line.id) && line.type === 'fixed') {
        stored.unifiedAddition = true;
      } else if (prior && line.type === 'material') {
        const billingLocked = isMaterialBillingLocked(job, line.id);
        if (billingLocked) {
          stored.amount = prior.amount;
          stored.clientAmount = prior.clientAmount ?? prior.amount;
          stored.billClient = prior.billClient !== false;
        }
      } else if (prior) {
        stored.amount = prior.amount;
        stored.hours = prior.hours || 0;
        stored.rate = prior.rate || 0;
        stored.reimbursementAmount = prior.reimbursementAmount || 0;
        stored.who = prior.who;
        stored.billClient = prior.billClient !== false;
      }
      return stored;
    });

    next.contactName = contactName;
    next.unifiedLines = storedLines;
    next.workSummary = lines.map(line => line.description).filter(Boolean).join(', ');
    upsertPrimaryNote(next, {
      text: notes,
      date: job?.date || date,
      primaryNoteId,
      author,
      idFactory
    });

    const updateDescription = (line, item) => {
      if (!item) return;
      item.label = line.label;
      item.description = line.description;
    };

    lines.forEach(line => {
      const isNew = !originalIds.has(line.id);
      if (isNew) {
        if (line.type === 'material') {
          const material = {
            id: line.id,
            label: line.label,
            description: line.description,
            amount: line.reimbursementAmount,
            who: line.who,
            billClient: !!line.billClient,
            clientAmount: line.amount,
            reimbursementAmount: line.reimbursementAmount,
            chargeAmount: line.billClient ? line.amount : 0,
            costAmount: line.reimbursementAmount
          };
          if (!Array.isArray(next.materials)) next.materials = [];
          next.materials.push(material);
          syncMaterialCharge(next, material);
          return;
        }
        if (line.type === 'credit') {
          if (!Array.isArray(next.subtractions)) next.subtractions = [];
          next.subtractions.push({
            id: line.id,
            label: line.label,
            description: line.description,
            amount: line.amount,
            date: next.date || date,
            status: 'pending',
            sourceItemId: null
          });
          return;
        }
        if (!Array.isArray(next.addOns)) next.addOns = [];
        next.addOns.push({
          id: line.id,
          label: line.label,
          description: line.description,
          amount: line.amount,
          date: next.date || date,
          status: 'pending',
          isHours: line.type === 'hourly',
          hours: line.type === 'hourly' ? line.hours : 0,
          rate: line.type === 'hourly' ? line.rate : 0,
          chargeType: line.type === 'hourly' ? 'hourly' : 'other'
        });
        return;
      }

      (next.quoteItems || []).filter(item => item.id === line.id).forEach(item => updateDescription(line, item));
      (next.materials || []).filter(item => item.id === line.id).forEach(item => updateDescription(line, item));
      (next.subtractions || []).filter(item => item.id === line.id || item.partialGroupId === line.id).forEach(item => updateDescription(line, item));
      (next.addOns || []).filter(item => item.id === line.id || item.partialGroupId === line.id || item.sourceItemId === line.id).forEach(item => updateDescription(line, item));

      if (line.type !== 'material') return;
      const material = (next.materials || []).find(item => item.id === line.id);
      if (!material) return;
      const before = {
        reimbursementAmount: material.reimbursementAmount,
        costAmount: material.costAmount,
        amount: material.amount,
        who: material.who
      };
      material.amount = line.reimbursementAmount;
      material.reimbursementAmount = line.reimbursementAmount;
      material.costAmount = line.reimbursementAmount;
      material.who = line.who;
      if (!isMaterialBillingLocked(next, line.id)) {
        material.clientAmount = line.amount;
        material.billClient = !!line.billClient;
        material.chargeAmount = line.billClient ? line.amount : 0;
      }
      recordMaterialChange(material, before);
      syncMaterialCharge(next, material);
    });
    return next;
  }

  function upsertPrimaryNote(job, { text = '', date = '', primaryNoteId = '', author = {}, idFactory }) {
    if (!Array.isArray(job.jobNotes)) job.jobNotes = [];
    const index = primaryNoteId
      ? job.jobNotes.findIndex(note => note?.id === primaryNoteId)
      : -1;
    if (index >= 0) {
      if (text) {
        job.jobNotes[index].text = text;
        job.jobNotes[index].date = date;
      } else {
        job.jobNotes.splice(index, 1);
      }
      return;
    }
    if (text) {
      job.jobNotes.push({
        id: idFactory(),
        text,
        date,
        authorId: author.id || '',
        authorName: author.name || 'Admin',
        source: 'unified-job'
      });
    }
  }

  function buildUnifiedJobRecord({
    existingJob = null,
    draft = {},
    collections = {},
    milestones = [],
    idFactory = () => globalThis.crypto.randomUUID()
  } = {}) {
    const quoteItems = clone(collections.quoteItems || []);
    const materials = clone(collections.materials || []);
    const addOns = clone(collections.addOns || []);
    const subtractions = clone(collections.subtractions || []);
    const lines = clone(draft.lines || []);
    const job = existingJob ? clone(existingJob) : {
      id: idFactory(),
      status: 'active',
      advances: [],
      tips: [],
      fees: [],
      jobNotes: [],
      hours: [],
      partialCollections: [],
      repaymentMode: false,
      revenueItems: [],
      hourlyStatus: 'pending',
      hourlySquareInvoiceId: '',
      createdVia: 'unified-v2'
    };

    job.name = String(draft.name || '').trim();
    job.contactName = String(draft.contactName || '').trim();
    job.clientId = draft.clientId || '';
    job.contactClientId = draft.contactClientId || '';
    job.quote = roundMoney(quoteItems.reduce((sum, line) => sum + Number(line.amount || 0), 0));
    job.date = draft.date || '';
    job.isItemized = quoteItems.length > 0;
    job.quoteItems = quoteItems;
    job.milestones = clone(milestones);
    job.milestoneBasis = draft.milestoneBasis || 'percent';
    job.workCompleted = draft.workCompleted !== false;
    job.addOns = addOns;
    job.subtractions = subtractions;
    job.materials = materials;
    job.workSummary = lines.map(line => line.description).filter(Boolean).join(', ');
    job.jobType = draft.jobType === 'hourly' ? 'hourly' : 'quoted';
    job.hourlyRate = roundMoney(draft.hourlyRate);
    job.employeeId = draft.employeeId || '';
    job.createdVia = 'unified-v2';
    job.unifiedLines = lines;
    upsertPrimaryNote(job, {
      text: String(draft.notes || '').trim(),
      date: job.date,
      primaryNoteId: draft.primaryNoteId || '',
      author: draft.author || {},
      idFactory
    });
    return job;
  }

  function legacyLines(job) {
    if (Array.isArray(job?.unifiedLines) && job.unifiedLines.length) return clone(job.unifiedLines);
    return [
      ...(job?.quoteItems || []).map(item => ({
        id: item.id,
        type: 'fixed',
        label: item.label,
        description: item.description || '',
        amount: roundMoney(item.amount)
      })),
      ...(job?.addOns || [])
        .filter(item => item?.chargeType !== 'materials')
        .map(item => ({
          id: item.id,
          type: item.isHours ? 'hourly' : 'other',
          label: item.label,
          description: item.description || '',
          amount: roundMoney(item.amount),
          hours: roundMoney(item.hours),
          rate: roundMoney(item.rate)
        })),
      ...(job?.materials || []).map(item => ({
        id: item.id,
        type: 'material',
        label: item.label,
        description: item.description || '',
        amount: roundMoney(item.clientAmount ?? item.chargeAmount ?? item.amount),
        reimbursementAmount: roundMoney(item.reimbursementAmount ?? item.costAmount ?? item.amount),
        who: item.who || 'owner',
        billClient: item.billClient !== false
      })),
      ...(job?.subtractions || []).map(item => ({
        id: item.id,
        type: 'credit',
        label: item.label,
        description: item.description || '',
        amount: roundMoney(item.amount)
      }))
    ].filter(line => line.id);
  }

  function normalizeLegacyJob(job) {
    const normalized = clone(job || {});
    normalized.createdVia = normalized.createdVia || 'legacy';
    normalized.legacy = true;
    normalized.readOnly = true;
    normalized.unifiedLines = legacyLines(normalized);
    return normalized;
  }

  return Object.freeze({
    applyProtectedEdits,
    buildUnifiedJobRecord,
    clone,
    legacyLines,
    normalizeLegacyJob,
    roundMoney,
    validateJobDraft
  });
});
