'use strict';
// Central trackers and grantee export blocks are read/written by header name: extra or reordered columns need no code change.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain, FakeSheet } = require('./harness');

const project = loadProject();
const A = plain(project.get('APFP'));
const OUT = A.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.OUTCOMES;
const OUT_ROW = A.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.OUTCOMES;
const EXPORT_SECTION = A.PREFLIGHT_SCHEMA.OUTCOME_EXPORT_SECTIONS[0];

function exportBook(headers, rows) {
  const grid = [];
  grid[EXPORT_SECTION.HEADER_ROW - 1] = headers;
  rows.forEach((r, i) => { grid[EXPORT_SECTION.DATA_START_ROW - 1 + i] = r; });
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  const sheet = new FakeSheet(A.OUTCOME_TEMPLATE_SHEETS.TRACKER_EXPORT, grid, { maxRows: EXPORT_SECTION.DATA_START_ROW + EXPORT_SECTION.DATA_ROWS });
  sheet.isSheetHidden = () => true;
  return { getSheetByName: name => (name === sheet.getName() ? sheet : null) };
}
const exportRow = (headers, values) => headers.map(h => (h in values ? values[h] : ''));

function setup(centralHeaders, centralRows, exportHeaders, exportRows) {
  const p = loadProject();
  const central = new FakeSheet(A.SHEETS.OUTCOMES, [['TITLE'], centralHeaders, ...centralRows], { maxRows: 30 });
  central.getSheetId = () => 'central-outcomes';
  central.insertRowsAfter = () => {};
  const book = exportBook(exportHeaders, exportRows);
  p.override('ss_', () => ({ getSheetByName: n => (n === central.getName() ? central : null), getId: () => 'x' }));
  p.override('activeReportingGrants_', () => [{ 'Grant ID': 'G1', 'Grant Type': 'Restricted', 'Financial Year': '2026-27', 'Organisation Name': 'Org', 'Project Title': 'Title' }]);
  p.override('outcomeProgressWorkbookUrlForGrant_', () => 'https://x/d/book/edit');
  p.override('openSpreadsheetCached_', () => book);
  p.override('extendTableToSheetEnd_', () => {});
  return { p, central };
}

test('Outcome refresh: reordered export columns and a new central column are handled; manual columns and unknown columns survive', () => {
  const exportHeaders = ['Extra Export Note', ...A.OUTCOME_EXPORT_HEADERS.slice().reverse()];
  const values = { 'Financial Year': '2026-27', 'Organisation Name': 'Org', 'Grant Title': 'Title', 'Grant ID': 'G1', 'Outcome ID': 'OUT-G1-01',
    'Outcome / Indicator': 'Reach kids', 'End-of-Program Cycle Target': '100', 'Q1 Progress': '40', 'Final Actual': '' };
  // central: a brand-new "Team Comment" column in the middle, and Q1 Status before Q1 Progress
  const centralHeaders = ['Financial Year', 'Organisation Name', 'Team Comment', 'Grant Title', 'Grant ID', 'Outcome ID', 'Outcome / Indicator',
    'End-of-Program Cycle Target', 'Q1 Status', 'Q1 Progress', 'Q1 Evidence Link', 'Q1 Anagha Notes', 'Q2 Progress', 'Q2 Evidence Link', 'Q2 Status', 'Q2 Anagha Notes',
    'Q3 Progress', 'Q3 Evidence Link', 'Q3 Status', 'Q3 Anagha Notes', 'Q4 Progress', 'Q4 Evidence Link', 'Q4 Status', 'Q4 Anagha Notes', 'Final Actual'];
  const existingRow = centralHeaders.map(h => ({ 'Team Comment': 'call them Monday', 'Grant ID': 'G1', 'Outcome ID': 'OUT-G1-01', 'Q1 Status': 'On track', 'Q1 Anagha Notes': 'good' }[h] || ''));
  const { p, central } = setup(centralHeaders, [existingRow], exportHeaders, [exportRow(exportHeaders, values)]);
  assert.equal(p.get('refreshOutcomeProgressTracker_')(), 1);
  const col = h => centralHeaders.indexOf(h) + 1;
  const row = 3;
  assert.equal(central.cell(row, col('Team Comment')), 'call them Monday', 'unknown column untouched');
  assert.equal(central.cell(row, col('Q1 Status')), 'On track', 'manual status kept');
  assert.equal(central.cell(row, col('Q1 Anagha Notes')), 'good');
  assert.equal(central.cell(row, col('Q1 Progress')), '40', 'progress copied from the export by name');
  assert.equal(central.cell(row, col('Outcome / Indicator')), 'Reach kids');
  assert.equal(central.cell(row, col('End-of-Program Cycle Target')), '100');
  assert.equal(central.cell(4, 1), '', 'no duplicate row');
});

test('Outcome refresh: a new outcome is added into a free row with its values in the right columns', () => {
  const exportHeaders = A.OUTCOME_EXPORT_HEADERS.slice();
  const values = { 'Grant ID': 'G1', 'Outcome ID': 'OUT-G1-02', 'Outcome / Indicator': 'New one', 'Q2 Progress': '7' };
  const centralHeaders = ['Grant ID', 'Team Comment', ...OUT.filter(h => h !== 'Grant ID')];
  const { p, central } = setup(centralHeaders, [], exportHeaders, [exportRow(exportHeaders, values)]);
  p.get('refreshOutcomeProgressTracker_')();
  const col = h => centralHeaders.indexOf(h) + 1;
  assert.equal(central.cell(3, col('Grant ID')), 'G1');
  assert.equal(central.cell(3, col('Outcome ID')), 'OUT-G1-02');
  assert.equal(central.cell(3, col('Q2 Progress')), '7');
  assert.equal(central.cell(3, col('Team Comment')), '', 'unknown column stays empty for a new row');
  assert.equal(central.cell(3, col('Financial Year')), '2026-27', 'falls back to the Grant Registry value');
});

test('a missing REQUIRED export header stops the refresh with a message naming it', () => {
  const exportHeaders = A.OUTCOME_EXPORT_HEADERS.filter(h => h !== 'Q3 Progress');
  const { p } = setup(OUT, [], exportHeaders, [exportRow(exportHeaders, { 'Grant ID': 'G1', 'Outcome ID': 'O1', 'Outcome / Indicator': 'x' })]);
  assert.throws(() => p.get('refreshOutcomeProgressTracker_')(), /Tracker Export Outcome Progress is missing the column "Q3 Progress"/);
});

test('upsertTrackerObjects_ names the missing required central column', () => {
  const sheet = new FakeSheet(A.SHEETS.OUTCOMES, [['T'], ['Grant ID']], { maxRows: 10 });
  sheet.getSheetId = () => 's';
  assert.throws(() => project.get('upsertTrackerObjects_')(sheet, OUT_ROW, 'Outcome Progress', [], ['Grant ID'], ['Grant ID', 'Outcome ID']),
    /Outcome Progress is missing the column "Outcome ID"/);
});
