(function attachTracker2MigrationAudit(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2MigrationAudit = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMigrationAudit() {
  'use strict';

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function arrayAt(state, key) {
    return Array.isArray(state?.[key]) ? state[key] : [];
  }

  function sampleId(value) {
    return value?.id || value?.name || '(no id)';
  }

  function createAudit({ id, label, category = 'legacy', run }) {
    if (!id || !label || typeof run !== 'function') {
      throw new Error('Migration audits require an id, label, and run function.');
    }
    return Object.freeze({ id, label, category, run });
  }

  function nestedItems(state, keys) {
    return arrayAt(state, 'jobs').flatMap(job => keys.flatMap(key => (
      Array.isArray(job?.[key])
        ? job[key].map(item => ({ job, item, key }))
        : []
    )));
  }

  function homewatchItems(state, key) {
    return arrayAt(state, 'homewatch').flatMap(homewatch => (
      Array.isArray(homewatch?.[key])
        ? homewatch[key].map(item => ({ homewatch, item }))
        : []
    ));
  }

  function result(count, samples = []) {
    return { count: Number(count) || 0, samples: samples.slice(0, 5) };
  }

  function defaultAudits() {
    const jobItemKeys = ['milestones', 'revenueItems', 'addOns', 'subtractions'];
    return [
      createAudit({
        id: 'settings.historicalAdj',
        label: 'Settings with old historicalAdj field',
        run: state => result(state?.settings?.historicalAdj !== undefined ? 1 : 0, ['settings'])
      }),
      createAudit({
        id: 'clients.stringNotes',
        label: 'Clients with old string notes',
        run: state => {
          const matches = arrayAt(state, 'clients').filter(client => typeof client?.clientNotes === 'string');
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'jobs.missingCreatedVia',
        label: 'Jobs missing createdVia (historical candidates)',
        category: 'historical',
        run: state => {
          const matches = arrayAt(state, 'jobs').filter(job => job?.createdVia === undefined);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'jobs.missingClientId',
        label: 'Jobs missing clientId (historical matching candidates)',
        category: 'historical',
        run: state => {
          const matches = arrayAt(state, 'jobs').filter(job => !job?.clientId);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'jobs.hourly2',
        label: 'Jobs with retired hourly2 type',
        run: state => {
          const matches = arrayAt(state, 'jobs').filter(job => job?.jobType === 'hourly2');
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'jobs.oldNotes',
        label: 'Jobs with old notes field',
        run: state => {
          const matches = arrayAt(state, 'jobs').filter(job => typeof job?.notes === 'string');
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'jobItems.collectedBoolean',
        label: 'Milestones/add-ons with old collected boolean',
        run: state => {
          const items = nestedItems(state, ['milestones', 'addOns']).filter(({ item }) => item?.collected !== undefined);
          return result(items.length, items.map(({ job, item }) => `${job.id}:${sampleId(item)}`));
        }
      }),
      createAudit({
        id: 'jobs.legacyPartialState',
        label: 'Jobs with legacy partial-payment state',
        category: 'historical',
        run: state => {
          const items = nestedItems(state, jobItemKeys);
          const matches = arrayAt(state, 'jobs').filter(job => items.some(entry => entry.job === job && !!entry.item?.partialState));
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'jobItems.legacyPartialState',
        label: 'Line items with legacy partial-payment state',
        category: 'historical',
        run: state => {
          const matches = nestedItems(state, jobItemKeys).filter(({ item }) => !!item?.partialState);
          return result(matches.length, matches.map(({ job, item }) => `${job.id}:${sampleId(item)}`));
        }
      }),
      createAudit({
        id: 'partialCollections.missingSnapshot',
        label: 'Partial collections missing rollback snapshots',
        category: 'historical',
        run: state => {
          const matches = arrayAt(state, 'jobs').flatMap(job => (
            Array.isArray(job?.partialCollections)
              ? job.partialCollections.filter(item => !isRecord(item?.snapshotBefore)).map(item => `${job.id}:${sampleId(item)}`)
              : []
          ));
          return result(matches.length, matches);
        }
      }),
      createAudit({
        id: 'splitPayments.missingIds',
        label: 'Split payments missing IDs',
        category: 'current-shape',
        run: state => {
          const matches = arrayAt(state, 'splitPayments').filter(payment => !payment?.id);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'splitPayments.missingDates',
        label: 'Split payments missing dates',
        category: 'current-shape',
        run: state => {
          const matches = arrayAt(state, 'splitPayments').filter(payment => payment?.date === undefined);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'debtPayments.missingLinks',
        label: 'Debt payments missing link fields',
        category: 'current-shape',
        run: state => {
          const matches = arrayAt(state, 'debtPayments').filter(payment => payment?.linkedJobId === undefined || payment?.linkedHWId === undefined);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'appointments.missingContactName',
        label: 'Appointments missing contactName',
        category: 'current-shape',
        run: state => {
          const matches = arrayAt(state, 'appointments').filter(appointment => appointment?.contactName === undefined);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'appointments.missingEndTime',
        label: 'Appointments missing endTime',
        category: 'current-shape',
        run: state => {
          const matches = arrayAt(state, 'appointments').filter(appointment => appointment?.endTime === undefined);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'users.missingEmployeeShare',
        label: 'Employees missing individual share',
        category: 'current-shape',
        run: state => {
          const matches = arrayAt(state, 'users').filter(user => !user?.isAdmin && user?.empShare === undefined);
          return result(matches.length, matches.map(sampleId));
        }
      }),
      createAudit({
        id: 'homewatchPayments.missingBillingState',
        label: 'Homewatch payments missing billingState',
        category: 'current-shape',
        run: state => {
          const matches = homewatchItems(state, 'payments').filter(({ item }) => !item?.billingState);
          return result(matches.length, matches.map(({ homewatch, item }) => `${homewatch.id}:${sampleId(item)}`));
        }
      }),
      createAudit({
        id: 'homewatchPayments.missingReconcileStatus',
        label: 'Homewatch payments missing reconcileStatus',
        category: 'current-shape',
        run: state => {
          const matches = homewatchItems(state, 'payments').filter(({ item }) => !item?.reconcileStatus);
          return result(matches.length, matches.map(({ homewatch, item }) => `${homewatch.id}:${sampleId(item)}`));
        }
      }),
      createAudit({
        id: 'jobItems.missingBillingState',
        label: 'Job line items missing billingState',
        category: 'current-shape',
        run: state => {
          const matches = nestedItems(state, jobItemKeys).filter(({ item }) => !item?.billingState);
          return result(matches.length, matches.map(({ job, item }) => `${job.id}:${sampleId(item)}`));
        }
      }),
      createAudit({
        id: 'jobItems.missingReconcileStatus',
        label: 'Job line items missing reconcileStatus',
        category: 'current-shape',
        run: state => {
          const matches = nestedItems(state, jobItemKeys).filter(({ item }) => !item?.reconcileStatus);
          return result(matches.length, matches.map(({ job, item }) => `${job.id}:${sampleId(item)}`));
        }
      }),
      createAudit({
        id: 'jobAdvances.missingSplitEventId',
        label: 'Job advances missing splitEventId',
        category: 'current-shape',
        run: state => {
          const matches = arrayAt(state, 'jobs').flatMap(job => (
            Array.isArray(job?.advances)
              ? job.advances.filter(item => item?.splitEventId === undefined).map(item => `${job.id}:${sampleId(item)}`)
              : []
          ));
          return result(matches.length, matches);
        }
      }),
      createAudit({
        id: 'homewatchAdvances.missingSplitEventId',
        label: 'Homewatch advances missing splitEventId',
        category: 'current-shape',
        run: state => {
          const matches = homewatchItems(state, 'advances').filter(({ item }) => item?.splitEventId === undefined);
          return result(matches.length, matches.map(({ homewatch, item }) => `${homewatch.id}:${sampleId(item)}`));
        }
      })
    ];
  }

  function auditState(state, { audits = defaultAudits() } = {}) {
    const results = audits.map(audit => {
      const value = audit.run(state || {});
      const normalized = typeof value === 'number' ? result(value) : result(value?.count, value?.samples || []);
      return {
        id: audit.id,
        label: audit.label,
        category: audit.category,
        count: normalized.count,
        samples: normalized.samples
      };
    });
    return {
      topLevelCounts: {
        jobs: arrayAt(state, 'jobs').length,
        clients: arrayAt(state, 'clients').length,
        homewatch: arrayAt(state, 'homewatch').length,
        users: arrayAt(state, 'users').length,
        appointments: arrayAt(state, 'appointments').length,
        splitPayments: arrayAt(state, 'splitPayments').length,
        debtPayments: arrayAt(state, 'debtPayments').length
      },
      results,
      zero: results.filter(item => item.count === 0),
      nonZero: results.filter(item => item.count > 0)
    };
  }

  return Object.freeze({ auditState, createAudit, defaultAudits });
});
