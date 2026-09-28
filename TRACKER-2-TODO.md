# Tracker 2.0 TODO

This is the working plan for the Tracker 2.0 rebuild and cutover. Tracker 1.0 remains available until the cutover is deliberately completed.

The running implementation history is maintained in `TRACKER-2-CHANGELOG.md`; feature decisions are maintained in `TRACKER-2-FEATURE-REVIEW.md`.

## Recommended execution order

This is the canonical order for the remaining Tracker 2.0 work. The category sections below remain the detailed checklist; this section prevents priorities from being reshuffled casually.

### 1. Finish the no-Square core workflow

1. **[Done] Unify employee payments** — replaced the separate Pay Out and Split Pay presentation with one workflow that supports one or many jobs, advances, adjustments, and split allocations. Job and recurring-service buttons remain prefilled entry points into the same workflow.
2. **[Done] Establish the historical boundary** — legacy Tracker 1.0 records are viewable but read-only in the local preview; new edits and payments use explicit Tracker 2.0 records, while client history continues to combine both eras.
3. **[Done] Add persistent activity history** — meaningful saved changes now create an admin-visible audit event with the actor, time, affected record, and changed fields. The local preview keeps those events in-session because its Firestore writes remain blocked; the production path persists them. Session undo/redo preserves the activity trail instead of erasing it.
4. **[Done] Maintain high-value browser regression coverage** for the main job, client, payment, employee-pay, historical-client, activity-history, and preview-safety workflows. Add targeted cases only when a risky change exposes a real gap.
5. **[Done] Improve save reliability with a lightweight queue** — rapid edits now coalesce into a follow-up save instead of being silently dropped. Record-level writes and conflict detection remain future work if the team grows.

### 2. Stabilize the code boundaries

6. **[Done] Remove the legacy editor from the Tracker 2.0 preview** — historical records stay viewable and blocked by the centralized boundary; Tracker 1.0 on `main` remains available until cutover.
7. **[In progress] Separate read models, calculations, persistence, and rendering** — the pure job-billing summary/entry calculations are now isolated; continue extracting focused boundaries without changing behavior.
8. **[Done] Re-test backup import, realtime snapshots, undo/redo, historical client views, and the no-write preview after the structural split.**

### 3. Complete the product and UI review

9. **[Deferred/maintenance]** Revisit employee visibility for clients, schedules, and shared notes only if the team grows or a real need appears.
10. **[Deferred/maintenance]** Review remaining settings, filters, notes, HomeWatch/Recurring Services, exports, reports, labels, responsive layout, and accessibility as concrete issues or needs arise rather than through a broad redesign pass.
11. **[Deferred/maintenance]** Re-check the feature inventory and changelog when a feature/UI review is triggered so obsolete behavior is not reintroduced during cleanup.

### 4. Prepare and implement Square integration

12. Establish minimum server-enforced security and confirm the deployment/configuration boundary.
13. Decide the Square scope, then implement and validate customer sync, invoices, payments, reconciliation, webhooks, audit logs, and true per-transaction fees in sandbox.
14. Revisit client fields, recurring billing, reports, and invoice snapshots in the context of the real Square workflow.

### 5. Perform the production cutover

15. Choose a cutover date and create/verify the rollback archive.
16. Migrate or expose historical data through the unified read model and validate representative client histories and financial totals.
17. Make Tracker 1.0 a read-only historical viewer, retire migration compatibility when its exit conditions pass, and document the final 2.0 release in the changelog.

## Cutover and historical data

- [ ] Choose a cutover date, preferably when there are no pending jobs or unsettled work.
- [ ] Export and freeze an exact Tracker 1.0 archive snapshot before the first Tracker 2.0 write.
- [ ] Keep Tracker 1.0 available as a read-only historical viewer.
- [ ] Copy clients, jobs, notes, payments, milestones, employee-pay history, and relationships into the Tracker 2.0 read model using stable existing IDs.
- [x] In the local Tracker 2.0 preview, treat pre-cutover/unknown-origin jobs as legacy/read-only rather than rewriting their history; unknown origins fail closed for safety.
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
- [x] Keep historical jobs viewable without opening the old editor or exposing Tracker 2.0 edit controls.
- [x] Confirm that the historical boundary blocks edits, payments, billing changes, hours, notes, and partial collections while preserving read-only viewing and client history.
- [ ] Test quoted, itemized, hourly, material, credit, milestone, notes, and employee-pay cases before removing the old modal.
- [x] Retire the legacy add/edit code from the Tracker 2.0 preview; keep Tracker 1.0 itself available on `main` until cutover validation passes.

## Feature and UI review

- [x] Inventory current features and classify each as keep, optimize, shelve, or remove before deeper Tracker 2.0 restructuring; record the direction in `TRACKER-2-FEATURE-REVIEW.md`.
- [x] Make Overview the default landing area with summary cards, needs-attention items, and workspace notes.
- [x] Refine Overview into attention boxes and sticky-note cards; keep existing tabs as the only navigation and remove redundant quick links.
- [x] Reorder the Settings pane around appearance, client display, job defaults, team, financial rules, integrations, data, and temporary tools.
- [x] Keep the current small-team employee visibility behavior for now; revisit clients, schedules, and shared notes only when a concrete need or team expansion justifies it.
- [ ] When the team expands, replace the current global employee billing-summary visibility with per-user billing visibility if needed.
- [x] Make the shared Outstanding/Pending Invoices summary visible to all employees for the current small-team setup.
- [x] Align the employee Recent Pay timeframe control with the admin Overview card header.
- [x] Replace the separate Pay Out and Split Pay presentation with one underlying employee-payment workflow; keep job and recurring-service buttons as prefilled entry points into that same flow.
- [x] Decide not to migrate or reconcile historical direct employee-pay entries; keep them viewable through the legacy ledger/history path and do not rewrite old financial data.
- [x] Design persistent activity history as a separate layer from session undo/redo; keep the initial audit view admin-only and focused on meaningful saved changes.
- [ ] Add the minimum server-enforced security needed before Square use: Firestore rules, protected functions, and admin authorization.
- [x] Replace save-drop-on-busy behavior with a lightweight coalescing save queue; defer record-level writes and conflict detection until they are actually needed.
- [x] Review the Settings baseline: keep admin backup/restore, make client display choices user-scoped with hidden defaults, keep debt isolated as a removable one-off, and clearly disable Square actions in the local preview.
- [ ] Revisit the client field list after the Square integration review to confirm every field is still populated and useful.
- [x] Lock job fees and HomeWatch payment fees per record, backfill existing records from the unchanged current rate, and limit future fee-setting changes to new records.
- [x] Verify all three user themes apply consistently and add browser smoke coverage for their state/class changes.
- [x] Add code-level admin guards for global settings and employee/debt administration actions.
- [x] Audit current manual payment and partial-payment behavior; prevent duplicate history entries, orphaned generated notes, and split-payout ledger drift without changing Square behavior.
- [ ] Review Square, exports/imports, history, payments, employee pay, Homewatch, notes, filters, undo/redo, and settings for duplicated or obsolete behavior when a concrete need appears.
- [ ] Review the UI for unnecessary controls, duplicated flows, confusing labels, stale terminology, layout cleanup, and responsive/accessibility issues when a concrete need appears.
- [ ] Prioritize feature and UI changes by user value and risk when a review is triggered, keeping financial and historical behavior covered by tests before implementation.
- [ ] Re-check the feature inventory after the review so removed or deferred behavior does not get reintroduced during the `app.js` split.

The detailed keep/fix/defer/remove decisions are maintained in `TRACKER-2-FEATURE-REVIEW.md`.

## Square integration

- [x] Decide to defer full Square integration behind a later milestone; Tracker 2.0 will continue using the existing manual Square workflow.
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
- [x] Remove low-value cosmetic browser assertions so the smoke suite protects behavior instead of deleted controls, exact copy, icon classes, or pixel-level styling.
- [ ] Split the large frontend into behavior-focused modules after the data model stabilizes.
- [x] Extract pure job billing summaries and billing-entry calculations into `v2/billing-domain.js` with direct domain tests.
- [x] Extract Overview billing totals, employee-pay summaries, recent-pay calculations, and workspace-note ordering into `v2/overview-domain.js` with direct domain tests.
- [x] Extract employee-payment row building, payout-plan totals, and owed/advance allocation splitting into `v2/employee-payment-domain.js` with direct domain tests.
- [x] Extract stored and legacy employee-payment ledger reconstruction into `v2/employee-ledger-domain.js` with direct domain tests.
- [x] Isolate the coalescing save queue from the application UI so rapid edits continue saving the newest state without mixing queue mechanics into rendering code.
- [x] Move undo/redo stack management and action descriptions into `v2/undo-redo-domain.js`, keeping UI updates, activity history, and persistence decisions in `app.js`.
- [x] Move preview dirty-state, latest-server-snapshot, realtime-update, and discard coordination into `v2/preview-session-domain.js`.
- [ ] Continue separating read models, calculations, persistence, and rendering so Tracker 2.0 changes do not require editing one monolithic file.
- [ ] Review the full-state Firestore write model for conflict and accidental-overwrite risks.
- [ ] Split `migrateState()` into a small current-state normalizer and a separate historical compatibility layer.
- [x] Remove zero-count legacy conversions after confirming no live records use them (`historicalAdj`, string client notes, `hourly2`, old job notes, old collected flags, and legacy employee-share seeding).
- [ ] Reassess current-shape defaulting for missing payment metadata separately; it remains protective for incomplete incoming or restored data.
- [ ] Review whether the legacy name-matching fallback is still needed for imported or restored states; all current live jobs now have stable `clientId` links.
- [x] Isolate legacy partial-payment compatibility behind a small historical-boundary module and preserve the 2 affected jobs and their 12 legacy items as read-only exceptions.
- [x] Add a centralized historical-boundary module that fails closed for unknown job origins and blocks Tracker 2.0 mutations on legacy records.
- [x] Correct the migration audit so blank as well as missing `splitEventId` values are reported accurately; these historical rows are intentionally retained, not rewritten.
- [ ] Re-test backup import, realtime snapshots, undo/redo, and historical client views after separating migration compatibility.
- [x] Cover backup serialization and malformed-file rejection with automated tests; add admin-only import/export guards and an automatic pre-import backup.
- [ ] Remove migration-only compatibility code once the archive/cutover boundary is established.
- [ ] Keep the local no-write preview build as a rollback and validation tool until Tracker 2.0 is proven.
