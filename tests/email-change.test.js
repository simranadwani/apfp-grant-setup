'use strict';
// Changing the primary contact email from the Retry/Reshare dialog: records, Setup workbook cell, organisation contact,
// old-access clean-up, optional email, audit line, and the dialog opening whenever the row already has a workspace.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

function setup(techRecord, options) {
  const opts = options || {}, log = { tech: [], grant: [], org: [], intake: [], sharing: [], removed: [], audit: [], mail: 0, setup: [], rolledBack: 0 };
  const p = loadProject();
  const record = Object.assign({ 'Grant ID': 'G1', 'Organisation ID': 'O1', 'Workspace ID': 'W1', 'Grant Type': 'Restricted',
    'Primary Contact Email': 'old@x.org', 'Organisation Folder URL': 'https://drive.google.com/drive/folders/FOLDER_ID_123456789012345',
    'Setup Workbook URL': 'https://docs.google.com/spreadsheets/d/SETUP_WORKBOOK_ID_1234567890/edit', 'Workspace Status': 'Workspace Created' }, techRecord || {});
  p.override('techByRequest_', () => ({ record }));
  p.override('saveTech_', (id, patch) => { log.tech.push(patch); return { record }; });
  p.override('grantById_', () => ({ rowNumber: 4, record: { 'Financial Year': opts.grantFy || '2026-27' } }));
  p.override('organisationById_', () => ({ rowNumber: 2, record: {} }));
  p.override('grantRegistryRows_', () => (opts.otherFys || ['2026-27']).map(fy => ({ record: { 'Organisation ID': 'O1', 'Financial Year': fy, 'Record Status': 'Active' } })));
  p.override('setByHeaders_', (sheet, hr, rowNumber, patch) => { (sheet === 'Organisation Registry' || /Organisation/.test(sheet) && !/Grant/.test(sheet) ? log.org : log.grant).push(patch); });
  p.override('setIntake_', (r, patch) => log.intake.push(patch));
  p.override('now_', () => 'NOW');
  p.override('actorEmail_', () => 'operator@goalkeep.net');
  p.override('writeException_', d => log.audit.push(d));
  p.override('refreshWorkspaceCreatorRow_', () => {});
  p.override('setWorkspaceStatusNote_', () => {});
  p.override('repairWorkspaceFilesBeforeRetrySharing_', () => {});
  p.override('ensureUserRole_', (id, email, role) => { if (opts.failNewAccess) throw new Error('boom'); log.sharing.push([id, email, role]); });
  p.override('permissionForUser_', () => ({ id: 'perm' }));
  p.override('restoreUserPermission_', () => { log.rolledBack++; });
  p.override('removeWorkspaceGranteeProtectionAccess_', () => {});
  p.override('assertWorkspaceFilesSafeToShare_', () => true);
  p.override('removeDirectUserPermission_', (id, email) => { if (opts.failOldRemoval) throw new Error('nope'); log.removed.push([id, email]); });
  p.override('sendWorkspaceNotificationOnce_', () => { log.mail++; });
  p.override('updateSetupContactEmail_', (r, e) => { log.setup.push(e); return true; });
  return { p, log, record };
}
const row = { rowNumber: 7, requestId: 'R1', grantId: 'G1' };

test('a full change updates every record, moves access, emails the new address and writes an audit line', () => {
  const { p, log } = setup();
  const r = Object.assign({}, row);
  assert.equal(p.get('transferGrantFyPrimaryEmail_')(r, 'new@x.org', {}), true);
  assert.equal(log.tech[0]['Primary Contact Email'], 'new@x.org');
  assert.equal(log.grant[0]['Primary Contact Email'], 'new@x.org');
  assert.equal(log.intake[0]['Primary Contact Email'], 'new@x.org');
  assert.deepEqual(log.setup, ['new@x.org']);
  assert.equal(log.org[0]['Primary Contact Email'], 'new@x.org', 'latest grant updates the organisation contact');
  assert.deepEqual(log.removed.map(x => x[1]), ['old@x.org']);
  assert.equal(log.mail, 1);
  assert.match(log.audit[0].message, /from old@x.org to new@x.org by operator@goalkeep.net/);
  assert.equal(log.audit[0].status, 'Resolved');
  assert.equal(r.warning, '');
});

test('an older grant does not change the organisation contact', () => {
  const { p, log } = setup({}, { grantFy: '2025-26', otherFys: ['2025-26', '2026-27'] });
  p.get('transferGrantFyPrimaryEmail_')(Object.assign({}, row), 'new@x.org', {});
  assert.equal(log.org.length, 0);
});

test('notify=false skips the workspace email and records that it was skipped', () => {
  const { p, log } = setup();
  p.get('transferGrantFyPrimaryEmail_')(Object.assign({}, row), 'new@x.org', {}, { notify: false });
  assert.equal(log.mail, 0);
  assert.equal(log.tech[0]['Workspace Notification Status'], 'Skipped');
});

test('a Registry Only grant updates records only: no sharing, no email', () => {
  const { p, log } = setup({ 'Workspace Status': 'Registry Only', 'Grant Type': 'Discretionary', 'Organisation Folder URL': '', 'Grant Workspace URL': '', 'Setup Workbook URL': '' });
  assert.equal(p.get('transferGrantFyPrimaryEmail_')(Object.assign({}, row), 'new@x.org', {}), true);
  assert.equal(log.tech[0]['Primary Contact Email'], 'new@x.org');
  assert.equal(log.sharing.length, 0);
  assert.equal(log.mail, 0);
  assert.equal(log.setup.length, 0);
});

test('old access that cannot be removed is reported by name', () => {
  const { p, log } = setup({}, { failOldRemoval: true });
  const r = Object.assign({}, row);
  p.get('transferGrantFyPrimaryEmail_')(r, 'new@x.org', {});
  assert.match(r.warning, /old@x\.org could not be removed from: Grant-FY workspace/);
  assert.equal(log.tech[log.tech.length - 1]['Last Error Code'], 'EMAIL_TRANSFER_CLEANUP_FAILED');
});

test('a failure before the change is committed rolls the new access back and changes no record', () => {
  const { p, log } = setup({}, { failNewAccess: true });
  assert.throws(() => p.get('transferGrantFyPrimaryEmail_')(Object.assign({}, row), 'new@x.org', {}), /boom/);
  assert.equal(log.rolledBack > 0, true);
  assert.equal(log.grant.length, 0);
  assert.equal(log.tech.some(t => t['Primary Contact Email']), false);
});

test('an invalid or unchanged address does nothing harmful', () => {
  const { p, log } = setup();
  assert.throws(() => p.get('transferGrantFyPrimaryEmail_')(Object.assign({}, row), 'not-an-email', {}), /valid new Primary Contact Email/);
  assert.equal(log.tech.length, 0);
});

test('Retry/Reshare opens the dialog for a row with a workspace even when its Action is set', () => {
  const dialogs = [];
  const p = loadProject({
    HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ setWidth() { return this; }, setHeight() { return this; } }) }) },
    SpreadsheetApp: { getUi: () => ({ showModalDialog: (t, title) => dialogs.push(title) }) }
  });
  let ran = 0;
  p.override('selectedDataRow_', () => ({ rowNumber: 9 }));
  p.override('rowObject_', () => ({ 'Request ID': 'R1', 'Grant ID': 'G1', 'Action': 'Retry Sharing', 'Organisation Name': 'Org', 'Financial Year': '2026-27' }));
  p.override('techByRequest_', () => ({ record: { 'Grant ID': 'G1', 'Workspace Status': 'Workspace Created', 'Primary Contact Email': 'old@x.org', 'Grant Type': 'Restricted', 'Organisation Folder URL': 'https://x/y' } }));
  p.override('processRequestedActions', () => { ran++; });
  p.get('uiRetryOrReshareWorkspace')();
  assert.equal(dialogs.length, 1);
  assert.equal(ran, 0);
});

function retryButton(rowFacts, tech, selectionError) {
  const dialogs = [], toasts = [], ran = [];
  const p = loadProject({
    HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ setWidth() { return this; }, setHeight() { return this; } }) }) },
    SpreadsheetApp: { getUi: () => ({ showModalDialog: (t, title) => dialogs.push(title) }) }
  });
  p.override('selectedDataRow_', () => { if (selectionError) throw new Error(selectionError); return { rowNumber: 9 }; });
  p.override('rowObject_', () => rowFacts);
  p.override('techByRequest_', () => tech);
  p.override('showToast_', m => toasts.push(m));
  p.override('processRequestedActions', () => { ran.push(1); });
  p.get('uiRetryOrReshareWorkspace')();
  return { dialogs, toasts, ran };
}
const workspaceTech = status => ({ record: { 'Grant ID': 'G1', 'Workspace Status': status, 'Primary Contact Email': 'a@x.org', 'Grant Type': 'Restricted', 'Organisation Folder URL': 'https://x/y' } });

test('the dialog opens for a row with a workspace whatever its status text says', () => {
  const r = retryButton({ 'Request ID': 'R1', 'Grant ID': 'G1', 'Action': 'Retry Sharing' }, workspaceTech('Needs Attention'));
  assert.equal(r.dialogs.length, 1);
  assert.equal(r.ran.length, 0);
});

test('a blank selected row runs the queue and says why the dialog did not open', () => {
  const r = retryButton({ 'Request ID': '', 'Grant ID': '', 'Action': '' }, null);
  assert.equal(r.ran.length, 1);
  assert.match(r.toasts[0], /no Request ID yet/);
});

test('a row without a workspace folder explains itself', () => {
  const r = retryButton({ 'Request ID': 'R1', 'Grant ID': 'G1' }, { record: { 'Grant ID': 'G1', 'Workspace Status': 'Needs Attention', 'Grant Type': 'Restricted' } });
  assert.equal(r.ran.length, 1);
  assert.match(r.toasts[0], /no workspace folder yet/);
});

test('several selected rows are called out instead of silently running the queue', () => {
  const r = retryButton(null, null, 'Select only one data row.');
  assert.equal(r.ran.length, 1);
  assert.match(r.toasts[0], /More than one row is selected/);
});

test('no selection on the sheet just runs the marked rows without a message', () => {
  const r = retryButton(null, null, 'Select one data row in 1. Workspace Creator, then run the action again.');
  assert.equal(r.ran.length, 1);
  assert.equal(r.toasts.length, 0);
});
