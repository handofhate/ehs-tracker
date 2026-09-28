# Tracker 2.0 feature direction

This is the current feature direction for the live Tracker 2.0 build and its safe local preview companion. The previous Tracker 1.0 build is preserved by the `tracker-1.0-final` rollback tag.

The remaining work follows the canonical sequence in `TRACKER-2-TODO.md`: concrete maintenance, code-boundary cleanup, and optional future Square readiness/integration. Employee-payment unification, the historical read-only boundary, production rollout, and the initial persistent activity-history layer are complete.

The current UI and feature set is accepted as a useful working baseline. Broad visibility, feature, and UI audits are maintenance work now and should be triggered by a concrete issue, workflow need, or team expansion rather than by redesign for its own sake.

## Agreed product direction

- The normal creation entry point is one button: `New Job`.
- `New Job` opens the unified job workflow. The old editor remains in the codebase only as a temporary removal target; historical records are view-only in both builds.
- The default landing area is `Overview`, not the active-job list.
- Overview is intended to be a useful work starting point, not an extra dashboard screen. It combines summary information and items needing attention with workspace notes. Existing tabs remain the navigation; redundant quick links are intentionally omitted.
- Overview attention boxes now focus on active jobs, recurring services, outstanding invoice count/value, employee pay, and recent pay. Admin recent pay includes an employee selector; employees retain their own recent-pay view and can see the shared outstanding/pending invoice summary for now.
- The shared outstanding/pending invoice summary is intentionally visible to all employees while the team is small. It uses the same business-wide active-job totals as the admin card; per-user visibility is deferred until there is a real need for it.
- Employee Recent Pay uses the same upper-right header control placement as the admin card.
- Workspace notes begin as a lightweight shared/admin note board. A full chat or messaging system is deliberately deferred.
- Workspace notes are displayed as truncated sticky-note cards. They can be opened in a full note view, marked done, edited by their author or an admin, and deleted by their author or an admin.
- Employee payment entry points now use one underlying workflow that supports one or many jobs, recurring services, advances, adjustments, and split allocations. Job and recurring-service buttons remain useful shortcuts that open the same workflow with the source preselected.
- Current billing meanings remain unchanged for now: pending means not invoiced or paid, invoiced means sent but unpaid, and paid means collected.
- Historical Tracker 1.0 jobs remain visible in Tracker 2.0 client/job history but are read-only. Only jobs explicitly created through the Tracker 2.0 unified workflow are editable; unknown origins fail closed as historical.

## Settings direction

Admin settings are ordered by normal use and risk:

1. Appearance
2. Client display
3. Job defaults
4. Team and permissions
5. Financial rules
6. Square integration
7. Data and backup
8. Temporary tools

The temporary area contains the one-time debt feature and future migration/recovery controls. Employee settings remain limited to their own profile, appearance, and client display preferences.

## Keep and protect

- Quick/unified job workflow
- Historical client and job history
- Manual payment and partial-payment tracking
- Employee pay and payout ledger
- Backups and import recovery
- Per-record fee snapshots
- Client CSV import/export
- Session undo/redo
- Themes and user-scoped display preferences

## Fix or expand before broad cutover

- Establish minimum production security for Square: server-side secrets, Firestore rules, and server-enforced admin authorization. This does not require enterprise-grade permissions or a large role system.
- Keep invoice-summary visibility global for employees while the team is small; add per-user visibility only if a future multi-employee setup needs it.
- Keep the lightweight coalescing save queue. Consider record-level writes and conflict detection only if simultaneous multi-user editing becomes a real need.
- Keep historical direct employee-pay entries as read-only legacy history instead of rewriting them into the new payment-event model. The compatibility ledger remains a viewing path until the eventual archive/cutover decision.
- Expand activity history only when needed: filtering, richer financial detail, and durable undo/redo can build on the initial admin-only audit layer without changing the normal workflow.
- Keep the current small-team employee visibility behavior. Revisit clients, schedules, and shared notes only if a concrete need or team expansion appears.

## Defer until Square work

- Client duplicate detection, merging, and deeper CRM fields
- Recurring billing expansion beyond the current HomeWatch implementation
- Major HomeWatch redesign; consider a generic Recurring Services model later
- Billing-status automation and Square reconciliation
- Reports that combine manual and Square payment data
- Attachments and document storage
- Client/invoice snapshot duplication of features Square already provides

## Shelve or remove when exit conditions are met

- Old new-job entry point and legacy editor: removed from the Tracker 2.0 build. Historical records remain viewable/read-only, while the `tracker-1.0-final` tag preserves the rollback build.
- One-time debt: remove after the balance is settled and the final historical audit is recorded.
- Legacy partial-payment compatibility: remove after the two historical exception jobs are safely archived and the cutover boundary is established.
- Migration cleanup tools: keep the completed audit record, but keep the one-time tools outside the active app and test path.
- Square UI/backend paths: do not delete until the final Square integration decision and sandbox validation are complete.
- Schedule: keep until actual day-to-day use is confirmed; do not remove based only on code inventory.

## Future Overview candidates

The Overview page can grow in this order:

1. Current summary cards and actionable attention items
2. Workspace notes and simple open/done state
3. Saved filters as quick links or configurable widgets
4. Payment, employee-pay, and work queues
5. Reports or exports based on questions the business actually needs answered

Avoid building a second communication app or duplicating Square's tools unless the tracker provides a clearer operational answer.
