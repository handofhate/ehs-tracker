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

  function roundPercent(value) {
    return Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
  }

  function buildMilestones({
    mode = 'single',
    basis = 'percent',
    target = 0,
    existing = [],
    entries = [],
    idFactory = () => globalThis.crypto.randomUUID()
  } = {}) {
    const valueBasis = basis === 'amount' ? 'amount' : 'percent';
    const prior = Array.isArray(existing) && existing.length === 1 ? clone(existing[0]) : null;
    if (mode === 'single') {
      return {
        ok: true,
        milestones: [{
          ...(prior || {}),
          id: prior?.id || idFactory(),
          label: 'Invoice',
          ...(valueBasis === 'amount'
            ? { amount: roundMoney(target), pct: 100 }
            : { pct: 100 }),
          status: prior?.status || 'pending'
        }],
        error: ''
      };
    }

    const milestones = [];
    let total = 0;
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      const value = Number(entry?.value || 0);
      const preset = clone(entry?.preset || {});
      const label = String(entry?.label || '').trim() || `Milestone ${milestones.length + 1}`;
      if (value > 0) {
        milestones.push({
          ...preset,
          id: preset.id || idFactory(),
          label,
          ...(valueBasis === 'amount'
            ? { amount: roundMoney(value), pct: 100 * value / Math.max(0.01, Number(target || 0)) }
            : { pct: roundPercent(value) }),
          status: preset.status || 'pending'
        });
      }
      total += value;
    });

    const expected = valueBasis === 'amount' ? Number(target || 0) : 100;
    if (!milestones.length || Math.abs(total - expected) > 0.01) {
      return {
        ok: false,
        milestones: null,
        error: {
          basis: valueBasis,
          total: valueBasis === 'amount' ? roundMoney(total) : roundPercent(total),
          expected: valueBasis === 'amount' ? roundMoney(expected) : 100
        }
      };
    }
    return { ok: true, milestones, error: '' };
  }

  function buildCollections({ job = null, lines = [], date = '', hourlyOnly = false, idFactory = () => globalThis.crypto.randomUUID() } = {}) {
    const source = job || {};
    const storedLines = Array.isArray(source.unifiedLines) && source.unifiedLines.length
      ? clone(source.unifiedLines)
      : legacyLines(source);
    const originalIds = new Set(storedLines.map(line => line?.id).filter(Boolean));
    if (!originalIds.size) lines.forEach(line => { if (line?.id) originalIds.add(line.id); });
    const originalMaterialIds = new Set(storedLines.filter(line => line?.type === 'material').map(line => line.id).filter(Boolean));
    if (!originalMaterialIds.size) lines.filter(line => line?.type === 'material').forEach(line => originalMaterialIds.add(line.id));
    const previousTypeById = new Map(storedLines.map(line => [line?.id, line?.type]));
    const find = (items, id) => (items || []).find(item => item?.id === id);
    const findLinkedMaterialCharge = id => (source.addOns || []).find(item => item?.chargeType === 'materials' && item?.sourceItemId === id);
    const cleanCopy = value => clone(value);
    const findRecord = (id) => {
      const groups = [source.quoteItems, source.materials, source.subtractions, source.addOns];
      for (const items of groups) {
        const item = (items || []).find(entry => entry?.id === id);
        if (item) return item;
      }
      return null;
    };

    const extraQuoteItems = (source.quoteItems || []).filter(item => !originalIds.has(item?.id)).map(cleanCopy);
    const extraMaterials = (source.materials || []).filter(item => !originalIds.has(item?.id)).map(cleanCopy);
    const extraSubtractions = (source.subtractions || []).filter(item => !originalIds.has(item?.id)).map(cleanCopy);
    const extraAddOns = (source.addOns || [])
      .filter(item => !originalIds.has(item?.id) && !(item?.chargeType === 'materials' && originalMaterialIds.has(item?.sourceItemId)))
      .map(cleanCopy);
    const quoteItems = [];
    const materials = [];
    const addOns = [];
    const subtractions = [];

    lines.forEach(line => {
      const type = line.type;
      const previousType = previousTypeById.get(line.id);
      const priorDirect = findRecord(line.id);
      const priorAddOn = find(source.addOns, line.id) || (previousType === 'material' ? findLinkedMaterialCharge(line.id) : null);

      if (type === 'fixed') {
        if (line.unifiedAddition) {
          addOns.push({
            ...(priorAddOn ? cleanCopy(priorAddOn) : {}),
            id: line.id,
            label: line.label,
            description: line.description,
            amount: line.amount,
            date: priorAddOn?.date || date,
            status: priorAddOn?.status || 'pending',
            isHours: false,
            hours: 0,
            rate: 0,
            chargeType: 'other'
          });
          return;
        }
        quoteItems.push({ ...(priorDirect ? cleanCopy(priorDirect) : {}), id: line.id, label: line.label, description: line.description, amount: line.amount });
        return;
      }
      if (type === 'material') {
        const priorMaterial = find(source.materials, line.id);
        materials.push({
          ...(priorMaterial ? cleanCopy(priorMaterial) : {}),
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
        });
        if (!hourlyOnly && line.billClient) {
          addOns.push({
            ...(priorAddOn ? cleanCopy(priorAddOn) : {}),
            id: priorAddOn?.id || idFactory(),
            label: line.label,
            description: line.description,
            amount: line.amount,
            date: priorAddOn?.date || date,
            status: priorAddOn?.status || 'pending',
            isHours: false,
            hours: 0,
            rate: 0,
            chargeType: 'materials',
            sourceItemId: line.id
          });
        }
        return;
      }
      if (type === 'hourly' || type === 'other') {
        const next = {
          ...(priorAddOn ? cleanCopy(priorAddOn) : {}),
          id: line.id,
          label: line.label,
          description: line.description,
          amount: line.amount,
          date: priorAddOn?.date || date,
          status: priorAddOn?.status || 'pending',
          isHours: type === 'hourly',
          hours: type === 'hourly' ? line.hours : 0,
          rate: type === 'hourly' ? line.rate : 0,
          chargeType: type === 'hourly' ? 'hourly' : 'other'
        };
        delete next.sourceItemId;
        addOns.push(next);
        return;
      }
      if (type === 'credit') {
        subtractions.push({
          ...(priorDirect ? cleanCopy(priorDirect) : {}),
          id: line.id,
          label: line.label,
          description: line.description,
          amount: line.amount,
          date: priorDirect?.date || date,
          status: priorDirect?.status || 'pending',
          sourceItemId: null
        });
      }
    });

    quoteItems.push(...extraQuoteItems);
    materials.push(...extraMaterials);
    addOns.push(...extraAddOns);
    subtractions.push(...extraSubtractions);
    return { quoteItems, materials, addOns, subtractions };
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
    buildCollections,
    buildMilestones,
    buildUnifiedJobRecord,
    clone,
    legacyLines,
    normalizeLegacyJob,
    roundMoney,
    roundPercent,
    validateJobDraft
  });
});
