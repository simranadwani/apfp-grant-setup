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

test('a missing REQUIRED export header skips that grant with a message naming it (other grants are unaffected)', () => {
  const exportHeaders = A.OUTCOME_EXPORT_HEADERS.filter(h => h !== 'Q3 Progress');
  const { p } = setup(OUT, [], exportHeaders, [exportRow(exportHeaders, { 'Grant ID': 'G1', 'Outcome ID': 'O1', 'Outcome / Indicator': 'x' })]);
  assert.equal(p.get('refreshOutcomeProgressTracker_')(), 0);
  assert.match(p.get('refreshNote_')(), /G1 — Tracker Export Outcome Progress is missing the column "Q3 Progress"/);
});

function refreshWithState(stampOf, store) {
  const exportHeaders = A.OUTCOME_EXPORT_HEADERS.slice();
  const rec = id => exportRow(exportHeaders, { 'Grant ID': id, 'Outcome ID': `OUT-${id}-01`, 'Outcome / Indicator': `ind ${id}`, 'Q1 Progress': '5' });
  const p = loadProject({
    DriveApp: { getFileById: id => ({ getLastUpdated: () => ({ getTime: () => stampOf(id) }) }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => Object.assign({}, store),
      setProperties: values => Object.assign(store, values),
      deleteProperty: key => { delete store[key]; },
      getProperty: key => store[key]
    }) }
  });
  const central = new FakeSheet(A.SHEETS.OUTCOMES, [['TITLE'], OUT], { maxRows: 30 });
  central.getSheetId = () => 'c'; central.insertRowsAfter = () => {};
  const opened = [];
  const books = { 'https://x/d/book1AAAAAAAAAAAAAAAAAAAA/edit': exportBook(exportHeaders, [rec('G1')]), 'https://x/d/book2AAAAAAAAAAAAAAAAAAAA/edit': exportBook(exportHeaders, [rec('G2')]) };
  p.override('ss_', () => ({ getSheetByName: n => (n === central.getName() ? central : null), getId: () => 'x' }));
  p.override('activeReportingGrants_', () => [
    { 'Grant ID': 'G1', 'Grant Type': 'Restricted', 'Financial Year': '2026-27', 'Organisation Name': 'O1', 'Project Title': 'T1' },
    { 'Grant ID': 'G2', 'Grant Type': 'Restricted', 'Financial Year': '2026-27', 'Organisation Name': 'O2', 'Project Title': 'T2' }]);
  p.override('outcomeProgressWorkbookUrlForGrant_', id => (id === 'G1' ? 'https://x/d/book1AAAAAAAAAAAAAAAAAAAA/edit' : 'https://x/d/book2AAAAAAAAAAAAAAAAAAAA/edit'));
  p.override('openSpreadsheetCached_', id => { opened.push(id); return books[id]; });
  p.override('extendTableToSheetEnd_', () => {});
  return { p, central, opened };
}

test('unchanged workbooks are skipped on the next refresh; a changed one is read again; central rows are kept', () => {
  const store = {}, stamps = { book1AAAAAAAAAAAAAAAAAAAA: 100, book2AAAAAAAAAAAAAAAAAAAA: 100 };
  const first = refreshWithState(id => stamps[id], store);
  assert.equal(first.p.get('refreshOutcomeProgressTracker_')(), 2);
  assert.deepEqual(first.opened.sort(), ['https://x/d/book1AAAAAAAAAAAAAAAAAAAA/edit', 'https://x/d/book2AAAAAAAAAAAAAAAAAAAA/edit']);
  assert.equal(Object.keys(store).length, 2, 'read times remembered');

  stamps.book2AAAAAAAAAAAAAAAAAAAA = 200; // only G2 changed
  const second = refreshWithState(id => stamps[id], store);
  second.central.grid = first.central.grid.map(r => r.slice());
  assert.equal(second.p.get('refreshOutcomeProgressTracker_')(), 1);
  assert.deepEqual(second.opened, ['https://x/d/book2AAAAAAAAAAAAAAAAAAAA/edit']);
  assert.match(second.p.get('refreshNote_')(), /1 unchanged workbook\(s\) skipped/);
  const ids = second.central.grid.slice(2).map(r => r[OUT.indexOf('Grant ID')]).filter(Boolean).sort();
  assert.deepEqual(ids, ['G1', 'G2'], 'the skipped grant keeps its central row');
});

test('a broken workbook is reported and skipped; the other grants are still refreshed and only good ones are remembered', () => {
  const store = {};
  const ctx = refreshWithState(() => 1, store);
  const original = ctx.p.get('openSpreadsheetCached_');
  ctx.p.override('openSpreadsheetCached_', id => { if (id === 'https://x/d/book1AAAAAAAAAAAAAAAAAAAA/edit') throw new Error('No access to file'); return original(id); });
  assert.equal(ctx.p.get('refreshOutcomeProgressTracker_')(), 1);
  assert.match(ctx.p.get('refreshNote_')(), /1 grant\(s\) skipped because of a problem: G1 — No access to file/);
  assert.deepEqual(Object.keys(store), ['rd|outcome|g2']);
});

test('a full re-read (force) ignores and clears the remembered read times', () => {
  const store = { 'rd|outcome|g1': '100', 'rd|outcome|g2': '100' };
  const ctx = refreshWithState(() => 100, store);
  ctx.p.run('FORCE_FULL_REFRESH_ = true');
  assert.equal(ctx.p.get('refreshOutcomeProgressTracker_')(), 2);
  ctx.p.get('forgetReadMarks_')();
  assert.deepEqual(Object.keys(store), []);
});

test('upsertTrackerObjects_ names the missing required central column', () => {
  const sheet = new FakeSheet(A.SHEETS.OUTCOMES, [['T'], ['Grant ID']], { maxRows: 10 });
  sheet.getSheetId = () => 's';
  assert.throws(() => project.get('upsertTrackerObjects_')(sheet, OUT_ROW, 'Outcome Progress', [], ['Grant ID'], ['Grant ID', 'Outcome ID']),
    /Outcome Progress is missing the column "Outcome ID"/);
});
