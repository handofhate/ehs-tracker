# Tracker 2.0 local preview

This branch is a local-only preview of Tracker 2.0. It reads the live Firestore state so the jobs and other tracker data stay current, but edits are kept in browser memory only.

## Start the local preview

From PowerShell in this folder, run:

```powershell
.\run-tracker2-preview.ps1
```

The script opens `http://127.0.0.1:8765/index.html?trackerMode=preview` in the browser. A local web server is used because Firebase authentication and Firestore are not reliable from a `file://` URL.

The normal `index.html` URL is now the write-enabled Tracker 2.0 build. The preview uses the explicit `trackerMode=preview` query parameter so the same checked-in files can support both the safe local preview and the production deployment without accidentally shipping the no-write mode.

## Safety behavior

- Firestore reads and the real-time listener remain enabled.
- Tracker edits appear in the interface during the session.
- In preview mode, Firestore writes, undo/redo writes, and Square API actions are blocked.
- Historical Tracker 1.0 jobs remain visible but read-only in the preview. Only jobs explicitly created through the Tracker 2.0 unified workflow can be edited or receive new payments; unknown job origins are treated as historical for safety.
- Reloading or closing the preview discards temporary tracker edits. The stable local payout test fixtures remain available and are merged back into each live snapshot.
- The preview uses a separate browser-storage prefix for UI preferences and login state.
- The preview starts on the Overview workspace, with one visible `New Job` button that opens the unified workflow.
- Employee payments now use one visible `Pay Employee` workflow. Job and recurring-service payment buttons open that same workflow with the source preselected.
- Employee payments start at zero and always list open jobs and active recurring services. Payment intent is inferred from the allocation: positive amounts remain General/partial pay unless they exceed the current balance, zero-balance or over-balance allocations become Advances, and negative allocations become Adjustments. Final Pay remains an explicit per-source choice because paying the current balance does not necessarily mean the job is finished. Each source row's `Max` button uses the remaining amount being paid, including negative adjustments and advances beyond the current balance.
- If one allocation exceeds the current balance, saving it keeps one payment event but records the owed portion and extra advance portion separately. Allocation rows also have an X button to clear their amount.
- Employee-payment sources with positive pay owed appear first. Other eligible open jobs and recurring services are grouped under a collapsed "Other eligible work" section; the old "advance available" label was removed because a zero balance simply means a positive allocation would be treated as an advance.
- The employee-payment modal no longer shows a redundant PAY OWED header. Its top MAX button matches the row MAX controls and the allocation grouping uses one divider.
- The total payment control now has MAX on the left and a clear-X on the right. Individual allocation fields are wider to accommodate larger payments.
- The total-payment clear control uses the same visible X icon as the allocation-row clear controls.
- Allocation-row MAX is two-stage: first click fills the owed portion, second click includes any advance. When a payment exceeds the owed balance, the row flag controls the owed portion (General or Final Pay) and the excess is automatically Advance; the modal shows that breakdown.
- Number fields no longer show browser spinner arrows, and negative adjustments do not display an unnecessary record-breakdown message.
- Rapid edits are coalesced into a follow-up save instead of being discarded when another save is still running. The preview keeps this behavior in memory while continuing to block all Firestore writes.
- Overview workspace notes are temporary in the preview just like other edits; they are not written to Firestore.
- The preview includes three stable fake payout jobs and three stable Overview notes. They are defined in `v2/preview-fixtures.js`, never written to Firestore, and reappear after Refresh Live Data or a browser restart.
- Overview currently combines Active Jobs and Recurring Services, shared Outstanding/Pending Invoices, employee pay, Recent Pay, and workspace notes. Employees see the shared invoice summary for now; per-user visibility can be added later if the team expands.
- The employee Recent Pay timeframe control is positioned in the card header, matching the admin Overview layout.
- Admins can open Activity History from the upper-right Menu. It records meaningful saved changes with the actor, time, affected record, and changed fields. Because the preview never writes to Firestore, these events are temporary in the preview session and disappear when the preview is refreshed; the production persistence path stores them with the tracker state.
- The production build remains on the `main` branch.

The preview is still connected to the live database for reading, so it must be treated as a sensitive local tool. Do not use payment or other external-action workflows from it; those controls are intentionally blocked.

## Automated checks

From PowerShell in this folder, run:

```powershell
.\scripts\test-v2.ps1
```

This runs JavaScript syntax checks, the Tracker 2.0 domain tests, a headless browser smoke test against the local preview, and the local Square helper tests when the ignored `functions/` folder is present. The browser smoke test starts a temporary local server if port 8765 is not already in use.

The browser smoke test currently covers the preview mode and no-write boundary, Overview summaries, shared employee invoice visibility, workspace-note behavior, themes, unified New Job entry, historical read-only behavior and client history, fee-rate protection, employee-payment behavior, partial collections, payout-ledger updates, generated-note cleanup, Activity History with undo/redo, coalescing saves, realtime snapshot handling, backup round-tripping, and the extracted billing, Overview, employee-payment, employee-ledger, save-queue, undo/redo, and preview-session modules. Domain tests also cover the historical boundary, migration-audit reporting, activity-event construction, billing summaries, Overview read models, employee-payment calculations, ledger reconstruction, persistence behavior, backup validation, save-queue recovery, undo/redo stack recovery, and preview-session recovery. The suite intentionally avoids asserting exact cosmetic markup, icon classes, copy, or pixel-level styling. The latest verified run includes 86 Tracker 2.0 domain tests, 97 browser smoke assertions, and 5 local Square/backend helper tests.

See [TRACKER-2-CHANGELOG.md](TRACKER-2-CHANGELOG.md) for the running implementation history and [TRACKER-2-TODO.md](TRACKER-2-TODO.md) for remaining work.
