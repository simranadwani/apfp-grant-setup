'use strict';
// Correct Workspace Details also corrects Organisation Type (saved to the Technical Registry, echoed on the row).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

function setup(row) {
  const p = loadProject(), calls = { tech: [], intake: [], grant: [] };
  p.override('rowObject_', () => row);
  p.override('grantById_', () => ({ rowNumber: 5, record: {} }));
  p.override('techByRequest_', () => ({ record: { 'Grant ID': 'G1', 'Workspace Status': 'Workspace Created' } }));
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
const base = { 'Grant ID': 'G1', 'Request ID': 'R1', 'Grant Title': 'T', 'Amount Approved': 100, 'Thematic Area': 'A',
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
