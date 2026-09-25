(function attachTracker2LegacyCleanup(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2LegacyCleanup = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLegacyCleanup() {
  'use strict';

  function arrayAt(state, key) {
    return Array.isArray(state?.[key]) ? state[key] : [];
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clientMatchNames(client) {
    if (!client) return [];
    return [
      [client.firstName, client.surname].filter(Boolean).join(' '),
      client.company || '',
      client.email || ''
    ].map(value => String(value).trim()).filter(Boolean);
  }

  function clientCandidates(job, clients) {
    const jobName = String(job?.name || '').trim().toLowerCase();
    if (!jobName) return [];
    return clients.filter(client => new Set(clientMatchNames(client).map(name => name.toLowerCase())).has(jobName));
  }

  function partialCounts(job) {
    return ['milestones', 'revenueItems', 'addOns', 'subtractions'].reduce((counts, key) => {
      counts[key] = Array.isArray(job?.[key])
        ? job[key].filter(item => !!item?.partialState).length
        : 0;
      return counts;
    }, {});
  }

  function buildCleanupPlan(state, { sampleLimit = 5 } = {}) {
    const jobs = arrayAt(state, 'jobs');
    const clients = arrayAt(state, 'clients');
    const legacyMarkerChanges = jobs
      .filter(job => job?.createdVia === undefined)
      .map(job => ({
        jobId: job.id || '',
        changes: { createdVia: 'legacy' }
      }));

    const missingClientJobs = jobs.filter(job => !job?.clientId);
    const clientAssignments = [];
    const ambiguousClientMatches = [];
    const unmatchedClientJobs = [];
    missingClientJobs.forEach(job => {
      const matches = clientCandidates(job, clients);
      if (matches.length === 1) {
        clientAssignments.push({
          jobId: job.id || '',
          clientId: matches[0].id || '',
          match: 'exact-unique'
        });
      } else if (matches.length > 1) {
        ambiguousClientMatches.push({
          jobId: job.id || '',
          candidateClientIds: matches.map(client => client.id || '')
        });
      } else {
        unmatchedClientJobs.push({ jobId: job.id || '' });
      }
    });

    const partialReview = jobs
      .filter(job => Object.values(partialCounts(job)).some(count => count > 0))
      .map(job => ({ jobId: job.id || '', itemCounts: partialCounts(job) }));

    const sample = items => items.slice(0, sampleLimit);
    return {
      sourceCounts: {
        jobs: jobs.length,
        clients: clients.length,
        missingCreatedVia: legacyMarkerChanges.length,
        missingClientId: missingClientJobs.length,
        legacyPartialJobs: partialReview.length
      },
      proposedChanges: {
        legacyMarkerChanges,
        clientAssignments
      },
      reviewRequired: {
        ambiguousClientMatches,
        unmatchedClientJobs,
        partialReview
      },
      summary: {
        legacyMarkersToAdd: legacyMarkerChanges.length,
        clientIdsToAdd: clientAssignments.length,
        ambiguousClientMatches: ambiguousClientMatches.length,
        unmatchedClientJobs: unmatchedClientJobs.length,
        partialJobsToReview: partialReview.length,
        partialItemsToReview: partialReview.reduce((total, entry) => total + Object.values(entry.itemCounts).reduce((sum, count) => sum + count, 0), 0)
      },
      samples: {
        legacyMarkerChanges: sample(legacyMarkerChanges),
        clientAssignments: sample(clientAssignments),
        ambiguousClientMatches: sample(ambiguousClientMatches),
        unmatchedClientJobs: sample(unmatchedClientJobs),
        partialReview: sample(partialReview)
      }
    };
  }

  function applyCleanupPlan(state, {
    legacyMarkerJobIds = [],
    clientAssignments = [],
    newClient = null
  } = {}) {
    const next = clone(state || {});
    const jobs = arrayAt(next, 'jobs');
    const clients = arrayAt(next, 'clients');
    const markerIds = new Set(legacyMarkerJobIds);
    const assignmentByJob = new Map(clientAssignments.map(entry => [entry.jobId, entry.clientId]));

    jobs.forEach(job => {
      if (markerIds.has(job.id)) {
        if (job.createdVia !== undefined && job.createdVia !== 'legacy') {
          throw new Error(`Job ${job.id} already has a different createdVia value.`);
        }
        job.createdVia = 'legacy';
      }
      if (assignmentByJob.has(job.id)) {
        const clientId = assignmentByJob.get(job.id);
        if (job.clientId !== undefined && job.clientId !== clientId) {
          throw new Error(`Job ${job.id} already has a different clientId value.`);
        }
        job.clientId = clientId;
      }
    });
    const jobIds = new Set(jobs.map(job => job.id));
    [...markerIds, ...assignmentByJob.keys()].forEach(jobId => {
      if (!jobIds.has(jobId)) throw new Error(`Cleanup references missing job ${jobId}.`);
    });
    clientAssignments.forEach(entry => {
      if (!clients.some(client => client.id === entry.clientId) && (!newClient || newClient.id !== entry.clientId)) {
        throw new Error(`Cleanup references missing client ${entry.clientId}.`);
      }
    });
    if (newClient) {
      const existing = clients.find(client => client.id === newClient.id);
      if (!existing) clients.push(clone(newClient));
      else if (JSON.stringify(existing) !== JSON.stringify(newClient)) {
        throw new Error(`Client ${newClient.id} already exists with different data.`);
      }
    }
    next.jobs = jobs;
    next.clients = clients;
    return next;
  }

  return Object.freeze({
    applyCleanupPlan,
    buildCleanupPlan,
    clientCandidates,
    clientMatchNames
  });
});
