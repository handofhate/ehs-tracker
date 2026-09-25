# Tracker 2.0 migration audit

This is a separate, read-only audit tool for deciding when migration-only compatibility code can be retired.

Run it from the repository root:

```powershell
node scripts/migration-audit.js
```

The command opens the local Tracker 2.0 preview, reads the raw Firestore `jobtracker/state` document, and reports counts plus a few sample IDs. It does not call Firestore write methods and is not loaded by the tracker application.

The reusable audit engine lives in `v2/migration-audit.js`. Future checks can be added with `createAudit({ id, label, category, run })` and passed to `auditState(state, { audits })` without changing the tracker or the existing default checks.

The one-time cleanup planner and guarded apply tool completed their work and are archived at `migration/archive/legacy-cleanup/`. They are not loaded by the tracker or normal test suite. The pre-change Firestore document remains archived outside the repository.

Keep the audit separate until the migration boundary is complete. Before removing a compatibility path, run the audit again and verify that the relevant check is zero. Historical checks for old jobs, missing client IDs, and legacy partial payments may remain nonzero when those records have an explicit historical-data strategy. The two current legacy partial-payment jobs are intentionally retained as read-only exceptions; new partial collections are blocked on those records and use the current format everywhere else.
