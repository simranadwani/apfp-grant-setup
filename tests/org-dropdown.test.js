'use strict';
// Sheet-open Organisation Name rule: the registry list applies to Returning / untyped rows; New Organisation rows get no rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

test('New Organisation rows are cleared; Returning and untyped rows get the registry rule', () => {
  const types = { 3: 'New Organisation', 4: 'New Organisation', 5: 'Returning Organisation', 6: '', 7: 'New Organisation' };
  const applied = [], cleared = [];
  const p = loadProject({
    SpreadsheetApp: { newDataValidation: () => { const b = { requireValueInRange() { return b; }, setAllowInvalid() { return b; }, build: () => 'RULE' }; return b; } }
  });
  const A = plain(p.get('APFP'));
  p.override('intakeColumn_', name => (name === 'Organisation Type' ? 4 : 5));
  const intake = { getRange: (row, col, n) => ({
    getDisplayValues: () => Array.from({ length: n }, (_, i) => [types[row + i] || '']),
    setDataValidation: rule => applied.push([row, col, n, rule]),
    clearDataValidations: () => cleared.push([row, col, n])
  }) };
  p.override('sheet_', name => (name === A.SHEETS.INTAKE ? intake : { getMaxRows: () => 100, getRange: () => ({}) }));
  p.get('applyWorkspaceOrganisationDropdown_')();
  const rows = list => list.flatMap(([row, , n]) => Array.from({ length: n }, (_, i) => row + i));
  assert.deepEqual(rows(cleared).filter(r => r <= 7), [3, 4, 7]);
  assert.deepEqual(rows(applied).filter(r => r <= 7), [5, 6]);
  assert.equal(applied.every(item => item[3] === 'RULE'), true);
  assert.equal(rows(applied).length + rows(cleared).length, A.INTAKE.MAX_ROW - A.INTAKE.START_ROW + 1, 'every row is covered exactly once');
});
