# Tracker 2.0 local preview

This branch is a local-only preview of Tracker 2.0. It reads the live Firestore state so the jobs and other tracker data stay current, but edits are kept in browser memory only.

## Start it

From PowerShell in this folder, run:

```powershell
.\run-tracker2-preview.ps1
```

The script opens `http://127.0.0.1:8080/index.html` in the browser. A local web server is used because Firebase authentication and Firestore are not reliable from a `file://` URL.

## Safety behavior

- Firestore reads and the real-time listener remain enabled.
- Tracker edits appear in the interface during the session.
- Firestore writes, undo/redo writes, and Square API actions are blocked.
- Reloading or closing the preview discards temporary tracker edits.
- The preview uses a separate browser-storage prefix for UI preferences and login state.
- The production build remains on the `main` branch.

The preview is still connected to the live database for reading, so it must be treated as a sensitive local tool. Do not use payment or other external-action workflows from it; those controls are intentionally blocked.
