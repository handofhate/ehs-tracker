# Tracker 2.0 migration audit

This is a separate, read-only audit tool for deciding when migration-only compatibility code can be retired.

Run it from the repository root:

```powershell
node scripts/migration-audit.js
```

The command opens the local Tracker 2.0 preview, reads the raw Firestore `jobtracker/state` document, and reports counts plus a few sample IDs. It does not call Firestore write methods and is not loaded by the tracker application.

The reusable audit engine lives in `v2/migration-audit.js`. Future checks can be added with `createAudit({ id, label, category, run })` and passed to `auditState(state, { audits })` without changing the tracker or the existing default checks.

Keep the audit separate until the migration boundary is complete. Before removing a compatibility path, run the audit again and verify that the relevant check is zero. Historical checks for old jobs, missing client IDs, and legacy partial payments should remain nonzero until those records have an explicit historical-data strategy.
