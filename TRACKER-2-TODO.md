# Tracker 2.0 TODO

This is the working plan for the Tracker 2.0 rebuild and cutover. Tracker 1.0 remains available until the cutover is deliberately completed.

The running implementation history is maintained in `TRACKER-2-CHANGELOG.md`; feature decisions are maintained in `TRACKER-2-FEATURE-REVIEW.md`.

## Cutover and historical data

- [ ] Choose a cutover date, preferably when there are no pending jobs or unsettled work.
- [ ] Export and freeze an exact Tracker 1.0 archive snapshot before the first Tracker 2.0 write.
- [ ] Keep Tracker 1.0 available as a read-only historical viewer.
- [ ] Copy clients, jobs, notes, payments, milestones, employee-pay history, and relationships into the Tracker 2.0 read model using stable existing IDs.
- [ ] Mark pre-cutover records as legacy/read-only rather than rewriting their history.
- [ ] Keep client history in one Tracker 2.0 view so a client timeline spans both legacy and new jobs without querying two sources every time.
- [ ] Define how legacy records participate in current totals, employee pay, debt, outstanding balances, and reports.
- [ ] Validate the migration against representative clients and complete job histories.
- [ ] Preserve a recoverable rollback copy and document the cutover point.

## Legacy cleanup and compatibility retirement

- [ ] Create an archive/export and verify that it can be restored before changing any historical records.
- [x] Add a separate read-only dry-run cleanup planner that lists every proposed record change and every ambiguous match.
- [x] Build and run the cleanup apply step as a one-time, guarded tool that is separate from the tracker and requires review of the dry-run first.
- [x] Add an explicit `createdVia: 'legacy'` marker to older jobs without changing their financial history or making them editable as unified jobs.
- [x] Backfill `clientId` using the approved exact and manual matches without changing historical financial data.
- [x] Review the 2 jobs with legacy partial-payment state and preserve them as explicit historical exceptions; block new partial collections on those records.
- [x] Re-run the audit after cleanup and record which legacy checks reached zero, which records were intentionally retained, and the final archive location.
- [ ] Remove the remaining compatibility code only after the post-cleanup audit, client-history review, and rollback verification pass. Old JSON backup import is intentionally out of scope.
- [x] Archive the completed one-time cleanup tools and temporary migration-only tests outside the active application and test suite.

## Unified job workflow

- [x] Make the unified job workflow the only visible new-job entry point, labeled `New Job`.
- [ ] Keep the old job editor temporarily available only for legacy records that have not yet been made read-only.
- [ ] Confirm that legacy jobs can be opened safely in the unified read/edit model, or explicitly make them view-only.
- [ ] Test quoted, itemized, hourly, material, credit, milestone, notes, and employee-pay cases before removing the old modal.
- [ ] Retire the legacy add/edit code after the cutover validation passes.

## Feature and UI review

- [x] Inventory current features and classify each as keep, optimize, shelve, or remove before deeper Tracker 2.0 restructuring; record the direction in `TRACKER-2-FEATURE-REVIEW.md`.
- [x] Make Overview the default landing area with summary cards, needs-attention items, and workspace notes.
- [x] Refine Overview into attention boxes and sticky-note cards; keep existing tabs as the only navigation and remove redundant quick links.
- [x] Reorder the Settings pane around appearance, client display, job defaults, team, financial rules, integrations, data, and temporary tools.
- [ ] Decide whether employees should see all clients, schedules, and shared notes or only assigned records.
- [ ] When the team expands, replace the current global employee billing-summary visibility with per-user billing visibility if needed.
- [x] Make the shared Outstanding/Pending Invoices summary visible to all employees for the current small-team setup.
- [x] Align the employee Recent Pay timeframe control with the admin Overview card header.
- [ ] Replace the separate Pay Out and Split Pay presentation with one underlying employee-payment workflow.
- [ ] Design persistent activity history as a separate layer from session undo/redo.
- [ ] Add the minimum server-enforced security needed before Square use: Firestore rules, protected functions, and admin authorization.
- [ ] Replace save-drop-on-busy behavior with queued saves, then evaluate record-level writes and conflict detection.
- [x] Review the Settings baseline: keep admin backup/restore, make client display choices user-scoped with hidden defaults, keep debt isolated as a removable one-off, and clearly disable Square actions in the local preview.
- [ ] Revisit the client field list after the Square integration review to confirm every field is still populated and useful.
- [x] Lock job fees and HomeWatch payment fees per record, backfill existing records from the unchanged current rate, and limit future fee-setting changes to new records.
- [x] Verify all three user themes apply consistently and add browser smoke coverage for their state/class changes.
- [x] Add code-level admin guards for global settings and employee/debt administration actions.
- [x] Audit current manual payment and partial-payment behavior; prevent duplicate history entries, orphaned generated notes, and split-payout ledger drift without changing Square behavior.
- [ ] Review Square, exports/imports, history, payments, employee pay, Homewatch, notes, filters, undo/redo, and settings for duplicated or obsolete behavior.
- [ ] Review the UI for unnecessary controls, duplicated flows, confusing labels, stale terminology, layout cleanup, and responsive/accessibility issues.
- [ ] Prioritize feature and UI changes by user value and risk, keeping financial and historical behavior covered by tests before implementation.
- [ ] Re-check the feature inventory after the review so removed or deferred behavior does not get reintroduced during the `app.js` split.

The detailed keep/fix/defer/remove decisions are maintained in `TRACKER-2-FEATURE-REVIEW.md`.

## Square integration

- [ ] Decide whether Square remains part of Tracker 2.0 immediately or is temporarily shelved behind a later milestone.
- [ ] Confirm deployed function status, Square credentials, environment, location ID, integration flags, admin authorization, and webhook configuration.
- [ ] Test customer sync, draft invoice creation, sent invoices, partial payments, reconciliation, webhook updates, audit logs, and failure handling in Square sandbox.
- [ ] Validate per-record fee snapshots against Square's actual invoice/payment fees in sandbox before production cutover.
- [ ] Ensure Square invoice/customer IDs and billing states survive the historical migration and unified job model.
- [ ] Keep CSV client import/export available regardless of the API decision.
- [ ] Remove obsolete Square UI/backend paths only after the final integration decision is made.

## Codebase cleanup

- [ ] Add browser-level regression coverage for the main job and client workflows.
- [x] Add browser smoke coverage for Overview cards, employee invoice visibility, Recent Pay controls, workspace notes, themes, and the preview no-write boundary.
- [x] Create and maintain a running Tracker 2.0 changelog alongside the TODO and feature-review documents.
- [x] Add automated browser regression coverage for manual payments, partial payments, generated-note cleanup, payout-ledger updates, and preview no-write behavior.
- [ ] Split the large frontend into behavior-focused modules after the data model stabilizes.
- [ ] Separate read models, calculations, persistence, and rendering so Tracker 2.0 changes do not require editing one monolithic file.
- [ ] Review the full-state Firestore write model for conflict and accidental-overwrite risks.
- [ ] Split `migrateState()` into a small current-state normalizer and a separate historical compatibility layer.
- [x] Remove zero-count legacy conversions after confirming no live records use them (`historicalAdj`, string client notes, `hourly2`, old job notes, old collected flags, and legacy employee-share seeding).
- [ ] Reassess current-shape defaulting for missing payment metadata separately; it remains protective for incomplete incoming or restored data.
- [ ] Review whether the legacy name-matching fallback is still needed for imported or restored states; all current live jobs now have stable `clientId` links.
- [x] Isolate legacy partial-payment compatibility behind a small historical-boundary module and preserve the 2 affected jobs and their 12 legacy items as read-only exceptions.
- [ ] Re-test backup import, realtime snapshots, undo/redo, and historical client views after separating migration compatibility.
- [x] Cover backup serialization and malformed-file rejection with automated tests; add admin-only import/export guards and an automatic pre-import backup.
- [ ] Remove migration-only compatibility code once the archive/cutover boundary is established.
- [ ] Keep the local no-write preview build as a rollback and validation tool until Tracker 2.0 is proven.
