'use strict';
// Every row with a pending Action runs when a workspace button is clicked; the message lists which rows were picked up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

function setup() {
  const alerts = [], processed = [];
  const lock = { tryLock: () => true, releaseLock() {} };
  const p = loadProject({
    SpreadsheetApp: { getUi: () => ({ alert: m => alerts.push(m) }) },
    LockService: { getScriptLock: () => lock }
  });
  const queued = [9, 10, 12].map(n => ({ rowNumber: n, action: 'Create Workspace', requestId: 'REQ' + n, organisationName: 'Org' + n }));
  p.override('runtimeGuard_', () => ({}));
  p.override('intakeRowsWithActions_', () => queued.map(r => Object.assign({}, r)));
  p.override('refreshDuplicateFlagsForRows_', () => {});
  p.override('ensureRequestIdForRow_', row => row.requestId);
  p.override('validateIntakeRequest_', () => ({ ok: true, errors: [] }));
  p.override('processWorkspaceRequest_', row => { processed.push(row.rowNumber); return true; });
  p.override('recordAutomationStatus_', () => {});
  return { p, alerts, processed };
}

test('all rows with a pending Action run, not only the clicked one', () => {
  const { p, processed } = setup();
  p.get('processRequestedActions')();
  assert.deepEqual(processed, [9, 10, 12]);
});

test('the end-of-run message lists the rows that were picked up', () => {
  const { p, alerts } = setup();
  p.get('processRequestedActions')();
  assert.match(alerts[0], /Rows picked up: 9, 10, 12\./);
});
