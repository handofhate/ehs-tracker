(function attachTracker2UndoRedo(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tracker2UndoRedo = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUndoRedoDomain() {
  'use strict';

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function describeAction(prev, curr) {
    const previousJobs = prev.jobs || [], currentJobs = curr.jobs || [];
    if (currentJobs.length > previousJobs.length) {
      const added = currentJobs.find(job => !previousJobs.find(item => item.id === job.id));
      return `Added job "${added?.name || ''}"`;
    }
    if (currentJobs.length < previousJobs.length) {
      const removed = previousJobs.find(job => !currentJobs.find(item => item.id === job.id));
      return `Deleted job "${removed?.name || ''}"`;
    }
    for (const current of currentJobs) {
      const previous = previousJobs.find(job => job.id === current.id);
      if (previous && JSON.stringify(current) !== JSON.stringify(previous)) {
        if (current.name !== previous.name) return `Renamed job to "${current.name}"`;
        if (JSON.stringify(current.milestones) !== JSON.stringify(previous.milestones)) return `Updated milestones on "${current.name}"`;
        if (JSON.stringify(current.advances) !== JSON.stringify(previous.advances)) return `Updated advance on "${current.name}"`;
        if (current.status !== previous.status) return `Marked "${current.name}" ${current.status}`;
        return `Updated job "${current.name}"`;
      }
    }
    const previousHomewatch = prev.homewatch || [], currentHomewatch = curr.homewatch || [];
    if (currentHomewatch.length > previousHomewatch.length) {
      const added = currentHomewatch.find(item => !previousHomewatch.find(previous => previous.id === item.id));
      return `Added HW client "${added?.name || ''}"`;
    }
    if (currentHomewatch.length < previousHomewatch.length) {
      const removed = previousHomewatch.find(item => !currentHomewatch.find(current => current.id === item.id));
      return `Deleted HW client "${removed?.name || ''}"`;
    }
    for (const current of currentHomewatch) {
      const previous = previousHomewatch.find(item => item.id === current.id);
      if (previous && JSON.stringify(current) !== JSON.stringify(previous)) {
        if (JSON.stringify(current.payments) !== JSON.stringify(previous.payments)) return `Updated payment on "${current.name}"`;
        if (current.status !== previous.status) return `${current.status === 'paused' ? 'Paused' : 'Resumed'} HW "${current.name}"`;
        return `Updated HW client "${current.name}"`;
      }
    }
    const previousClients = prev.clients || [], currentClients = curr.clients || [];
    if (currentClients.length > previousClients.length) {
      const added = currentClients.find(client => !previousClients.find(item => item.id === client.id));
      const name = [added?.firstName, added?.surname].filter(Boolean).join(' ') || added?.company || '';
      return `Added client "${name}"`;
    }
    if (currentClients.length < previousClients.length) {
      const removed = previousClients.find(client => !currentClients.find(item => item.id === client.id));
      const name = [removed?.firstName, removed?.surname].filter(Boolean).join(' ') || removed?.company || '';
      return `Deleted client "${name}"`;
    }
    for (const current of currentClients) {
      const previous = previousClients.find(client => client.id === current.id);
      if (previous && JSON.stringify(current) !== JSON.stringify(previous)) {
        const name = [current.firstName, current.surname].filter(Boolean).join(' ') || current.company || '';
        if (JSON.stringify(current.clientNotes) !== JSON.stringify(previous.clientNotes)) return `Updated notes for "${name}"`;
        return `Updated client "${name}"`;
      }
    }
    const previousAppointments = prev.appointments || [], currentAppointments = curr.appointments || [];
    if (currentAppointments.length > previousAppointments.length) return 'Added appointment';
    if (currentAppointments.length < previousAppointments.length) {
      const removed = previousAppointments.find(item => !currentAppointments.find(current => current.id === item.id));
      return `Deleted appointment${removed?.clientName ? ` for "${removed.clientName}"` : ''}`;
    }
    for (const current of currentAppointments) {
      const previous = previousAppointments.find(item => item.id === current.id);
      if (previous && JSON.stringify(current) !== JSON.stringify(previous)) return `Updated appointment${current.clientName ? ` for "${current.clientName}"` : ''}`;
    }
    const previousDebt = prev.debtPayments || [], currentDebt = curr.debtPayments || [];
    if (currentDebt.length > previousDebt.length) return 'Logged debt payment';
    if (currentDebt.length < previousDebt.length) return 'Deleted debt payment';
    if (JSON.stringify(previousDebt) !== JSON.stringify(currentDebt)) return 'Updated debt payment';
    const previousUsers = prev.users || [], currentUsers = curr.users || [];
    if (currentUsers.length > previousUsers.length) return 'Added user';
    if (currentUsers.length < previousUsers.length) return 'Removed user';
    for (const current of currentUsers) {
      const previous = previousUsers.find(user => user.id === current.id);
      if (previous && JSON.stringify(current) !== JSON.stringify(previous)) return `Updated user "${current.name}"`;
    }
    if (JSON.stringify(prev.settings) !== JSON.stringify(curr.settings)) return 'Updated settings';
    return 'Last action';
  }

  function createHistory({ max = 50 } = {}) {
    const undoStack = [];
    const redoStack = [];

    return Object.freeze({
      clear() {
        undoStack.length = 0;
        redoStack.length = 0;
      },
      counts() {
        return { undo: undoStack.length, redo: redoStack.length };
      },
      recordSavedState(snapshot) {
        if (snapshot === null || snapshot === undefined) return;
        undoStack.push(clone(snapshot));
        if (undoStack.length > max) undoStack.shift();
        redoStack.length = 0;
      },
      undo(current) {
        if (!undoStack.length) return null;
        const previous = undoStack.pop();
        redoStack.push(clone(current));
        return { restored: clone(previous), previous, description: describeAction(previous, current) };
      },
      redo(current) {
        if (!redoStack.length) return null;
        const next = redoStack.pop();
        undoStack.push(clone(current));
        return { restored: clone(next), next, description: describeAction(current, next) };
      },
      rollbackUndo(previous) {
        undoStack.push(clone(previous));
        redoStack.pop();
      },
      rollbackRedo(next) {
        redoStack.push(clone(next));
        undoStack.pop();
      }
    });
  }

  return Object.freeze({ createHistory, describeAction });
});
