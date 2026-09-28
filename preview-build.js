// The production build defaults to normal Firestore writes in app.js.
// The local launcher opts into preview mode with ?trackerMode=preview so the
// same files can safely serve both builds without a production-only copy.
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('trackerMode') !== 'preview') return;
  window.TRACKER_BUILD = Object.freeze({
    mode: 'local-preview',
    label: 'Tracker 2.0 Local Preview',
    storagePrefix: 'tracker2-preview-'
  });
})();
