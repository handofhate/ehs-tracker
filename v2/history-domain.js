(function attachTracker2History(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./job-domain'));
  } else {
    root.Tracker2History = factory(root.Tracker2JobDomain);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHistoryDomain(jobDomain) {
  'use strict';

  if (!jobDomain) throw new Error('Tracker 2.0 job domain is required.');
  const clone = jobDomain.clone;
  const roundMoney = jobDomain.roundMoney;

  function clientMatchNames(client) {
    if (!client) return [];
    return [
      [client.firstName, client.surname].filter(Boolean).join(' '),
      client.company || '',
      client.email || ''
    ].map(value => String(value).trim()).filter(Boolean);
  }

  function jobBelongsToClient(job, client) {
    if (!job || !client) return false;
    if (job.clientId === client.id) return true;
    if (job.clientId) return false;
    const names = new Set(clientMatchNames(client).map(name => name.toLowerCase()));
    return names.has(String(job.name || '').trim().toLowerCase());
  }

  function normalizeForHistory(job) {
    if (job?.createdVia === 'unified-v2') return clone(job);
    return jobDomain.normalizeLegacyJob(job);
  }

  function jobsForClient(jobs, client) {
    return (Array.isArray(jobs) ? jobs : [])
      .filter(job => jobBelongsToClient(job, client))
      .map(normalizeForHistory)
      .sort((a, b) => {
        const dateOrder = String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || ''));
        return dateOrder || String(b.id || '').localeCompare(String(a.id || ''));
      });
  }

  function isCollected(item) {
    return ['collected', 'paid'].includes(item?.status) || item?.billingState === 'paid';
  }

  // A partial payment is represented twice in the job data: once as the
  // payment record and once as a collected child line. The payment record is
  // the history event; the synthetic child must not create a second event.
  function isSyntheticPartialItem(job, item) {
    if (!item || !Array.isArray(job?.partialCollections) || !job.partialCollections.length) return false;
    if (item.partialState === 'paid') return true;
    return !!item.partialCollectionId && job.partialCollections.some(payment => payment?.id === item.partialCollectionId);
  }

  function milestoneAmount(job, milestone) {
    if (job?.milestoneBasis === 'amount' && milestone?.amount !== undefined) {
      return roundMoney(milestone.amount);
    }
    return roundMoney((Number(milestone?.pct || 0) / 100) * Number(job?.quote || 0));
  }

  function paymentHistoryForJob(job) {
    const events = [];
    (job.milestones || []).forEach(item => {
      if (!isCollected(item) || isSyntheticPartialItem(job, item)) return;
      events.push({
        id: item.id,
        source: 'milestone',
        jobId: job.id,
        label: item.label || 'Milestone',
        amount: milestoneAmount(job, item),
        date: item.date || job.date || job.createdAt || '',
        item: clone(item)
      });
    });
    (job.revenueItems || []).forEach(item => {
      if (!isCollected(item) || isSyntheticPartialItem(job, item)) return;
      events.push({
        id: item.id,
        source: 'revenue',
        jobId: job.id,
        label: item.label || 'Revenue',
        amount: roundMoney(item.amount),
        date: item.date || job.date || job.createdAt || '',
        item: clone(item)
      });
    });
    (job.addOns || []).forEach(item => {
      if (!isCollected(item) || isSyntheticPartialItem(job, item)) return;
      events.push({
        id: item.id,
        source: 'addition',
        jobId: job.id,
        label: item.label || 'Addition',
        amount: roundMoney(item.amount),
        date: item.date || job.date || job.createdAt || '',
        item: clone(item)
      });
    });
    (job.subtractions || []).forEach(item => {
      if (!isCollected(item) || isSyntheticPartialItem(job, item)) return;
      events.push({
        id: item.id,
        source: 'credit',
        jobId: job.id,
        label: item.label || 'Credit',
        amount: -roundMoney(item.amount),
        date: item.date || job.date || job.createdAt || '',
        item: clone(item)
      });
    });
    (job.partialCollections || []).forEach(item => {
      events.push({
        id: item.id,
        source: 'partial-collection',
        jobId: job.id,
        label: item.note || 'Partial collection',
        amount: roundMoney(item.paymentTotal),
        tipAmount: roundMoney(item.tipAmount),
        date: item.date || job.date || job.createdAt || '',
        item: clone(item)
      });
    });
    return events;
  }

  function employeePayHistoryForJob(job) {
    return (job.advances || []).map(item => ({
      id: item.id,
      jobId: job.id,
      employeeId: job.employeeId || '',
      amount: roundMoney(item.amount),
      date: item.date || job.date || job.createdAt || '',
      payType: item.payType || 'advance',
      item: clone(item)
    }));
  }

  function buildClientHistory({ client, jobs = [], calculateJob = null } = {}) {
    const normalizedClient = clone(client || {});
    const normalizedJobs = jobsForClient(jobs, client);
    const jobSummaries = normalizedJobs.map(job => ({
      job,
      legacy: !!job.legacy,
      calculations: typeof calculateJob === 'function' ? clone(calculateJob(job)) : null
    }));
    const notes = [
      ...(client?.clientNotes || []).map(note => ({ ...clone(note), source: 'client', jobId: null })),
      ...normalizedJobs.flatMap(job => (job.jobNotes || []).map(note => ({ ...clone(note), source: 'job', jobId: job.id })))
    ];
    const payments = normalizedJobs.flatMap(paymentHistoryForJob);
    const employeePay = normalizedJobs.flatMap(employeePayHistoryForJob);
    const timeline = [
      ...jobSummaries.map(summary => ({ type: 'job', id: summary.job.id, jobId: summary.job.id, date: summary.job.date || summary.job.createdAt || '', item: summary.job })),
      ...notes.map(note => ({ type: 'note', id: note.id, jobId: note.jobId, date: note.date || '', item: note })),
      ...payments.map(payment => ({ type: 'payment', id: payment.id, jobId: payment.jobId, date: payment.date || '', item: payment })),
      ...employeePay.map(payment => ({ type: 'employee-pay', id: payment.id, jobId: payment.jobId, date: payment.date || '', item: payment }))
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.type).localeCompare(String(b.type)));

    return { client: normalizedClient, jobs: normalizedJobs, jobSummaries, notes, payments, employeePay, timeline };
  }

  return Object.freeze({
    buildClientHistory,
    clientMatchNames,
    jobBelongsToClient,
    jobsForClient,
    normalizeForHistory,
    paymentHistoryForJob
  });
});
