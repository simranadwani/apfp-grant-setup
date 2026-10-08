'use strict';
// Preflight requires header NAMES, not exact order or width: extra/reordered columns pass (extras are warnings).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain, FakeSheet } = require('./harness');

test('headerGaps_ reports missing required headers and extras, ignoring order and case', () => {
  const gaps = plain(loadProject().get('headerGaps_')(['b', 'A ', '', 'Surprise'], ['A', 'B', 'C']));
  assert.deepEqual(gaps, { missing: ['C'], extra: ['Surprise'] });
});

function checkWith(headers) {
  const p = loadProject();
  const required = ['Grant ID', 'Grant Title'];
  const sheet = new FakeSheet('S', [[], headers]);
  p.override('ss_', () => ({ getSheetByName: () => sheet }));
  const errors = [], warnings = [];
  p.get('checkHeaders_')(errors, 'S', 2, required, warnings);
  return { errors, warnings };
}

test('checkHeaders_: reordered required headers plus a new column pass with no warning', () => {
  const { errors, warnings } = checkWith(['Notes', 'Grant Title', 'Grant ID']);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('checkHeaders_: a missing required header is a blocking error naming it', () => {
  const { errors } = checkWith(['Grant ID', 'Notes']);
  assert.match(errors[0], /missing required header\(s\): Grant Title/);
});

test('checkAdminTables_: an extra Table column and different column order pass; a missing column fails', () => {
  const p = loadProject();
  const spec = { SHEET_NAME: 'Sheet A', TABLE_NAME: 'TableA', HEADER_ROW: 1, MIN_ROWS: 5,
    COLUMNS: [{ NAME: 'One', TYPE: 'TEXT' }, { NAME: 'Two', TYPE: 'DROPDOWN', VALUES: ['x', 'y'] }] };
  const table = columns => ({ name: 'TableA', range: { startRowIndex: 0, startColumnIndex: 0, endColumnIndex: columns.length, endRowIndex: 50 }, columnProperties: columns });
  const dd = { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'x' }, { userEnteredValue: 'y' }] } };
  const snapshot = cols => ({ sheets: [{ properties: { title: 'Sheet A' }, tables: [table(cols)] }] });
  const run = cols => {
    p.override('adminTablesSnapshot_', () => snapshot(cols));
    const errors = [], warnings = [];
    p.get('checkAdminTables_')(errors, warnings, [spec]);
    return { errors, warnings };
  };
  const ok = run([{ columnIndex: 0, columnName: 'Team Note', columnType: 'TEXT' },
    { columnIndex: 1, columnName: 'Two', columnType: 'DROPDOWN', dataValidationRule: dd }, { columnIndex: 2, columnName: 'One', columnType: 'TEXT' }]);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
  const bad = run([{ columnIndex: 0, columnName: 'One', columnType: 'TEXT' }, { columnIndex: 1, columnName: 'Other', columnType: 'TEXT' }]);
  assert.ok(bad.errors.some(e => /missing required column "Two"/.test(e)));
});
