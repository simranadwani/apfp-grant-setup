'use strict';
// The optional script-controlled columns "Push Status" and "Document Sync Status" let push and sync skip finished
// rows (and not even open the grantee workbook). These tests also prove the actions still work WITHOUT the columns.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, FakeSheet, FakeSpreadsheet } = require('./harness');

const RECEIPT = 'https://drive.google.com/file/d/RECEIPT_FILE_ID_1234567890/view';
const LETTER = 'https://drive.google.com/file/d/LETTER_FILE_ID_1234567890/view';
const PUSH = 'Push Status', SYNC = 'Document Sync Status';
const HEADERS = ['Grant ID', 'Disbursement ID', 'Disbursement Date', 'Disbursed Amount',
  'Upload Folder', 'Donation Receipt Link', 'Donation Letter Link'];

function central(project, rows, extra) {
  const headers = Array.from(project.get('APFP').DISBURSEMENT_HEADERS).concat(extra || []);
  const data = rows.map(o => headers.map(h => (o[h] != null ? o[h] : '')));
  return new FakeSheet('6. Committed & Spent Tracker', [[], headers, ...data], { maxRows: 400 });
}
function grantee(rows) {
  const grid = [[], [], [], HEADERS.slice()];
  for (let i = 0; i < 100; i++) grid.push(HEADERS.map(h => (h === 'Upload Folder' ? 'Upload Folder' : '')));
  (rows || []).forEach((values, i) => Object.keys(values).forEach(h => { grid[4 + i][HEADERS.indexOf(h)] = values[h]; }));
  return new FakeSheet('Disbursement Documents', grid, { maxRows: 104 });
}
// One grantee workbook per grant; counts how often each is opened.
function wire(project, centralSheet, workbooks) {
  const opened = [];
  project.override('disbursementSheet_', () => centralSheet);
  project.override('disbursementWorkbookForGrant_', grantId => {
    opened.push(grantId);
    const sheet = workbooks[grantId];
    if (sheet instanceof Error) throw sheet;
    return sheet ? new FakeSpreadsheet([sheet]) : null;
  });
  return opened;
}
const col = (sheet, header) => sheet.grid[1].indexOf(header);
const cellAt = (sheet, rowNumber, header) => sheet.cell(rowNumber, col(sheet, header) + 1);
const disbursed = (p, grant, id, amount, extra) => Object.assign({
  'Disbursement ID': id, 'Grant ID': grant, 'Status': 'Disbursed',
  'Actual Date': p.date(2026, 5, 1), 'Actual Amount': amount }, extra || {});

test('push marks rows Pushed, sets Document Sync to Awaiting documents, and a second run opens nothing', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'G1', 'DISB-2627-0001', 500000)], [PUSH, SYNC]);
  const opened = wire(p, c, { G1: grantee() });
  const first = p.get('pushDisbursements_')();
  assert.equal(first.changedRows, 1);
  assert.equal(cellAt(c, 3, PUSH), 'Pushed');
  assert.equal(cellAt(c, 3, SYNC), 'Awaiting documents');
  assert.deepEqual(opened, ['G1']);
  const second = p.get('pushDisbursements_')();
  assert.equal(second.changedRows, 0);
  assert.deepEqual(opened, ['G1'], 'the grantee workbook must not be opened again');
});

test('only grants with pending rows are opened when new orgs are added', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'G1', 'DISB-2627-0001', 500000)], [PUSH, SYNC]);
  const opened = wire(p, c, { G1: grantee(), G2: grantee() });
  p.get('pushDisbursements_')();
  c.grid.push(headersRow(c, disbursed(p, 'G2', 'DISB-2627-0002', 250000)));
  opened.length = 0;
  p.get('pushDisbursements_')();
  assert.deepEqual(opened, ['G2']);
  assert.equal(cellAt(c, 4, PUSH), 'Pushed');
});
function headersRow(sheet, obj) { return sheet.grid[1].map(h => (obj[h] != null ? obj[h] : '')); }

test('a failing grant is reported on its own rows and does not stop the others', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'BAD', 'DISB-2627-0001', 1), disbursed(p, 'G2', 'DISB-2627-0002', 2)], [PUSH, SYNC]);
  wire(p, c, { BAD: new Error('Disbursement Documents for Grant ID BAD is missing the column "Grant ID".'), G2: grantee() });
  const result = p.get('pushDisbursements_')();
  assert.equal(result.failures.length, 1);
  assert.match(cellAt(c, 3, PUSH), /^Failed: .*missing the column/);
  assert.equal(cellAt(c, 4, PUSH), 'Pushed');
  assert.throws(() => { wire(p, central(p, [disbursed(p, 'BAD', 'D1', 1)], [PUSH]), { BAD: new Error('boom') }); p.get('syncDisbursementsToGranteeWorkbooks_')(); }, /1 grant\(s\) had a problem: BAD — boom/);
});

test('a run pauses cleanly at the time guard and continues next time', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'G1', 'D1', 1), disbursed(p, 'G2', 'D2', 2)], [PUSH, SYNC]);
  wire(p, c, { G1: grantee(), G2: grantee() });
  p.override('overRuntimeGuard_', () => true);
  const first = p.get('pushDisbursements_')();
  assert.equal(first.stoppedEarly, true);
  assert.equal(cellAt(c, 3, PUSH), 'Pushed');
  assert.equal(cellAt(c, 4, PUSH), '');
  p.override('overRuntimeGuard_', () => false);
  assert.equal(p.get('pushDisbursements_')().stoppedEarly, false);
  assert.equal(cellAt(c, 4, PUSH), 'Pushed');
});

test('Discretionary grants (no workbook) are marked Not applicable and never re-checked', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'DISC', 'D1', 1)], [PUSH, SYNC]);
  const opened = wire(p, c, { DISC: null });
  p.override('disbursementIsCentralOnly_', () => true);
  p.get('pushDisbursements_')();
  assert.equal(cellAt(c, 3, PUSH), 'Not applicable');
  assert.equal(cellAt(c, 3, SYNC), 'Not applicable');
  opened.length = 0;
  p.get('pushDisbursements_')();
  assert.deepEqual(opened, []);
});

test('sync waits for push, then records Partial and Synced, and skips Synced rows', () => {
  const p = loadProject();
  const c = central(p, [{ 'Disbursement ID': 'D1', 'Grant ID': 'G1', [PUSH]: '' }], [PUSH, SYNC]);
  const sheet = grantee([{ 'Grant ID': 'G1', 'Disbursement ID': 'D1', 'Donation Receipt Link': RECEIPT }]);
  const opened = wire(p, c, { G1: sheet });
  p.get('syncDisbursementLinks_')();
  assert.equal(cellAt(c, 3, SYNC), 'Waiting for push');
  assert.deepEqual(opened, []);
  c.grid[2][col(c, PUSH)] = 'Pushed';
  p.get('syncDisbursementLinks_')();
  assert.equal(cellAt(c, 3, SYNC), 'Partial (1 of 2 links)');
  assert.equal(cellAt(c, 3, 'Donation Receipt Link'), RECEIPT);
  sheet.grid[4][HEADERS.indexOf('Donation Letter Link')] = LETTER;
  p.get('syncDisbursementLinks_')();
  assert.equal(cellAt(c, 3, SYNC), 'Synced');
  assert.equal(cellAt(c, 3, 'Donation Letter Link'), LETTER);
  opened.length = 0;
  p.get('syncDisbursementLinks_')();
  assert.deepEqual(opened, [], 'Synced rows are not re-checked');
  p.get('syncDisbursementLinks_')({ full: true });
  assert.deepEqual(opened, ['G1'], 'the full check re-verifies Synced rows');
});

test('a pushed disbursement missing from the grantee workbook is flagged, not hidden', () => {
  const p = loadProject();
  const c = central(p, [{ 'Disbursement ID': 'D1', 'Grant ID': 'G1', [PUSH]: 'Pushed' }], [PUSH, SYNC]);
  wire(p, c, { G1: grantee() });
  p.get('syncDisbursementLinks_')();
  assert.match(cellAt(c, 3, SYNC), /^Failed: disbursement not found/);
});

test('editing a pushed row marks it "Changed – push again"; other columns and unpushed rows are untouched', () => {
  const p = loadProject();
  const c = central(p, [
    { 'Disbursement ID': 'D1', 'Grant ID': 'G1', [PUSH]: 'Pushed' },
    { 'Disbursement ID': 'D2', 'Grant ID': 'G1', [PUSH]: '' }], [PUSH, SYNC]);
  const map = p.get('disbHeaderMap_')(c);
  const rangeOver = (row, lastRow, headers) => {
    const cols = headers.map(h => map[h.toLowerCase()] + 1);
    return { getRow: () => row, getLastRow: () => lastRow, getColumn: () => Math.min(...cols), getLastColumn: () => Math.max(...cols) };
  };
  const mark = p.get('markEditedDisbursementsForRepush_');
  assert.equal(mark(c, map, rangeOver(3, 4, ['Notes'])), 0, 'Notes is not a pushed field');
  assert.equal(mark(c, map, rangeOver(3, 4, ['Actual Amount'])), 1);
  assert.equal(cellAt(c, 3, PUSH), 'Changed – push again');
  assert.equal(cellAt(c, 4, PUSH), '');
});

test('without the status columns push and sync behave as before (all rows checked every time)', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'G1', 'DISB-2627-0001', 500000)]);
  const sheet = grantee([{ 'Grant ID': 'G1', 'Disbursement ID': 'DISB-2627-0001', 'Donation Receipt Link': RECEIPT }]);
  const opened = wire(p, c, { G1: sheet });
  assert.equal(p.get('syncDisbursementsToGranteeWorkbooks_')(), 1, 'first push fills the date and amount');
  assert.equal(p.get('syncDisbursementsToGranteeWorkbooks_')(), 0, 'second push has nothing to change');
  assert.equal(p.get('syncGranteeDisbursementLinksToCentral_')(), 1);
  assert.equal(opened.length, 3, 'every run opens the workbook when there is no status column');
  assert.equal(cellAt(c, 3, 'Donation Receipt Link'), RECEIPT);
});

test('an edit made while a push is running keeps "Changed – push again"', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'G1', 'DISB-2627-0001', 500000)], [PUSH, SYNC]);
  wire(p, c, { G1: grantee() });
  const base = p.get('disbursementWorkbookForGrant_');
  p.override('disbursementWorkbookForGrant_', grantId => {
    const workbook = base(grantId);
    c.grid[2][col(c, PUSH)] = 'Changed – push again'; // the operator edits the row mid-run
    return workbook;
  });
  p.get('pushDisbursements_')();
  assert.equal(cellAt(c, 3, PUSH), 'Changed – push again');
});

test('a disbursed row whose grant has no grantee workbook shows a visible failure', () => {
  const p = loadProject();
  const c = central(p, [disbursed(p, 'G9', 'DISB-2627-0009', 100)], [PUSH, SYNC]);
  wire(p, c, {});
  p.override('disbursementIsCentralOnly_', () => false);
  const result = p.get('pushDisbursements_')();
  assert.equal(result.failures.length, 1);
  assert.match(cellAt(c, 3, PUSH), /^Failed: no grantee Disbursement Documents workbook/);
});
