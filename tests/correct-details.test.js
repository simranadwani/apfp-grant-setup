'use strict';
// applyGrantCorrections_: only the fields in `changes` are applied; unchanged values write nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

const d = (y, m, day) => new Date(y, m - 1, day);

function setup(options) {
  const opts = options || {}, calls = { tech: [], intake: [], grant: [], titleRefs: 0, maturity: 0 };
  const p = loadProject();
  const grantRecord = Object.assign({ 'Project Title': 'T', 'Amount Approved': 100, 'Thematic Area': 'A', 'Thematic Sub-area': 'B',
    'Proximity to Children / Beneficiary': 'C', 'Financial Year': '2026-27', 'Grant Start Date': d(2026, 5, 1), 'Grant End Date': d(2027, 3, 31) }, opts.grant || {});
  const techRecord = Object.assign({ 'Grant ID': 'G1', 'Workspace Status': 'Workspace Created', 'Financial Year': '2026-27', 'Organisation Type': 'Returning Organisation',
    'Grant Start Date': d(2026, 5, 1), 'Grant End Date': d(2027, 3, 31) }, opts.tech || {});
  p.override('grantById_', () => ({ rowNumber: 5, record: grantRecord }));
  p.override('techByRequest_', () => ({ record: techRecord }));
  p.override('correctedWorkspaceWorkbookTargets_', () => opts.targets || []);
  p.override('setByHeaders_', (...a) => { calls.grant.push(a[3]); });
  p.override('saveTech_', (id, patch) => { calls.tech.push(patch); return { record: {} }; });
  p.override('updateGrantTitleReferences_', () => { calls.titleRefs++; });
  p.override('ensureOrganisationMaturityRowsForGrant_', () => { calls.maturity++; });
  p.override('setIntake_', (r, patch) => { calls.intake.push(patch); });
  p.override('now_', () => 'NOW');
  p.ctx.SpreadsheetApp = { flush() {} };
  return { p, calls, apply: changes => p.get('applyGrantCorrections_')('G1', 'R1', 7, changes) };
}
const target = (label, current, onSet) => ({ label, range: { getDisplayValue: () => current, setValue: v => onSet(v) } });

test('only the fields in the change set are applied; nothing else is written', () => {
  const { apply, calls } = setup();
  const r = apply({ amount: 500 });
  assert.deepEqual(plain(r.applied), ['Amount Approved']);
  assert.equal(calls.grant[0]['Amount Approved'], 500);
  assert.equal('Project Title' in calls.grant[0], false);
  assert.equal(calls.titleRefs, 0);
  assert.equal(calls.maturity, 0);
});

test('values equal to the stored ones write nothing at all', () => {
  const { apply, calls } = setup();
  const r = apply({ title: 'T', amount: 100, thematicArea: 'A', organisationType: 'Returning Organisation', startDate: d(2026, 5, 1), endDate: d(2027, 3, 31) });
  assert.deepEqual(plain(r.applied), []);
  assert.equal(calls.grant.length + calls.tech.length + calls.intake.length, 0);
});

test('Organisation Type goes to the Technical Registry and the row, and invalid values are rejected', () => {
  const { apply, calls } = setup();
  apply({ organisationType: 'New Organisation' });
  assert.equal(calls.tech[0]['Organisation Type'], 'New Organisation');
  assert.equal(calls.intake[0]['Organisation Type'], 'New Organisation');
  assert.throws(() => setup().apply({ organisationType: 'Other' }), /Organisation Type must be/);
});

test('classification changes go to the Grant Registry and the row', () => {
  const { apply, calls } = setup();
  const r = apply({ thematicArea: 'Health', subArea: 'NA', proximity: 'NA' });
  assert.deepEqual(plain(r.applied), ['Thematic Area', 'Thematic Sub-area', 'Proximity']);
  assert.equal(calls.grant[0]['Thematic Area'], 'Health');
  assert.equal(calls.intake[0]['Proximity to Children / Beneficiary'], 'NA');
});

test('changed dates update both registries and the row, and recalculate the start quarter', () => {
  const { apply, calls } = setup();
  apply({ startDate: d(2026, 8, 15), endDate: d(2027, 2, 28) });
  assert.equal(calls.grant[0]['Grant Start Quarter'], 'Q2 (Jul-Sep)');
  assert.equal(calls.tech[0]['Grant End Date'].getTime(), d(2027, 2, 28).getTime());
  assert.equal(calls.intake[0]['Grant Start Date'].getTime(), d(2026, 8, 15).getTime());
});

test('changing only the end date keeps the stored start date', () => {
  const { apply, calls } = setup();
  const r = apply({ endDate: d(2027, 1, 31) });
  assert.deepEqual(plain(r.applied), ['Grant End Date']);
  assert.equal(calls.tech[0]['Grant Start Date'].getTime(), d(2026, 5, 1).getTime());
});

test('a start date in another financial year, an end before the start, or a missing date is rejected before anything is written', () => {
  let r = setup();
  assert.throws(() => r.apply({ startDate: d(2027, 4, 2), endDate: d(2027, 12, 31) }), /must stay inside financial year 2026-27/);
  assert.equal(r.calls.tech.length + r.calls.grant.length, 0);
  r = setup();
  assert.throws(() => r.apply({ endDate: d(2026, 4, 30) }), /cannot be before/);
  r = setup();
  assert.throws(() => r.apply({ startDate: null }), /Grant Start Date is required/);
});

test('amount and title are validated', () => {
  assert.throws(() => setup().apply({ amount: -5 }), /non-negative/);
  assert.throws(() => setup().apply({ amount: 'abc' }), /non-negative/);
  assert.throws(() => setup().apply({ title: '   ' }), /cannot be blank/);
});

test('a changed title is written to both workbooks, last, and updates the references', () => {
  const written = [];
  const { apply, calls } = setup({ targets: [target('Setup workbook', 'T', v => written.push(['S', v])), target('Outcome workbook', 'T', v => written.push(['O', v]))] });
  apply({ title: 'New' });
  assert.deepEqual(written, [['S', 'New'], ['O', 'New']]);
  assert.equal(calls.titleRefs, 1);
  assert.equal(calls.maturity, 1);
});

test('a correction that does not change the title never touches the grantee workbooks', () => {
  const written = [];
  const { apply } = setup({ targets: [target('Setup workbook', 'T', v => written.push(v))] });
  apply({ amount: 7 });
  assert.deepEqual(written, []);
});

test('a protected workbook cell becomes a warning and the registries and row stay corrected', () => {
  const { apply, calls } = setup({ targets: [target('Setup workbook', 'T', () => { throw new Error('You are trying to edit a protected cell or object.'); })] });
  const r = apply({ title: 'New', endDate: d(2027, 2, 28) });
  assert.match(r.warning, /Grant Title in the Setup workbook could not be updated because the cell is protected/);
  assert.equal(calls.tech[0]['Grant End Date'].getTime(), d(2027, 2, 28).getTime());
  assert.equal(calls.intake.length, 1);
});

test('a grant whose workspace was not created cannot be corrected', () => {
  assert.throws(() => setup({ tech: { 'Workspace Status': 'Needs Attention' } }).apply({ amount: 1 }), /only after its workspace/);
});

function guardRun(headerEdited) {
  const p = loadProject(), restored = [];
  const headers = ['Financial Year', 'Grant Start Date', 'Grant End Date', 'Organisation Name', 'Grant Type', 'Primary Contact Email', 'Grant Title', 'Amount Approved',
    'Thematic Area', 'Thematic Sub-area', 'Proximity to Children / Beneficiary', 'Organisation Type'];
  const map = {}; headers.forEach((h, i) => { map[h.toLowerCase()] = i; });
  const col = headers.indexOf(headerEdited) + 1;
  p.override('ss_', () => ({ toast() {} }));
  p.override('headerMap_', () => map);
  p.override('completedWorkspaceIntakeContext_', () => ({
    tech: { record: { 'Financial Year': '2026-27', 'Organisation Name': 'Org', 'Organisation Type': 'New Organisation', 'Grant Start Date': d(2026, 5, 1), 'Grant End Date': d(2027, 3, 31) } },
    grant: { record: { 'Project Title': 'Registry Title', 'Amount Approved': 0, 'Thematic Area': 'Health' } } }));
  p.override('setByHeaders_', (sheet, hr, row, patch) => restored.push(patch));
  const range = { getRow: () => 5, getLastRow: () => 5, getColumn: () => col, getLastColumn: () => col, getSheet: () => ({}) };
  p.get('guardCompletedIntakeIdentityEdit_')({ range });
  return restored;
}
test('typing in a correctable cell on a completed row is put back from the registries (the dialog is the only way)', () => {
  ['Grant Title', 'Grant Start Date', 'Grant End Date', 'Amount Approved', 'Thematic Area', 'Organisation Type', 'Organisation Name'].forEach(header => {
    const restored = guardRun(header);
    assert.equal(restored.length, 1, header);
    assert.equal(restored[0]['Grant Title'], 'Registry Title');
    assert.equal(restored[0]['Amount Approved'], 0, 'a zero amount is restored as 0, not blank');
    assert.equal(restored[0]['Organisation Type'], 'New Organisation');
  });
});
