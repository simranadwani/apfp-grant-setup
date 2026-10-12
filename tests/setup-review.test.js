'use strict';
// Version 1.1: Setup Review Status end to end (failed approval, Reopen Setup batch, Reopened - Changes Required).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

const lock = { tryLock: () => true, releaseLock() {} };

test('an incomplete or invalid Setup raises an error that is flagged as "needs changes"', () => {
  const p = loadProject();
  p.override('readTableConfigured_', () => []);
  p.override('readSingleConfigured_', () => '');
  const byCode = { org_name: { 'Required Rule': 'YES', 'Field Shape': 'SCALAR', 'Field Label': 'Name of Organisation' } };
  let caught;
  try { p.get('validateCompletedSetup_')({}, byCode); } catch (e) { caught = e; }
  assert.match(caught.message, /Approved Setup is incomplete/);
  assert.equal(caught.setupNeedsChanges, true);
});

function failureSetup() {
  const p = loadProject(), tech = [], exceptions = [];
  p.override('rowObject_', () => ({ 'Request ID': 'R1', 'Grant ID': 'G1', 'Organisation ID': 'O1', 'Organisation Name': 'Org', 'Setup Workbook URL': 'u', 'Retry Count': 0 }));
  p.override('saveTech_', (id, patch) => { tech.push(plain(patch)); return { record: {} }; });
  p.override('writeException_', e => exceptions.push(plain(e)));
  p.override('refreshWorkspaceCreatorRow_', () => {});
  p.override('now_', () => 'NOW');
  return { p, tech, exceptions };
}

test('an approval that fails because the Setup is incomplete goes back to Changes Required (not Retry Approval, not Needs Attention)', () => {
  const { p, tech, exceptions } = failureSetup();
  const error = new Error('Approved Setup is incomplete. Complete: A, B.'); error.setupNeedsChanges = true;
  const out = plain(p.get('markMasterSyncFailed_')(5, error));
  assert.equal(tech[0]['Setup Review Status'], 'Changes Required');
  assert.equal(tech[0]['Data Update Status'], 'Not Ready');
  assert.equal(tech[0]['Last Error Code'], 'SETUP_INCOMPLETE');
  assert.equal('Workspace Status' in tech[0], false, 'the workspace is not marked Needs Attention');
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].severity, 'Medium');
  assert.equal(exceptions[0].type, 'Setup Needs Changes');
  assert.equal(out.needsChanges, true);
});

test('a technical failure still becomes Retry Approval + Needs Attention + a High exception', () => {
  const { p, tech, exceptions } = failureSetup();
  const out = plain(p.get('markMasterSyncFailed_')(5, new Error('Drive is down')));
  assert.equal(tech[0]['Setup Review Status'], 'Retry Approval');
  assert.equal(tech[0]['Workspace Status'], 'Needs Attention');
  assert.equal(tech[0]['Last Error Code'], 'MASTER_SYNC_FAILED');
  assert.equal(exceptions[0].severity, 'High');
  assert.equal(out.needsChanges, false);
});

test('the Lock & Migrate summary separates "sent back as Changes Required" from technical failures', () => {
  const alerts = [], p = loadProject({ LockService: { getScriptLock: () => lock }, SpreadsheetApp: { getUi: () => ({ alert: m => alerts.push(m) }) } });
  p.override('runtimeGuard_', () => ({}));
  p.override('technicalRegistryRows_', () => [1, 2, 3].map(n => ({ rowNumber: n, record: { 'Record Status': 'Active', 'Grant Type': 'Restricted', 'Setup Review Status': 'Approved', 'Data Update Status': 'Ready', 'Setup Workbook URL': 'u' } })));
  const results = { 1: null, 2: Object.assign(new Error('Approved Setup is incomplete. Complete: A.'), { setupNeedsChanges: true }), 3: new Error('Drive is down') };
  p.override('reconcileSetupReviewRows_', () => []);
  p.override('syncOneMasterDataRow_', n => { if (results[n]) throw results[n]; });
  p.override('markMasterSyncFailed_', (n, e) => ({ organisationName: 'Org' + n, summary: e.message, needsChanges: !!e.setupNeedsChanges }));
  p.get('updateApprovedSetupData')();
  assert.match(alerts[0], /Locked and updated 1 approved Setup\(s\); 1 sent back as Changes Required; 1 need attention\./);
  assert.match(alerts[0], /Org2 \(Changes Required\): Approved Setup is incomplete/);
});

function reopenSetupRun(records, failing) {
  const alerts = [], reopened = [], tech = [];
  const p = loadProject({ LockService: { getScriptLock: () => lock }, SpreadsheetApp: { getUi: () => ({ alert: m => alerts.push(m) }) } });
  p.override('runtimeGuard_', () => ({}));
  p.override('technicalRegistryRows_', () => records.map((record, i) => ({ rowNumber: i + 3, record })));
  p.override('reconcileSetupReviewRows_', () => []);
  p.override('reopenSetup_', id => { if (failing && failing.includes(id)) throw new Error('Drive down'); reopened.push(id); });
  p.override('saveTech_', (id, patch) => { tech.push([id, plain(patch)]); });
  p.override('refreshWorkspaceCreatorRow_', () => {});
  p.get('reopenSelectedSetup')();
  return { alerts, reopened, tech };
}
const rec = (id, review, extra) => Object.assign({ 'Record Status': 'Active', 'Grant Type': 'Restricted', 'Grant ID': id, 'Request ID': 'R' + id, 'Organisation Name': 'Org ' + id, 'Setup Review Status': review }, extra || {});

test('the Reopen button reopens every row marked Reopen Setup and ignores the rest (no row selection needed)', () => {
  const r = reopenSetupRun([rec('G1', 'Reopen Setup'), rec('G2', 'Locked & Migrated'), rec('G3', 'Reopen Setup'), rec('G4', 'Approved'), rec('G5', 'Reopen Setup', { 'Grant Type': 'Transactional' })]);
  assert.deepEqual(r.reopened, ['G1', 'G3']);
  assert.match(r.alerts[0], /Reopened 2 Setup\(s\) for changes; 0 need attention/);
});

test('a row that fails to reopen stays on Reopen Setup with the reason and does not stop the others', () => {
  const r = reopenSetupRun([rec('G1', 'Reopen Setup'), rec('G2', 'Reopen Setup'), rec('G3', 'Reopen Setup')], ['G2']);
  assert.deepEqual(r.reopened, ['G1', 'G3']);
  assert.match(r.alerts[0], /Reopened 2 Setup\(s\) for changes; 1 need attention/);
  assert.match(r.alerts[0], /Org G2: Drive down/);
  assert.equal(r.tech.length, 1);
  assert.equal(r.tech[0][1]['Last Error Code'], 'REOPEN_FAILED');
  assert.equal('Setup Review Status' in r.tech[0][1], false, 'the status is not changed on failure');
});

test('with no row marked the button explains what to do', () => {
  const r = reopenSetupRun([rec('G1', 'Locked & Migrated')]);
  assert.deepEqual(r.reopened, []);
  assert.match(r.alerts[0], /Set Setup Review Status to "Reopen Setup"/);
});

function editSetup(currentTechStatus, typed, opts) {
  const o = opts || {}, cells = {}, grantIds = o.grantIds || { 5: 'G1' };
  const cell = row => cells[row] || (cells[row] = { value: typed, getDisplayValue() { return this.value; }, setValue(v) { this.value = v; }, clearContent() { this.value = ''; } });
  const sheet = { getRange: (row, col) => (col === 1 ? { getDisplayValue: () => grantIds[row] || '' } : cell(row)) };
  const rows = o.rows || [5];
  const range = { getRow: () => rows[0], getLastRow: () => rows[rows.length - 1], getNumRows: () => rows.length, getNumColumns: () => 1, getColumn: () => 7, getLastColumn: () => 7, getSheet: () => sheet };
  const applied = [], toasts = [], refreshed = [], p = loadProject({ LockService: { getScriptLock: () => lock } });
  p.override('intakeColumn_', () => 7);
  p.override('headerMap_', () => ({ 'grant id': 0 }));
  p.override('grantById_', id => ({ record: { 'Grant Type': (o.types || {})[id] || 'Restricted' } }));
  p.override('masterSyncByGrantId_', () => ({ record: { 'Setup Review Status': currentTechStatus } }));
  p.override('applyReviewStatus_', (g, status) => applied.push(g + ':' + status));
  p.override('refreshWorkspaceCreatorRow_', g => refreshed.push(g));
  p.override('showToast_', m => toasts.push(m));
  p.override('actorEmail_', () => 'me@x.org');
  p.get('handleTrackerReviewEdit_')({ range, oldValue: o.oldValue === undefined ? 'Awaiting Review' : o.oldValue });
  return { cells, cell, applied, toasts, refreshed, first: cell(rows[0]) };
}

test('typing Changes Required on a Locked & Migrated Setup turns into Reopen Setup (queued for the button)', () => {
  const r = editSetup('Locked & Migrated', 'Changes Required');
  assert.equal(r.first.value, 'Reopen Setup');
  assert.deepEqual(r.applied, ['G1:Reopen Setup']);
  assert.match(r.toasts[0], /Click Reopen Setup for Changes/);
});

test('Changes Required on a Setup that is not locked is applied as typed', () => {
  const r = editSetup('Approved', 'Changes Required');
  assert.equal(r.first.value, 'Changes Required');
  assert.deepEqual(r.applied, ['G1:Changes Required']);
  assert.equal(r.toasts.length, 0);
});

test('Approved typed on a Setup that is already Locked & Migrated is put back with an explanation', () => {
  const r = editSetup('Locked & Migrated', 'Approved');
  assert.equal(r.first.value, 'Locked & Migrated');
  assert.deepEqual(r.applied, []);
  assert.match(r.toasts[0], /already Locked & Migrated.*Reopen Setup/);
});

test('Approved typed on a Transactional or Discretionary grant is refused with the reason and the cell shows Not Applicable again', () => {
  ['Transactional', 'Discretionary'].forEach(type => {
    const r = editSetup('', 'Approved', { types: { G1: type } });
    assert.equal(r.first.value, '');
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.refreshed, ['G1']);
    assert.match(r.toasts[0], new RegExp(`${type} grants have no Setup to review, so they cannot be set to Approved`));
  });
});

test('a pasted or filled-down block of statuses is applied row by row (it used to be ignored)', () => {
  const r = editSetup('Awaiting Review', 'Approved', { rows: [5, 6, 7], grantIds: { 5: 'G1', 6: 'G2', 7: 'G3' }, oldValue: undefined });
  assert.deepEqual(r.applied, ['G1:Approved', 'G2:Approved', 'G3:Approved']);
});

test('the new statuses exist and are accepted by the dropdown check', () => {
  const p = loadProject(), APFP = p.get('APFP');
  assert.equal(APFP.REVIEW_STATUS.REOPEN, 'Reopen Setup');
  assert.equal(APFP.REVIEW_STATUS.REOPENED, 'Reopened - Changes Required');
  const column = APFP.ADMIN_TABLES.find(t => t.SHEET_NAME === '1. Workspace Creator').COLUMNS.find(c => c.NAME === 'Setup Review Status');
  assert.ok(column.VALUES.includes('Reopen Setup') && column.VALUES.includes('Reopened - Changes Required'));
});

test('a locked Setup counts as an approved, completed source (prior-Setup prefill and the older-year guard)', () => {
  const p = loadProject(), ok = p.get('syncRecordIsApprovedCompleted_');
  const base = { 'Record Status': 'Active', 'Grant Type': 'Restricted', 'Data Update Status': 'Updated', 'Data Sync Status': 'Completed' };
  assert.equal(ok(Object.assign({}, base, { 'Setup Review Status': 'Locked & Migrated' })), true);
  assert.equal(ok(Object.assign({}, base, { 'Setup Review Status': 'Approved' })), true);
  assert.equal(ok(Object.assign({}, base, { 'Setup Review Status': 'Changes Required' })), false);
  assert.equal(ok(Object.assign({}, base, { 'Setup Review Status': 'Reopened - Changes Required' })), false);
});

// ---- reconcile: the buttons read the statuses shown in the sheet ----
function reconcileSetup(rows, tech, types) {
  const applied = [], refreshed = [], p = loadProject();
  p.override('intakeRowsByReviewStatus_', () => rows.map((o, i) => ({ rowNumber: i + 3, object: o })));
  p.override('grantById_', id => ({ record: { 'Grant Type': (types || {})[id] || 'Restricted' } }));
  p.override('masterSyncByGrantId_', id => (tech[id] === null ? null : { record: { 'Setup Review Status': tech[id] || 'Awaiting Review' } }));
  p.override('applyReviewStatus_', (g, status) => applied.push(g + ':' + status));
  p.override('refreshWorkspaceCreatorRow_', g => refreshed.push(g));
  p.override('actorEmail_', () => 'me@x.org');
  return { p, applied, refreshed };
}
const sheetRow = (grantId, org, status, type) => ({ 'Grant ID': grantId, 'Organisation Name': org, 'Setup Review Status': status, 'Grant Type': type || 'Restricted' });

test('rows shown as Approved in the sheet are applied to the Technical Registry even when the edit was missed', () => {
  const r = reconcileSetup([sheetRow('G1', 'MH14', 'Approved'), sheetRow('G2', 'Other', 'Approved')], { G1: 'Awaiting Review', G2: 'Approved' });
  const notes = r.p.get('reconcileSetupReviewRows_')(['Approved', 'Retry Approval'], 'approved');
  assert.deepEqual(r.applied, ['G1:Approved'], 'G2 already Approved in the registry');
  assert.deepEqual(plain(notes), []);
});

test('marked rows that cannot be used come back with a reason', () => {
  const r = reconcileSetup([
    sheetRow('', 'NoWorkspace', 'Approved'), sheetRow('T1', 'TransOrg', 'Approved', 'Transactional'), sheetRow('D1', 'DiscOrg', 'Approved', 'Discretionary'),
    sheetRow('G9', 'LockedOrg', 'Approved'), sheetRow('G8', 'NoSetup', 'Approved')
  ], { G9: 'Locked & Migrated', G8: null }, { T1: 'Transactional', D1: 'Discretionary' });
  const notes = plain(r.p.get('reconcileSetupReviewRows_')(['Approved'], 'approved')).join('\n');
  assert.match(notes, /NoWorkspace: no workspace has been created yet/);
  assert.match(notes, /TransOrg: this is a Transactional grant. It has no Setup, so it cannot be approved/);
  assert.match(notes, /DiscOrg: this is a Discretionary grant/);
  assert.match(notes, /LockedOrg: already Locked & Migrated. To change it, set Reopen Setup/);
  assert.match(notes, /NoSetup: no Setup workbook was found/);
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.refreshed, ['T1', 'D1', 'G9']);
});

test('Lock & Migrate processes EVERY row marked Approved in the sheet, and explains the ones it cannot', () => {
  const alerts = [], processed = [], state = { G1: 'Awaiting Review', G2: 'Awaiting Review' };
  const p = loadProject({ LockService: { getScriptLock: () => lock }, SpreadsheetApp: { getUi: () => ({ alert: m => alerts.push(m) }) } });
  p.override('runtimeGuard_', () => ({}));
  p.override('intakeRowsByReviewStatus_', () => [sheetRow('G1', 'MH14', 'Approved'), sheetRow('G2', 'Good', 'Approved'), sheetRow('T1', 'TransOrg', 'Approved', 'Transactional')].map((o, i) => ({ rowNumber: i + 3, object: o })));
  p.override('grantById_', id => ({ record: { 'Grant Type': id === 'T1' ? 'Transactional' : 'Restricted' } }));
  p.override('masterSyncByGrantId_', id => (state[id] ? { record: { 'Setup Review Status': state[id] } } : null));
  p.override('applyReviewStatus_', (g, status) => { state[g] = status; });
  p.override('refreshWorkspaceCreatorRow_', () => {});
  p.override('actorEmail_', () => 'me@x.org');
  p.override('technicalRegistryRows_', () => Object.keys(state).map((g, i) => ({ rowNumber: i + 3, record: { 'Grant ID': g, 'Record Status': 'Active', 'Grant Type': 'Restricted', 'Setup Review Status': state[g], 'Data Update Status': 'Ready', 'Setup Workbook URL': 'u' } })));
  p.override('syncOneMasterDataRow_', n => { processed.push(n); if (n === 3) throw Object.assign(new Error('Approved Setup is incomplete. Complete: X.'), { setupNeedsChanges: true }); });
  p.override('markMasterSyncFailed_', (n, e) => ({ organisationName: 'MH14', summary: e.message, needsChanges: true }));
  p.get('updateApprovedSetupData')();
  assert.deepEqual(processed, [3, 4], 'both Approved rows run');
  assert.match(alerts[0], /Locked and updated 1 approved Setup\(s\); 1 sent back as Changes Required; 0 need attention\./);
  assert.match(alerts[0], /Not processed:[\s\S]*TransOrg: this is a Transactional grant\. It has no Setup, so it cannot be approved/);
});

test('a Setup left on "Updating" by a run that was cut off is retried, not skipped forever', () => {
  const processed = [], p = loadProject({ LockService: { getScriptLock: () => lock }, SpreadsheetApp: { getUi: () => ({ alert() {} }) } });
  p.override('runtimeGuard_', () => ({}));
  p.override('reconcileSetupReviewRows_', () => []);
  p.override('technicalRegistryRows_', () => [{ rowNumber: 3, record: { 'Record Status': 'Active', 'Grant Type': 'Restricted', 'Setup Review Status': 'Approved', 'Data Update Status': 'Updating', 'Setup Workbook URL': 'u' } },
    { rowNumber: 4, record: { 'Record Status': 'Active', 'Grant Type': 'Restricted', 'Setup Review Status': 'Approved', 'Data Update Status': 'Updated', 'Setup Workbook URL': 'u' } }]);
  p.override('syncOneMasterDataRow_', n => processed.push(n));
  p.get('updateApprovedSetupData')();
  assert.deepEqual(processed, [3]);
});

test('the Reopen button also reads the statuses shown in the sheet and lists rows it cannot reopen', () => {
  const alerts = [], reopened = [];
  const p = loadProject({ LockService: { getScriptLock: () => lock }, SpreadsheetApp: { getUi: () => ({ alert: m => alerts.push(m) }) } });
  p.override('runtimeGuard_', () => ({}));
  const state = { G1: 'Locked & Migrated' };
  p.override('intakeRowsByReviewStatus_', () => [sheetRow('G1', 'Org1', 'Reopen Setup'), sheetRow('T1', 'TransOrg', 'Reopen Setup', 'Transactional')].map((o, i) => ({ rowNumber: i + 3, object: o })));
  p.override('grantById_', id => ({ record: { 'Grant Type': id === 'T1' ? 'Transactional' : 'Restricted' } }));
  p.override('masterSyncByGrantId_', id => (state[id] ? { record: { 'Setup Review Status': state[id] } } : null));
  p.override('applyReviewStatus_', (g, status) => { state[g] = status; });
  p.override('refreshWorkspaceCreatorRow_', () => {});
  p.override('actorEmail_', () => 'me@x.org');
  p.override('technicalRegistryRows_', () => [{ rowNumber: 3, record: { 'Record Status': 'Active', 'Grant Type': 'Restricted', 'Grant ID': 'G1', 'Request ID': 'R1', 'Organisation Name': 'Org1', 'Setup Review Status': state.G1 } }]);
  p.override('reopenSetup_', id => reopened.push(id));
  p.override('saveTech_', () => {});
  p.get('reopenSelectedSetup')();
  assert.deepEqual(reopened, ['G1']);
  assert.match(alerts[0], /Reopened 1 Setup\(s\) for changes/);
  assert.match(alerts[0], /Not reopened:[\s\S]*TransOrg: this is a Transactional grant\. It has no Setup, so it cannot be reopened/);
});
