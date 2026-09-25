(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tracker2Backup = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function serializeState(state) {
    return JSON.stringify(state, null, 2);
  }

  function parseBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('Invalid backup file: it is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid backup file.');
    }
    if (!Array.isArray(parsed.jobs) || !parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
      throw new Error('Invalid backup file.');
    }
    return parsed;
  }

  return Object.freeze({ serializeState, parseBackup });
});
