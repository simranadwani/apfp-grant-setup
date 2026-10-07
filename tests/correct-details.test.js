'use strict';
// Correct Workspace Details also corrects Organisation Type (saved to the Technical Registry, echoed on the row).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

function setup(row) {
  const p = loadProject(), calls = { tech: [], intake: [], grant: [] };
  p.override('rowObject_', () => row);
  p.override('grantById_', () => ({ rowNumber: 5, record: { 'Financial Year': '2026-27', 'Grant Start Date': d(2026, 5, 1), 'Grant End Date': d(2027, 3, 31) } }));
  p.override('techByRequest_', () => ({ record: { 'Grant ID': 'G1', 'Workspace Status': 'Workspace Created', 'Financial Year': '2026-27',
    'Grant Start Date': d(2026, 5, 1), 'Grant End Date': d(2027, 3, 31) } }));
  p.override('correctedWorkspaceWorkbookTargets_', () => []);
  p.override('setByHeaders_', (...a) => { calls.grant.push(a); });
  p.override('saveTech_', (id, patch) => { calls.tech.push(patch); return { record: {} }; });
  p.override('updateGrantTitleReferences_', () => {});
  p.override('ensureOrganisationMaturityRowsForGrant_', () => {});
  p.override('setIntake_', (r, patch) => { calls.intake.push(patch); });
  p.override('now_', () => 'NOW');
  p.ctx.SpreadsheetApp = { flush() {} };
  return { p, calls };
}
const d = (y, m, day) => new Date(y, m - 1, day);
const base = { 'Grant Start Date': d(2026, 5, 1), 'Grant End Date': d(2027, 3, 31), 'Grant ID': 'G1', 'Request ID': 'R1', 'Grant Title': 'T', 'Amount Approved': 100, 'Thematic Area': 'A',
  'Thematic Sub-area': 'B', 'Proximity to Children / Beneficiary': 'C', 'Organisation Type': 'Returning Organisation' };

test('Organisation Type correction is saved to the Technical Registry and echoed on the row', () => {
  const { p, calls } = setup(Object.assign({}, base));
  p.get('correctWorkspaceDetailsForRow_')(7);
  assert.equal(calls.tech[0]['Organisation Type'], 'Returning Organisation');
  assert.equal(calls.intake[0]['Organisation Type'], 'Returning Organisation');
});

test('an invalid Organisation Type is rejected before anything is written', () => {
  const { p, calls } = setup(Object.assign({}, base, { 'Organisation Type': 'Other' }));
  assert.throws(() => p.get('correctWorkspaceDetailsForRow_')(7), /Organisation Type must be/);
  assert.equal(calls.tech.length, 0);
  assert.equal(calls.grant.length, 0);
});

test('unchanged dates write no date fields', () => {
  const { p, calls } = setup(Object.assign({}, base));
  p.get('correctWorkspaceDetailsForRow_')(7);
  assert.equal('Grant Start Date' in calls.grant[0][3], false);
  assert.equal('Grant Start Date' in calls.tech[0], false);
});

test('changed dates update both registries and the row, and recalculate the start quarter', () => {
  const { p, calls } = setup(Object.assign({}, base, { 'Grant Start Date': d(2026, 8, 15), 'Grant End Date': d(2027, 2, 28) }));
  p.get('correctWorkspaceDetailsForRow_')(7);
  assert.equal(calls.grant[0][3]['Grant Start Date'].getTime(), d(2026, 8, 15).getTime());
  assert.equal(calls.grant[0][3]['Grant Start Quarter'], 'Q2 (Jul-Sep)');
  assert.equal(calls.tech[0]['Grant End Date'].getTime(), d(2027, 2, 28).getTime());
  assert.equal(calls.tech[0]['Grant Start Quarter'], 'Q2 (Jul-Sep)');
  assert.equal(calls.intake[0]['Grant Start Date'].getTime(), d(2026, 8, 15).getTime());
});

test('a start date in another financial year is rejected before anything is written', () => {
  const { p, calls } = setup(Object.assign({}, base, { 'Grant Start Date': d(2027, 4, 2), 'Grant End Date': d(2027, 12, 31) }));
  assert.throws(() => p.get('correctWorkspaceDetailsForRow_')(7), /must stay inside financial year 2026-27/);
  assert.equal(calls.tech.length + calls.grant.length, 0);
});

test('an end date before the start date, or a missing date, is rejected', () => {
  let r = setup(Object.assign({}, base, { 'Grant End Date': d(2026, 4, 30) }));
  assert.throws(() => r.p.get('correctWorkspaceDetailsForRow_')(7), /cannot be before/);
  r = setup(Object.assign({}, base, { 'Grant Start Date': '' }));
  assert.throws(() => r.p.get('correctWorkspaceDetailsForRow_')(7), /Grant Start Date is required/);
});

function guardRun(headerEdited) {
  const p = loadProject(), restored = [];
  const headers = ['Financial Year', 'Grant Start Date', 'Grant End Date', 'Organisation Name', 'Grant Type', 'Primary Contact Email'];
  const map = {}; headers.forEach((h, i) => { map[h.toLowerCase()] = i; });
  const col = headers.indexOf(headerEdited) + 1;
  p.ctx.SpreadsheetApp = { getActive: () => ({ toast() {} }) };
  p.override('ss_', () => ({ toast() {} }));
  p.override('headerMap_', () => map);
  p.override('completedWorkspaceIntakeContext_', () => ({ tech: { record: { 'Financial Year': '2026-27', 'Organisation Name': 'Org' } }, grant: { record: {} } }));
  p.override('setByHeaders_', (sheet, hr, row, patch) => restored.push(patch));
  const range = { getRow: () => 5, getLastRow: () => 5, getColumn: () => col, getLastColumn: () => col, getSheet: () => ({}) };
  p.get('guardCompletedIntakeIdentityEdit_')({ range });
  return restored;
}
test('editing a grant date on a completed row is no longer reverted, but the organisation name still is', () => {
  assert.equal(guardRun('Grant Start Date').length, 0);
  assert.equal(guardRun('Grant End Date').length, 0);
  const restored = guardRun('Organisation Name');
  assert.equal(restored.length, 1);
  assert.equal(restored[0]['Organisation Name'], 'Org');
  assert.equal('Grant Start Date' in restored[0], false);
});

function withTargets(targets, row) {
  const r = setup(row || Object.assign({}, base));
  r.p.override('correctedWorkspaceWorkbookTargets_', () => targets);
  return r;
}
const target = (label, current, onSet) => ({ label, range: { getDisplayValue: () => current, setValue: v => onSet(v) } });

test('a correction that leaves the title unchanged writes nothing into the grantee workbooks', () => {
  const written = [];
  const { p } = withTargets([target('Setup workbook', 'T', v => written.push(v)), target('Outcome workbook', 'T', v => written.push(v))]);
  const result = p.get('correctWorkspaceDetailsForRow_')(7);
  assert.deepEqual(written, []);
  assert.equal(result.warning, '');
});

test('a changed title is written to both workbooks, last', () => {
  const written = [];
  const { p } = withTargets([target('Setup workbook', 'Old', v => written.push(['S', v])), target('Outcome workbook', 'Old', v => written.push(['O', v]))],
    Object.assign({}, base, { 'Grant Title': 'New' }));
  p.get('correctWorkspaceDetailsForRow_')(7);
  assert.deepEqual(written, [['S', 'New'], ['O', 'New']]);
});

test('a protected workbook cell becomes a warning and the registries and row stay corrected', () => {
  const { p, calls } = withTargets([target('Setup workbook', 'Old', () => { throw new Error('You are trying to edit a protected cell or object.'); })],
    Object.assign({}, base, { 'Grant Title': 'New', 'Grant End Date': d(2027, 2, 28) }));
  const result = p.get('correctWorkspaceDetailsForRow_')(7);
  assert.match(result.warning, /Grant Title in the Setup workbook could not be updated because the cell is protected/);
  assert.equal(calls.tech[0]['Grant End Date'].getTime(), d(2027, 2, 28).getTime());
  assert.equal(calls.intake.length, 1);
});
