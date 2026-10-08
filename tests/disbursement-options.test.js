'use strict';
// The organisation dropdown refresh reads two columns and writes once per run of rows with the same financial year.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

function setup(rows, optionsByFy) {
  const log = [];
  const build = () => ({ requireValueInList: list => ({ setAllowInvalid: () => ({ build: () => ({ list }) }) }) });
  const p = loadProject({ SpreadsheetApp: { newDataValidation: build } });
  const map = { 'financial year': 0, 'organisation name': 1 };
  const sheet = {
    getLastRow: () => 2 + rows.length,
    getRange: (row, col, n, m) => ({
      getDisplayValues: () => rows.slice(row - 3, row - 3 + n).map(r => [r[col - 1]]),
      getValues: () => rows.slice(row - 3, row - 3 + n).map(r => [r[col - 1]]),
      clearNote: () => log.push(['clearNote', row, n]),
      clearDataValidations: () => log.push(['clearValidations', row, n]),
      setDataValidation: rule => log.push(['validation', row, n, rule.list]),
      clearContent: () => log.push(['clearContent', row])
    })
  };
  p.override('disbTracker_', () => sheet);
  p.override('disbHeaderRow_', () => 2);
  p.override('disbHeaderMap_', () => map);
  p.override('disbColumn_', (m, name) => m[name.toLowerCase()] + 1);
  p.override('disbCanonicalFy_', v => v);
  p.override('disbursementOrganisationsForFy_', fy => { log.push(['options', fy]); return optionsByFy[fy] || []; });
  return { p, log };
}

test('rows are grouped by consecutive financial year; options are computed once per year; invalid names are cleared', () => {
  const { p, log } = setup([['2026-27', 'A'], ['2026-27', 'Gone'], ['2027-28', 'B'], ['', ''], ['2026-27', 'A']],
    { '2026-27': ['A', 'C'], '2027-28': [] });
  assert.equal(p.get('refreshDisbursementOrganisationOptions_')(), 4);
  assert.deepEqual(log.filter(e => e[0] === 'options').map(e => e[1]), ['2026-27', '2027-28'], 'once per year');
  assert.deepEqual(log.filter(e => e[0] === 'validation').map(e => [e[1], e[2]]), [[3, 2], [7, 1]], 'one write per run of rows');
  assert.deepEqual(log.filter(e => e[0] === 'clearValidations').map(e => [e[1], e[2]]), [[5, 1]], 'a year without options clears the dropdown');
  assert.deepEqual(log.filter(e => e[0] === 'clearContent').map(e => e[1]), [4], 'only the name that is no longer allowed is cleared');
});
