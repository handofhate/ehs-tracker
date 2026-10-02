# Tracker 2.0 changelog

This is the running changelog for the Tracker 2.0 rebuild, local preview, and initial rollout. It summarizes the meaningful product, data, safety, and testing changes compared with Tracker 1.0. The detailed implementation history remains available in Git commits.

Tracker 2.0 is now the live GitHub Pages build. It uses the existing Firestore database and normal save path. The explicit `trackerMode=preview` URL mode remains available for safe no-write testing. Full Square integration is deferred.

## Tracker 2.0 initial rollout — 2026-09-28

### Release notes

- Deployed Tracker 2.0 to the live GitHub Pages site at `https://handofhate.github.io/ehs-tracker/`.
- Verified a fresh production backup before rollout containing 118 jobs, 74 clients, 4 recurring-service records, 2 users, 110 appointments, 43 employee-payment events, and 5 debt-payment records.
- Preserved the previous Tracker 1.0 commit as the `tracker-1.0-final` rollback tag.
- Historical Tracker 1.0 jobs remain visible and read-only in the live Tracker 2.0 build.

## Implementation history through 2026-09-28

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
- Added an admin-only Activity History view from the upper-right Menu. Meaningful saved changes record the actor, time, affected record, action, and changed fields; undo/redo preserves the audit trail.
- Added a lightweight coalescing save queue so rapid edits made during an in-flight save are saved afterward instead of being silently dropped.
- Isolated the coalescing save-queue mechanics in `v2/save-queue.js`, including newest-state coalescing, snapshot cloning, and recovery after a failed save.
- Isolated undo/redo stack management and action descriptions in `v2/undo-redo-domain.js`, while keeping UI updates, activity history, and persistence decisions in `app.js`.
- Isolated preview dirty-state, latest-server-snapshot, realtime-update, and discard coordination in `v2/preview-session-domain.js`, while keeping the user-facing confirmation and rendering in `app.js`.
- Removed the obsolete legacy job editor from the Tracker 2.0 build. Historical records remain viewable and fail closed through the centralized read-only boundary; the previous Tracker 1.0 build is preserved by tag for rollback.
- Extracted pure job billing summaries and billing-entry construction into `v2/billing-domain.js`, leaving UI rendering and mutations in `app.js` while preserving the existing behavior.
- Extracted Overview billing totals, employee-pay summaries, recent-pay calculations, and workspace-note ordering into `v2/overview-domain.js`, leaving rendering and user actions in `app.js` while preserving the existing behavior.
- Extracted employee-payment row building, payout-plan totals, and owed/advance allocation splitting into `v2/employee-payment-domain.js`, leaving the modal and save path in `app.js` while preserving the existing behavior.
- Extracted stored and legacy employee-payment ledger reconstruction into `v2/employee-ledger-domain.js`, leaving ledger rendering and navigation in `app.js` while preserving the existing behavior.
- Added automated domain tests, browser smoke tests, payment regression coverage, preview no-write checks, backup validation, and local Square helper tests.

### Changed

- Made production mode the default build and moved local preview selection behind the explicit `trackerMode=preview` URL flag, so the same checked-in app can be deployed for normal use while retaining a safe no-write preview.
- Accepted the current feature and UI set as the working baseline; broad visibility and cleanup reviews are now deferred maintenance to be triggered by concrete issues, workflow needs, or team expansion.
- Made `New Job` the only visible new-job entry point in the preview; the older editor is now unreachable for historical records and remains only as a temporary removal target.
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
- Cache-busted the preview app entry after the historical-boundary change so already-open browser tabs cannot continue running the previous edit behavior.
- Hardened manual payments and partial collections against duplicate history entries, orphaned generated notes, and payout-ledger drift.
- Clarified employee-pay activity and preserved the distinction between advances, pay, collected billing, and pending billing.
- Protected completed and fee-locked financial records from recalculation when global settings change.
- Preserved historical partial-payment behavior without allowing new records to depend on the old compatibility path.
- Added malformed-backup rejection and full-state backup serialization tests.
- Added a persistent activity-history layer with a bounded 500-event trail, preview-safe temporary behavior, and domain tests for create/update/delete/settings events.
- Added browser-level regression checks for unified jobs, notes, themes, payments, partial collections, fee-rate protection, and preview safety.
- Fixed date-only values and recent-pay windows to use the computer's local calendar date instead of UTC, preventing evening actions and backup filenames from appearing one day ahead.
- Added a dedicated `+ Payment` action to hourly jobs so employee tips and revenue payments are reachable without confusing them with `+ Hours`.
- Added a structural checkpoint to the browser smoke test for backup round-tripping, realtime updates during temporary edits, redo as well as undo, and combined current/historical client history.
- Added a centralized historical-boundary module that fails closed for unknown job origins and keeps legacy Tracker 1.0 jobs viewable but read-only in the Tracker 2.0 preview.
- Corrected the migration audit to report blank as well as missing `splitEventId` values, without changing those historical records.
- Verified the updated preview suite with 86 domain tests, 97 browser smoke assertions, and 5 local Square/backend helper tests.

### Deferred or known limitations

- Square integration is not active yet. Square customer sync, invoicing, reconciliation, webhooks, and true transaction-fee handling remain future work.
- The Overview invoice card currently summarizes job billing; recurring-service billing remains a separate future integration concern.
- Employees currently share the invoice-summary visibility rule. Per-user billing visibility is intentionally deferred.
- Durable undo/redo, record-level conflict handling, and minimum server-enforced production security remain future work. The initial activity-history layer and lightweight save queue are in place; richer filtering/detail can be added later if the audit view grows.
- Client-management expansion, recurring billing beyond the current service model, deeper reports, and attachments are deferred until their surrounding workflows are defined.
- The old editor and remaining migration compatibility code cannot be removed until the historical cutover boundary, archive, and rollback checks are complete.
- Historical direct employee-pay entries may lack a stored payment event; they remain viewable through the legacy ledger/history path and are intentionally not migrated into the Tracker 2.0 event model.

### Next planned work

- Continue release maintenance only: watch real-world use, fix concrete issues, and keep the Square integration deferred until its value clearly outweighs its complexity.

## Changelog maintenance rules

- Add a concise entry here for every meaningful Tracker 2.0 behavior, data-model, safety, migration, or testing change.
- Keep unfinished ideas in `TRACKER-2-TODO.md` or `TRACKER-2-FEATURE-REVIEW.md`; move them here only when implemented and verified.
- Before release, split the Unreleased section into a dated 2.0 release entry and record the final cutover date, migration result, test result, and known limitations.
- Do not describe a change as production-ready until Tracker 1.0 rollback, historical data validation, and the cutover checklist have passed.
