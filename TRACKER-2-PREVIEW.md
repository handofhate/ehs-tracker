# Tracker 2.0 local preview

This branch is a local-only preview of Tracker 2.0. It reads the live Firestore state so the jobs and other tracker data stay current, but edits are kept in browser memory only.

## Start it

From PowerShell in this folder, run:

```powershell
.\run-tracker2-preview.ps1
```

The script opens `http://127.0.0.1:8765/index.html` in the browser. A local web server is used because Firebase authentication and Firestore are not reliable from a `file://` URL.

## Safety behavior

- Firestore reads and the real-time listener remain enabled.
- Tracker edits appear in the interface during the session.
- Firestore writes, undo/redo writes, and Square API actions are blocked.
- Reloading or closing the preview discards temporary tracker edits.
- The preview uses a separate browser-storage prefix for UI preferences and login state.
- The preview starts on the Overview workspace, with one visible `New Job` button that opens the unified workflow.
- Overview workspace notes are temporary in the preview just like other edits; they are not written to Firestore.
- Overview currently combines Active Jobs and Recurring Services, shared Outstanding/Pending Invoices, employee pay, Recent Pay, and workspace notes. Employees see the shared invoice summary for now; per-user visibility can be added later if the team expands.
- The employee Recent Pay timeframe control is positioned in the card header, matching the admin Overview layout.
- The production build remains on the `main` branch.

The preview is still connected to the live database for reading, so it must be treated as a sensitive local tool. Do not use payment or other external-action workflows from it; those controls are intentionally blocked.

## Automated checks

From PowerShell in this folder, run:

```powershell
.\scripts\test-v2.ps1
```

This runs JavaScript syntax checks, the Tracker 2.0 domain tests, a headless browser smoke test against the local preview, and the local Square helper tests when the ignored `functions/` folder is present. The browser smoke test starts a temporary local server if port 8765 is not already in use.

The browser smoke test currently covers the preview mode and no-write boundary, Overview layout, shared employee invoice visibility, Recent Pay controls, workspace-note behavior, themes, unified New Job entry, fee-rate protection, manual payments, partial collections, and generated-note cleanup.
