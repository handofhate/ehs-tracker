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

## Unified job workflow

- [ ] Make Quick Job the only new-job entry point.
- [ ] Keep the old job editor temporarily available only for legacy records that have not yet been made read-only.
- [ ] Confirm that legacy jobs can be opened safely in the unified read/edit model, or explicitly make them view-only.
- [ ] Test quoted, itemized, hourly, material, credit, milestone, notes, and employee-pay cases before removing the old modal.
- [ ] Retire the legacy add/edit code after the cutover validation passes.

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
- [ ] Remove migration-only compatibility code once the archive/cutover boundary is established.
- [ ] Keep the local no-write preview build as a rollback and validation tool until Tracker 2.0 is proven.
