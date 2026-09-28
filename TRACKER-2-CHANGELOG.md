# Tracker 2.0 changelog

This is the running changelog for the Tracker 2.0 rebuild and local preview. It summarizes the meaningful product, data, safety, and testing changes on the `codex/tracker-2-preview` branch compared with Tracker 1.0. The detailed implementation history remains available in Git commits.

Tracker 2.0 is not released or cut over. Tracker 1.0 remains the production build, and the local preview does not permanently write to Firestore.

## Unreleased — local preview through 2026-09-27

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
- Added a stable local-only preview fixture dataset with three payout test jobs and three Overview notes. Fixtures are merged into live read snapshots and never written to Firestore.
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
- Replaced the visible Pay Out and Split Pay header actions with one Employee Payment flow. Job and recurring-service payment buttons now open that same flow with the source and current balance preselected.
- Kept the existing `splitPayments` storage name for compatibility while routing new employee payments through one save path with employee, date, total, and allocations recorded together.
- Simplified employee payments by always listing open jobs and active recurring services. Payment intent is inferred automatically: positive allocations remain General/partial pay unless they exceed the current balance, over-balance or zero-balance allocations become Advances, and negative allocations become Adjustments. Final Pay remains an explicit per-source choice rather than being inferred from the amount.
- Split a single over-balance allocation into separate General and Advance history records while keeping it one payment event, added sign-aware row Max behavior for negative adjustments and extra advances, and added clear buttons beside allocation inputs.
- Removed the ambiguous "advance available" row label and grouped employee-payment sources by current pay owed. Sources with positive pay owed appear first; other eligible open work is available in a collapsed section, while a source opened directly from a job remains visible.
- Aligned the employee-payment controls and kept browser regression coverage focused on payment defaults, source selection, allocation, and clear behavior rather than fragile styling details.
- Simplified the employee-payment modal by changing the top MAX control to match allocation rows, centering it vertically, removing the redundant PAY OWED header, and removing the duplicate divider before Other eligible work.
- Added a matching clear-X control around the total payment amount, placed MAX/input/clear in the same order as allocation rows, and widened individual allocation inputs from 100px to 150px.
- Fixed the total-payment clear control and retained regression coverage for the control and its allocation behavior.
- Made each allocation-row MAX button two-stage: the first click fills the owed portion, and a second click includes the remaining advance amount. Over-balance rows now default their visible flag to General, while the flag controls the owed portion and any excess is always Advance. Added a live breakdown showing the resulting records.
- Removed the unnecessary adjustment breakdown text and disabled one-cent number-input spinner arrows throughout the preview.
- Removed 21 low-value browser smoke assertions for deleted controls, exact copy, icon classes, pixel-level sizing, and other cosmetic implementation details. The smoke suite now protects user-visible behavior without requiring a particular visual implementation.

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
- Historical direct employee-pay entries may still lack a stored payment event; the compatibility ledger continues reconstructing those until they are audited and reconciled.

### Next planned work

- Audit and reconcile historical direct employee-pay entries that lack a stored payment event, then design persistent activity history around the unified payment-event path. This remains intentionally ahead of Square integration because it can be improved and tested using the current manual-payment model.

## Changelog maintenance rules

- Add a concise entry here for every meaningful Tracker 2.0 behavior, data-model, safety, migration, or testing change.
- Keep unfinished ideas in `TRACKER-2-TODO.md` or `TRACKER-2-FEATURE-REVIEW.md`; move them here only when implemented and verified.
- Before release, split the Unreleased section into a dated 2.0 release entry and record the final cutover date, migration result, test result, and known limitations.
- Do not describe a change as production-ready until Tracker 1.0 rollback, historical data validation, and the cutover checklist have passed.
