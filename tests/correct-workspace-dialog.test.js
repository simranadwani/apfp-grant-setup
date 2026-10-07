'use strict';
// The "Correct Workspace" Action: context for the dialog, owner-only access, per-grant submit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

const d = (y, m, day) => new Date(y, m - 1, day);
const lock = { tryLock: () => true, releaseLock() {} };

function setup(opts) {
  const o = opts || {}, log = { intake: [], applied: [], alerts: [], dialogs: [] };
  const p = loadProject({
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: { getUi: () => ({ alert: m => log.alerts.push(m), showModalDialog: (t, title) => log.dialogs.push(title) }) },
    HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ setWidth() { return this; }, setHeight() { return this; } }) }) }
  });
  const marked = o.marked || [{ rowNumber: 7, object: { 'Request ID': 'R1', 'Grant ID': 'G1', 'Organisation Name': 'Org', 'Financial Year': '2026-27', 'Grant Title': 'Row Title', 'Action': 'Correct Workspace' } }];
  const tech = Object.assign({ 'Grant ID': 'G1', 'Workspace Status': 'Workspace Created', 'Organisation Type': 'New Organisation', 'Financial Year': '2026-27',
    'Grant Start Date': d(2026, 5, 1), 'Grant End Date': d(2027, 3, 31), 'Setup Workbook URL': 'https://docs.google.com/spreadsheets/d/SETUP_WORKBOOK_ID_1234567890/edit' }, o.tech || {});
  const grant = { 'Project Title': 'Registry Title', 'Amount Approved': 1500000, 'Thematic Area': 'Health', 'Thematic Sub-area': 'NA', 'Proximity to Children / Beneficiary': 'NA' };
  p.override('intakeRowsMarked_', () => marked);
  p.override('grantById_', () => ({ rowNumber: 3, record: grant }));
  p.override('techByRequest_', () => ({ record: tech }));
  p.override('actorEmail_', () => o.me === undefined ? 'owner@x.org' : o.me);
  p.override('grantOwnerEmail_', () => { if (o.ownerError) throw new Error('no access'); return o.owner === undefined ? 'owner@x.org' : o.owner; });
  p.override('adminTablesSnapshot_', () => ({ sheets: [{ properties: { title: '1. Workspace Creator' }, tables: [{ columnProperties: [
    { columnName: 'Thematic Area', dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Health' }, { userEnteredValue: 'Education' }] } } },
    { columnName: 'Organisation Type', dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'New Organisation' }, { userEnteredValue: 'Returning Organisation' }] } } }] }] }] }));
  p.override('rowObject_', () => ({ 'Request ID': 'R1', 'Grant ID': 'G1', 'Action': o.action === undefined ? 'Correct Workspace' : o.action }));
  p.override('applyGrantCorrections_', (...a) => { log.applied.push(a); return { applied: ['Amount Approved'], warning: o.warning || '' }; });
  p.override('setIntake_', (r, patch) => log.intake.push(patch));
  p.override('now_', () => 'NOW');
  return { p, log };
}

test('the dialog context lists only marked rows, with current values from the registries and live dropdown options', () => {
  const { p } = setup();
  const ctx = plain(p.get('correctWorkspaceContext_')());
  assert.equal(ctx.grants.length, 1);
  const card = ctx.grants[0];
  assert.equal(card.locked, false);
  assert.equal(card.values.title, 'Registry Title', 'the registry, not the row, is the truth');
  assert.equal(card.values.startDate, '2026-05-01');
  assert.equal(card.values.amount, 1500000);
  assert.deepEqual(ctx.options.thematicArea, ['Health', 'Education']);
  assert.deepEqual(ctx.options.organisationType, ['New Organisation', 'Returning Organisation']);
});

test('a grant owned by someone else is a locked card naming the owner', () => {
  const { p } = setup({ owner: 'other@x.org' });
  const card = plain(p.get('correctWorkspaceContext_')()).grants[0];
  assert.equal(card.locked, true);
  assert.match(card.lockReason, /Only other@x\.org can correct this grant/);
});

test('an unidentifiable account, an unreadable owner or an uncreated workspace are locked with a reason', () => {
  assert.match(plain(setup({ me: '' }).p.get('correctWorkspaceContext_')()).grants[0].lockReason, /could not be identified/);
  assert.match(plain(setup({ ownerError: true }).p.get('correctWorkspaceContext_')()).grants[0].lockReason, /no access/);
  const card = plain(setup({ tech: { 'Workspace Status': 'Needs Attention' } }).p.get('correctWorkspaceContext_')()).grants[0];
  assert.equal(card.locked, true);
  assert.match(card.lockReason, /workspace has not been created/);
});

test('when Drive reports no individual owner (shared drive) the card is not blocked by ownership', () => {
  const card = plain(setup({ owner: '' }).p.get('correctWorkspaceContext_')()).grants[0];
  assert.equal(card.locked, false);
});

test('submit applies ONLY the toggled fields, converts dates, and sets the row Action to Completed', () => {
  const { p, log } = setup();
  const result = plain(p.get('submitCorrectWorkspaceGrant')({ rowNumber: 7, requestId: 'R1', grantId: 'G1', changes: { endDate: '2027-02-28', amount: '2500000' } }));
  const [grantId, requestId, rowNumber, changes] = log.applied[0];
  assert.deepEqual([grantId, requestId, rowNumber], ['G1', 'R1', 7]);
  assert.deepEqual(Object.keys(changes).sort(), ['amount', 'endDate']);
  assert.equal(changes.endDate.getFullYear(), 2027);
  assert.equal(changes.endDate.getMonth(), 1);
  assert.equal(changes.endDate.getDate(), 28);
  assert.equal(log.intake[0]['Action'], 'Completed');
  assert.match(result.message, /Updated: Amount Approved/);
});

test('submit refuses a non-owner on the server even if the dialog was tampered with', () => {
  const { p, log } = setup({ owner: 'other@x.org' });
  assert.throws(() => p.get('submitCorrectWorkspaceGrant')({ rowNumber: 7, requestId: 'R1', grantId: 'G1', changes: { amount: '1' } }), /Only other@x\.org can correct/);
  assert.equal(log.applied.length, 0);
});

test('submit refuses a row that is no longer marked, a changed row, an empty change set or a bad date', () => {
  assert.throws(() => setup({ action: 'Completed' }).p.get('submitCorrectWorkspaceGrant')({ rowNumber: 7, requestId: 'R1', grantId: 'G1', changes: { amount: '1' } }), /no longer marked/);
  assert.throws(() => setup().p.get('submitCorrectWorkspaceGrant')({ rowNumber: 7, requestId: 'OTHER', grantId: 'G1', changes: { amount: '1' } }), /row changed/);
  assert.throws(() => setup().p.get('submitCorrectWorkspaceGrant')({ rowNumber: 7, requestId: 'R1', grantId: 'G1', changes: {} }), /Switch on/);
  assert.throws(() => setup().p.get('submitCorrectWorkspaceGrant')({ rowNumber: 7, requestId: 'R1', grantId: 'G1', changes: { startDate: '31/02/2027' } }), /valid date/);
});

test('a warning from the correction (protected workbook cell) is passed back to the dialog', () => {
  const { p } = setup({ warning: 'The Grant Title in the Setup workbook could not be updated.' });
  const result = plain(p.get('submitCorrectWorkspaceGrant')({ rowNumber: 7, requestId: 'R1', grantId: 'G1', changes: { title: 'X' } }));
  assert.match(result.warning, /Setup workbook could not be updated/);
});

test('the button opens the dialog when rows are marked, and explains itself when none are', () => {
  const marked = setup();
  marked.p.get('uiCorrectWorkspaceDetails')();
  assert.equal(marked.log.dialogs.length, 1);
  const none = setup({ marked: [] });
  none.p.get('uiCorrectWorkspaceDetails')();
  assert.equal(none.log.dialogs.length, 0);
  assert.match(none.log.alerts[0], /Set the Action to "Correct Workspace"/);
});

test('Correct Workspace is a valid Action but is never processed by Create Workspace / Retry', () => {
  const A = plain(loadProject().get('APFP'));
  assert.ok(A.INTAKE.ACTIONS.includes('Correct Workspace'));
  assert.equal(A.INTAKE.PROCESS_ACTIONS.includes('Correct Workspace'), false);
  const action = A.ADMIN_TABLES.find(t => t.SHEET_NAME === '1. Workspace Creator').COLUMNS.find(c => c.NAME === 'Action');
  assert.ok(action.VALUES.includes('Correct Workspace'));
});

test('date helpers round-trip and reject impossible dates', () => {
  const p = loadProject();
  assert.equal(p.get('isoDate_')(d(2026, 8, 5)), '2026-08-05');
  assert.equal(p.get('dateFromIso_')('2026-02-30'), null);
  assert.equal(p.get('dateFromIso_')('nope'), null);
});
