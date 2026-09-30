'use strict';
// A button click must only process the selected row; other queued rows (earlier failures keep their Action) stay untouched.
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

test('a button click for row 9 does not also run queued row 10', () => {
  const { p, alerts, processed } = setup();
  p.get('processRequestedActions')({ rowNumber: 9 });
  assert.deepEqual(processed, [9]);
  assert.match(alerts[0], /2 other row\(s\) still have a pending Action and were not touched/);
});

test('without a row filter every queued row runs (run-all behaviour is kept)', () => {
  const { p, processed } = setup();
  p.get('processRequestedActions')();
  assert.deepEqual(processed, [9, 10, 12]);
});

test('a trigger-style event object is not mistaken for a row filter', () => {
  const { p, processed } = setup();
  p.get('processRequestedActions')({ authMode: 'FULL' });
  assert.deepEqual(processed, [9, 10, 12]);
});
