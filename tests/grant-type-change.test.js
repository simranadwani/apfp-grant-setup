'use strict';
// Round W: Grant Type in Correct Workspace Details. Label change inside a kind; archive + rebuild across kinds; never deletes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

const lock = { tryLock: () => true, releaseLock() {} };
const URL_ = id => `https://docs.google.com/spreadsheets/d/${id}/edit`;
const FOLDER = 'https://drive.google.com/drive/folders/ORG_FOLDER_ID_123456789012';

function setup(oldType, opts) {
  const o = opts || {}, calls = [], log = { exceptions: [], grant: [], tech: [], intake: [], archived: [], removed: [], marked: [], pushReset: [], processed: 0 };
  const p = loadProject({ LockService: { getScriptLock: () => lock } });
  const tech = Object.assign({ 'Grant ID': 'G1', 'Request ID': 'R1', 'Organisation ID': 'ORG1', 'Workspace ID': 'W1', 'Workspace Status': 'Workspace Created',
    'Primary Contact Email': 'g@x.org', 'FY Folder URL': 'https://drive.google.com/drive/folders/FY_FOLDER_ID_1234567890123',
    'Organisation Folder URL': FOLDER, 'Setup Workbook URL': URL_('SETUP_ID_1234567890123456'), 'Outcome Progress Workbook URL': URL_('OUTCOME_ID_123456789012345'),
    'Disbursement Workbook URL': URL_('DISB_ID_12345678901234567') }, o.tech || {});
  const grant = { 'Grant Type': oldType };
  p.override('grantById_', () => ({ rowNumber: 4, record: grant }));
  p.override('techByRequest_', () => ({ rowNumber: 9, record: tech }));
  p.override('config_', () => ({}));
  p.override('now_', () => 'NOW');
  p.override('actorEmail_', () => 'owner@x.org');
  p.override('setByHeaders_', (sheet, hr, row, patch) => { calls.push('grant'); log.grant.push(plain(patch)); });
  p.override('saveTech_', (id, patch) => { calls.push('tech'); log.tech.push(plain(patch)); return { record: {} }; });
  p.override('setIntake_', (row, patch) => { calls.push('row'); log.intake.push(plain(patch)); });
  p.override('refreshWorkspaceCreatorRow_', () => { calls.push('refresh'); });
  p.override('archiveWorkbookForTypeChange_', (url, old, t, reader) => { calls.push('archive'); log.archived.push({ url, old, reader }); return { url, name: 'ARCHIVED ' + url }; });
  p.override('intakeRowsWithActions_', () => [{ rowNumber: 7, requestId: 'R1', grantId: 'G1', action: 'Retry Workspace' }]);
  p.override('validateIntakeRequest_', () => ({ ok: o.invalid ? false : true, errors: ['bad'] }));
  p.override('processWorkspaceRequest_', row => { calls.push('build'); log.processed++; if (o.buildThrows) throw new Error('Drive down'); if (o.buildFalse) { row.failureReason = 'Sharing failed'; return false; } return true; });
  p.override('markUnexpectedRowError_', (row, e) => { calls.push('marked'); log.marked.push(e.message); });
  p.override('removeDirectUserPermission_', (id, email) => { log.removed.push([id, email]); return true; });
  p.override('permissionForUser_', () => null);
  p.override('resetDisbursementPushForGrant_', id => { calls.push('pushreset'); log.pushReset.push(id); return 2; });
  p.override('writeException_', e => { calls.push('audit'); log.exceptions.push(plain(e)); });
  return { p, calls, log, change: (newType, options) => p.get('changeGrantType_')('G1', 'R1', 7, newType, options) };
}

test('Restricted <-> Unrestricted only changes the label: no Drive work, no rebuild', () => {
  const s = setup('Restricted');
  const r = s.change('Unrestricted');
  assert.deepEqual(plain(r.applied), ['Grant Type']);
  assert.equal(s.log.grant[0]['Grant Type'], 'Unrestricted');
  assert.equal(s.log.tech[0]['Grant Type'], 'Unrestricted');
  assert.equal(s.log.intake[0]['Grant Type'], 'Unrestricted');
  assert.equal(s.log.archived.length + s.log.processed + s.log.exceptions.length, 0);
});

test('the same type changes nothing; an unknown type is refused', () => {
  const s = setup('Restricted');
  assert.deepEqual(plain(s.change('Restricted').applied), []);
  assert.equal(s.calls.length, 0);
  assert.throws(() => s.change('Odd'), /Grant Type must be/);
});

test('Full -> Transactional archives Setup and Outcome (grantee keeps read access), then builds, resets pushing and audits', () => {
  const s = setup('Restricted');
  s.change('Transactional');
  assert.deepEqual(s.log.archived.map(a => a.url), [URL_('SETUP_ID_1234567890123456'), URL_('OUTCOME_ID_123456789012345')]);
  assert.equal(s.log.archived[0].reader, 'g@x.org');
  assert.deepEqual(s.calls.filter(c => ['archive', 'build', 'pushreset', 'audit'].includes(c)), ['archive', 'archive', 'build', 'pushreset', 'audit']);
  assert.equal(s.log.tech[0]['Setup Review Status'], 'Not Applicable');
  assert.equal(s.log.grant[0]['Master Data Sync Status'], 'Not Applicable');
  assert.equal(s.log.grant[0]['Source Setup Workbook URL'], '');
  assert.equal(s.log.intake[0]['Action'], 'Retry Workspace');
  assert.match(s.log.exceptions[0].message, /Restricted -> Transactional/);
  assert.match(s.log.exceptions[0].message, /ARCHIVED/);
  assert.equal(s.log.exceptions[0].status, 'Resolved');
});

test('Transactional -> Full archives the Disbursement workbook and re-arms review, sharing and the email', () => {
  const s = setup('Transactional');
  s.change('Unrestricted', { notify: true });
  assert.deepEqual(s.log.archived.map(a => a.url), [URL_('DISB_ID_12345678901234567')]);
  const t = s.log.tech[0];
  assert.equal(t['Setup Review Status'], '');
  assert.equal(t['Sharing Status'], 'Pending');
  assert.equal(t['Workspace Notification Status'], '');
  assert.equal(s.log.grant[0]['Master Data Sync Status'], 'Awaiting Review');
  assert.equal(s.log.processed, 1);
  assert.deepEqual(s.log.pushReset, ['G1']);
});

test('notify off marks the notification Skipped for the new workspace', () => {
  const s = setup('Transactional');
  s.change('Restricted', { notify: false });
  assert.equal(s.log.tech[0]['Workspace Notification Status'], 'Skipped');
  assert.equal(s.log.tech[0]['Workspace Notification Recipient'], 'g@x.org');
});

test('Full -> Discretionary archives with no reader, completes the grant, removes the grantee access and keeps pushed disbursements', () => {
  const s = setup('Restricted');
  const r = s.change('Discretionary');
  assert.deepEqual(s.log.archived.map(a => a.reader), ['', '']);
  assert.equal(s.log.grant[0]['Grant Status'], 'Complete');
  assert.equal(s.log.intake[0]['Grant Status'], 'Complete');
  assert.deepEqual(s.log.removed, [['ORG_FOLDER_ID_123456789012', 'g@x.org']]);
  assert.deepEqual(s.log.pushReset, []);
  assert.equal(plain(r.warning), '');
});

test('Discretionary -> Full builds a workspace, makes the grant Active and requires a valid email', () => {
  const s = setup('Discretionary', { tech: { 'Setup Workbook URL': '', 'Outcome Progress Workbook URL': '', 'Disbursement Workbook URL': '', 'Organisation Folder URL': '' } });
  s.change('Restricted');
  assert.equal(s.log.archived.length, 0);
  assert.equal(s.log.grant[0]['Grant Status'], 'Active');
  assert.equal(s.log.tech[0]['Workspace ID'], '');
  assert.equal(s.log.processed, 1);
  assert.deepEqual(s.log.pushReset, ['G1']);
  const noEmail = setup('Discretionary', { tech: { 'Primary Contact Email': '' } });
  assert.throws(() => noEmail.change('Transactional'), /valid Primary Contact Email/);
  assert.equal(noEmail.calls.length, 0, 'nothing is written before the refusal');
});

test('an Approved Setup that is not yet locked and migrated cannot be turned Discretionary', () => {
  const s = setup('Restricted', { tech: { 'Setup Review Status': 'Approved', 'Data Update Status': 'Not Ready' } });
  assert.throws(() => s.change('Discretionary'), /Lock & Migrate/);
  assert.equal(s.calls.length, 0);
  const ok = setup('Restricted', { tech: { 'Setup Review Status': 'Approved', 'Data Update Status': 'Updated' } });
  ok.change('Discretionary');
  assert.equal(ok.log.processed, 1);
});

test('a build that stops leaves the row on Retry Workspace and says how to finish; nothing is deleted', () => {
  const s = setup('Restricted', { buildThrows: true });
  assert.throws(() => s.change('Transactional'), /not finished.*Click Create Workspace to finish/);
  assert.equal(s.log.marked.length, 1);
  assert.equal(s.log.intake[0]['Action'], 'Retry Workspace');
  const f = setup('Restricted', { buildFalse: true });
  assert.throws(() => f.change('Transactional'), /Sharing failed/);
});

test('resetDisbursementPushForGrant_ resets only Disbursed rows of that grant and only unsyncs "Not applicable" rows', () => {
  const p = loadProject();
  const rows = [['G1', 'Disbursed', 'Pushed', 'Synced'], ['G1', 'Disbursed', 'Not applicable', 'Not applicable'], ['G1', 'Committed', 'Pushed', ''], ['G2', 'Disbursed', 'Pushed', 'Synced']];
  const map = { 'grant id': 0, status: 1 }, writes = [];
  p.override('centralDisbursementRows_', () => ({ sheet: {}, map, firstRow: 3, rows, status: { push: 2, sync: 3 } }));
  p.override('writeColumnValues_', (sheet, column, values) => writes.push([column, plain(values)]));
  assert.equal(p.get('resetDisbursementPushForGrant_')('G1'), 2);
  assert.deepEqual(writes[0], [2, { 3: '', 4: '' }]);
  assert.deepEqual(writes[1], [3, { 4: 'Waiting for push' }]);
});

test('applyGrantCorrections_ validates the Grant Type first and runs the type change last, after the other corrections', () => {
  const order = [];
  const p = loadProject();
  p.override('grantById_', () => ({ rowNumber: 5, record: { 'Project Title': 'T', 'Amount Approved': 100, 'Grant Type': 'Restricted', 'Financial Year': '2026-27' } }));
  p.override('techByRequest_', () => ({ record: { 'Grant ID': 'G1', 'Workspace Status': 'Workspace Created', 'Financial Year': '2026-27' } }));
  p.override('setByHeaders_', () => order.push('grant'));
  p.override('saveTech_', () => { order.push('tech'); return { record: {} }; });
  p.override('setIntake_', () => order.push('row'));
  p.override('now_', () => 'NOW');
  p.override('changeGrantType_', (g, r, n, type, options) => { order.push('type:' + type + ':' + (options && options.notify)); return { applied: ['Grant Type'], warning: 'w' }; });
  p.ctx.SpreadsheetApp = { flush() {} };
  const apply = changes => p.get('applyGrantCorrections_')('G1', 'R1', 7, changes, { notify: false });
  assert.throws(() => apply({ grantType: 'Nonsense', amount: 5 }), /Grant Type must be/);
  assert.deepEqual(order, [], 'nothing written before the type is validated');
  const r = apply({ grantType: 'Transactional', amount: 5 });
  assert.deepEqual(plain(r.applied), ['Amount Approved', 'Grant Type']);
  assert.equal(order[order.length - 1], 'type:Transactional:false');
  assert.equal(r.warning, 'w');
  order.length = 0;
  const only = apply({ grantType: 'Unrestricted' });
  assert.deepEqual(plain(only.applied), ['Grant Type']);
  assert.deepEqual(order, ['type:Unrestricted:false'], 'a type-only correction writes nothing else');
  order.length = 0;
  assert.deepEqual(plain(apply({ grantType: 'Restricted' }).applied), [], 'the current type is a no-op');
  assert.deepEqual(order, []);
});

test('workspace kinds', () => {
  const p = loadProject(), kind = p.get('workspaceKindOf_');
  assert.deepEqual(['Restricted', 'Unrestricted', 'Transactional', 'Discretionary'].map(kind), ['full', 'full', 'transactional', 'registry']);
});
