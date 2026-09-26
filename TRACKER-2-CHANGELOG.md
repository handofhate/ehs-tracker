# Tracker 2.0 changelog

This is the running changelog for the Tracker 2.0 rebuild and local preview. It summarizes the meaningful product, data, safety, and testing changes on the `codex/tracker-2-preview` branch compared with Tracker 1.0. The detailed implementation history remains available in Git commits.

Tracker 2.0 is not released or cut over. Tracker 1.0 remains the production build, and the local preview does not permanently write to Firestore.

## Unreleased — local preview through 2026-09-25

### Added

- Added a local-only Tracker 2.0 preview that reads current Firestore data in real time while keeping edits, undo/redo, and Square actions local to the browser session.
- Added a separate preview launcher and automated test runner.
- Added a unified job domain with support for quoted, itemized, hourly, materials, credits, milestones, notes, employee pay, tips, advances, and partial collections.
- Added a shared client-history read model that combines jobs, notes, payments, and employee-pay history.
- Added modular domain areas for financial calculations, fees, state normalization, persistence, backup handling, debt, migration audits, historical partial payments, and client history.
- Added a reusable migration audit and a guarded, review-first legacy cleanup process.
- Added an explicit historical boundary for the two jobs that still require legacy partial-payment compatibility.
- Added the Tracker 2.0 Overview workspace with attention cards, shared invoice visibility, employee pay summaries, Recent Pay, and workspace notes.
- Added sticky-note behavior including team/admin visibility, pinning, completion, editing, deletion, truncation, and expanded-note editing.
- Added automated domain tests, browser smoke tests, payment regression coverage, preview no-write checks, backup validation, and local Square helper tests.

### Changed

- Made `New Job` the only visible new-job entry point in the preview; the older editor remains only as a temporary legacy compatibility path.
- Made Overview the default landing area and removed redundant Overview quick links in favor of the main tabs.
- Combined Active Jobs and Recurring Services into one attention card and standardized the invoice card layout.
- Made the shared Outstanding/Pending Invoices summary visible to all employees for the current small-team setup. It uses business-wide active-job invoice totals; per-user visibility is deferred until the team expands.
- Aligned the employee Recent Pay timeframe selector with the admin card header in the upper-right position.
- Reorganized Settings around appearance, client display, job defaults, team, financial rules, Square integration, data/backup, and temporary tools.
- Kept client display defaults separate from each user’s personal preferences.
- Kept the one-time debt feature isolated so it can be removed later without untangling ordinary employee-pay behavior.
- Locked job and recurring-payment fee rates to individual records and backfilled historical records using the unchanged current rate.
- Added admin guards around global settings, employee/debt administration, and backup import/export.
- Added automatic pre-import backups and clearer destructive import confirmation.
- Removed zero-count legacy conversions after confirming they were no longer needed by current records.
- Preserved historical client links and financial history while applying approved legacy cleanup matches.

### Fixed and hardened

- Prevented preview edits from overwriting newer realtime server snapshots or reaching Firestore.
- Hardened manual payments and partial collections against duplicate history entries, orphaned generated notes, and payout-ledger drift.
- Clarified employee-pay activity and preserved the distinction between advances, pay, collected billing, and pending billing.
- Protected completed and fee-locked financial records from recalculation when global settings change.
- Preserved historical partial-payment behavior without allowing new records to depend on the old compatibility path.
- Added malformed-backup rejection and full-state backup serialization tests.
- Added browser-level regression checks for unified jobs, notes, themes, payments, partial collections, fee-rate protection, and preview safety.

### Deferred or known limitations

- Square integration is not active yet. Square customer sync, invoicing, reconciliation, webhooks, and true transaction-fee handling remain future work.
- The Overview invoice card currently summarizes job billing; recurring-service billing remains a separate future integration concern.
- Employees currently share the invoice-summary visibility rule. Per-user billing visibility is intentionally deferred.
- Persistent activity history, durable undo/redo, queued saves, record-level conflict handling, and minimum server-enforced production security remain future work.
- Client-management expansion, recurring billing beyond the current service model, deeper reports, and attachments are deferred until their surrounding workflows are defined.
- The old editor and remaining migration compatibility code cannot be removed until the historical cutover boundary, archive, and rollback checks are complete.

## Changelog maintenance rules

- Add a concise entry here for every meaningful Tracker 2.0 behavior, data-model, safety, migration, or testing change.
- Keep unfinished ideas in `TRACKER-2-TODO.md` or `TRACKER-2-FEATURE-REVIEW.md`; move them here only when implemented and verified.
- Before release, split the Unreleased section into a dated 2.0 release entry and record the final cutover date, migration result, test result, and known limitations.
- Do not describe a change as production-ready until Tracker 1.0 rollback, historical data validation, and the cutover checklist have passed.
