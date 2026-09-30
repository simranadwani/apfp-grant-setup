'use strict';
// 7. Organisation Maturity is read and written by header name: an added or moved column never garbles or duplicates rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, FakeSheet } = require('./harness');

function setup(headers) {
  const sheet = new FakeSheet('7. Organisation Maturity', [['TITLE'], headers.slice()], { maxRows: 60 });
  const p = loadProject();
  p.override('sheet_', () => sheet);
  p.override('grantById_', () => ({ rowNumber: 2, record: { 'Financial Year': '2026-27', 'Grant ID': 'G1', 'Organisation Name': 'Org', 'Project Title': 'Title' } }));
  p.override('maturityCatalogue_', () => [{ aspect: 'Clarity', indicator: 'Vision' }, { aspect: 'Capacity', indicator: 'M&E' }]);
  p.override('setByHeaders_', () => {});
  p.override('extendAdminTableRows_', () => {});
  return { p, sheet };
}

test('a column inserted before the system columns does not garble rows, and a second run adds nothing', () => {
  const headers = ['Team Note', 'Financial Year', 'Grant ID', 'Organisation Name', 'Grant Title', 'Aspect', 'Indicator', 'Status'];
  const { p, sheet } = setup(headers);
  assert.equal(p.get('ensureOrganisationMaturityRowsForGrant_')('G1'), 2);
  assert.equal(sheet.cell(3, 1), '', 'the extra column stays blank');
  assert.equal(sheet.cell(3, 3), 'G1');
  assert.equal(sheet.cell(3, 6), 'Clarity');
  assert.equal(sheet.cell(3, 7), 'Vision');
  assert.equal(sheet.cell(4, 7), 'M&E');
  assert.equal(p.get('ensureOrganisationMaturityRowsForGrant_')('G1'), 0, 'existing rows are found by header, nothing is appended');
});

test('a missing required column is reported by name', () => {
  const { p } = setup(['Financial Year', 'Grant ID', 'Organisation Name', 'Grant Title', 'Aspect', 'Status']);
  assert.throws(() => p.get('ensureOrganisationMaturityRowsForGrant_')('G1'), /missing the column "Indicator"/);
});
