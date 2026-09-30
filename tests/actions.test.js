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

test('Create Workspace button never writes an Action into the selected row (only pre-marked rows run)', () => {
  const { p, processed } = setup();
  const writes = [];
  p.override('selectedDataRow_', () => { throw new Error('the button must not depend on the selection'); });
  p.override('sheet_', () => ({ getRange: () => ({ setValue: v => writes.push(v) }) }));
  p.get('uiCreateWorkspace')();
  assert.deepEqual(writes, []);
  assert.deepEqual(processed, [9, 10, 12]);
});

function retrySetup(selectedRow, rowObject, tech) {
  const { p, processed } = setup();
  const stamps = [], dialogs = [];
  p.override('selectedDataRow_', () => selectedRow);
  p.override('rowObject_', () => rowObject);
  p.override('techByRequest_', () => tech);
  p.override('sheet_', () => ({ getRange: () => ({ setValue: v => stamps.push(v) }) }));
  p.ctx.HtmlService = { createTemplateFromFile: () => ({ evaluate: () => ({ setWidth() { return { setHeight() { return {}; } }; } }) }) };
  p.ctx.SpreadsheetApp.getUi = () => ({ alert() {}, showModalDialog: (_o, title) => dialogs.push(title) });
  return { p, processed, stamps, dialogs };
}

test('Retry/Reshare on a blank selected row does not touch it and runs the marked rows', () => {
  const { p, processed, stamps } = retrySetup({ rowNumber: 14, sheet: {} }, { 'Request ID': '', 'Grant ID': '', Action: '' }, null);
  p.get('uiRetryOrReshareWorkspace')();
  assert.deepEqual(stamps, []);
  assert.deepEqual(processed, [9, 10, 12]);
});

test('Retry/Reshare on a row that already has a workspace opens the dialog for that row (no Action written)', () => {
  const tech = { record: { 'Workspace Status': 'Workspace Created', 'Grant ID': 'G1', 'Primary Contact Email': 'a@b.org' } };
  const { p, processed, stamps, dialogs } = retrySetup({ rowNumber: 13, sheet: {} },
    { 'Request ID': 'REQ13', 'Grant ID': 'G1', Action: 'Completed', 'Organisation Name': 'O', 'Financial Year': '2026-27' }, tech);
  p.get('uiRetryOrReshareWorkspace')();
  assert.deepEqual(stamps, []);
  assert.deepEqual(processed, []);
  assert.equal(dialogs.length, 1);
});

test('a Transactional workspace (shown as Disbursement Only) still counts as shareable', () => {
  const tech = { record: { 'Workspace Status': 'Workspace Created', 'Grant ID': 'G1', 'Primary Contact Email': 'a@b.org' } };
  const { p, dialogs } = retrySetup({ rowNumber: 13, sheet: {} },
    { 'Request ID': 'REQ13', 'Grant ID': 'G1', Action: '', 'Workspace Status': 'Disbursement Only' }, tech);
  p.get('uiRetryOrReshareWorkspace')();
  assert.equal(dialogs.length, 1);
});

test('an empty row with an Action is reported and gets no Request ID or registry record', () => {
  const { p, alerts, processed } = setup();
  const created = [];
  p.override('intakeRowsWithActions_', () => [{ rowNumber: 14, action: 'Create Workspace', requestId: '', financialYear: '', grantStartDate: '', grantEndDate: '',
    organisationName: '', projectTitle: '', grantType: '', amountApproved: '', granteeEmail: '' }]);
  p.override('ensureRequestIdForRow_', row => { created.push(row.rowNumber); return 'REQ'; });
  p.get('processRequestedActions')();
  assert.deepEqual(created, [], 'no Request ID written');
  assert.deepEqual(processed, []);
  assert.match(alerts[0], /Row 14: This row is empty/);
});

test('a partly filled row is still validated normally (and still gets a Request ID)', () => {
  const { p } = setup();
  const created = [];
  p.override('intakeRowsWithActions_', () => [{ rowNumber: 14, action: 'Create Workspace', requestId: '', organisationName: 'Org', financialYear: '', projectTitle: '' }]);
  p.override('ensureRequestIdForRow_', row => { created.push(row.rowNumber); return 'REQ'; });
  p.override('validateIntakeRequest_', () => ({ ok: false, errors: ['x'] }));
  p.override('recordValidationFailure_', () => {});
  p.get('processRequestedActions')();
  assert.deepEqual(created, [14]);
});
