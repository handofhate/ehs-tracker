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

  function applyCleanupPlan() {
    throw new Error('Live cleanup is intentionally not implemented. Review the dry-run plan first.');
  }

  return Object.freeze({
    applyCleanupPlan,
    buildCleanupPlan,
    clientCandidates,
    clientMatchNames
  });
});
