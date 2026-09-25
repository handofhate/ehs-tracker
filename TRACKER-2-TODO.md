# Tracker 2.0 TODO

This is the working plan for the Tracker 2.0 rebuild and cutover. Tracker 1.0 remains available until the cutover is deliberately completed.

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

- [ ] Make Quick Job the only new-job entry point.
- [ ] Keep the old job editor temporarily available only for legacy records that have not yet been made read-only.
- [ ] Confirm that legacy jobs can be opened safely in the unified read/edit model, or explicitly make them view-only.
- [ ] Test quoted, itemized, hourly, material, credit, milestone, notes, and employee-pay cases before removing the old modal.
- [ ] Retire the legacy add/edit code after the cutover validation passes.

## Feature and UI review

- [ ] Inventory current features and classify each as keep, optimize, shelve, or remove before deeper Tracker 2.0 restructuring.
- [ ] Review Square, exports/imports, history, payments, employee pay, Homewatch, notes, filters, undo/redo, and settings for duplicated or obsolete behavior.
- [ ] Review the UI for unnecessary controls, duplicated flows, confusing labels, stale terminology, layout cleanup, and responsive/accessibility issues.
- [ ] Prioritize feature and UI changes by user value and risk, keeping financial and historical behavior covered by tests before implementation.
- [ ] Re-check the feature inventory after the review so removed or deferred behavior does not get reintroduced during the `app.js` split.

## Square integration

- [ ] Decide whether Square remains part of Tracker 2.0 immediately or is temporarily shelved behind a later milestone.
- [ ] Confirm deployed function status, Square credentials, environment, location ID, integration flags, admin authorization, and webhook configuration.
- [ ] Test customer sync, draft invoice creation, sent invoices, partial payments, reconciliation, webhook updates, audit logs, and failure handling in Square sandbox.
- [ ] Ensure Square invoice/customer IDs and billing states survive the historical migration and unified job model.
- [ ] Keep CSV client import/export available regardless of the API decision.
- [ ] Remove obsolete Square UI/backend paths only after the final integration decision is made.

## Codebase cleanup

- [ ] Add browser-level regression coverage for the main job and client workflows.
- [ ] Split the large frontend into behavior-focused modules after the data model stabilizes.
- [ ] Separate read models, calculations, persistence, and rendering so Tracker 2.0 changes do not require editing one monolithic file.
- [ ] Review the full-state Firestore write model for conflict and accidental-overwrite risks.
- [ ] Split `migrateState()` into a small current-state normalizer and a separate historical compatibility layer.
- [x] Remove zero-count legacy conversions after confirming no live records use them (`historicalAdj`, string client notes, `hourly2`, old job notes, old collected flags, and legacy employee-share seeding).
- [ ] Reassess current-shape defaulting for missing payment metadata separately; it remains protective for incomplete incoming or restored data.
- [ ] Review whether the legacy name-matching fallback is still needed for imported or restored states; all current live jobs now have stable `clientId` links.
- [x] Isolate legacy partial-payment compatibility behind a small historical-boundary module and preserve the 2 affected jobs and their 12 legacy items as read-only exceptions.
- [ ] Re-test backup import, realtime snapshots, undo/redo, and historical client views after separating migration compatibility.
- [ ] Remove migration-only compatibility code once the archive/cutover boundary is established.
- [ ] Keep the local no-write preview build as a rollback and validation tool until Tracker 2.0 is proven.
