'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

function patchFor(grantType, techExtra) {
  const p = loadProject();
  p.override('grantById_', () => ({ record: { 'Grant Type': grantType, 'Grant Status': 'Active' } }));
  const tech = { record: Object.assign({ 'Grant Type': grantType, 'Workspace Status': 'Workspace Created',
    'Setup Review Status': 'Awaiting Review', 'Request ID': 'REQ1', 'Organisation Folder URL': 'https://x/y' }, techExtra || {}) };
  return plain(p.get('workspaceCreatorSystemPatch_')('G1', tech));
}

test('Restricted / Unrestricted keep Workspace Created and their review status', () => {
  ['Restricted', 'Unrestricted'].forEach(type => {
    const patch = patchFor(type);
    assert.equal(patch['Workspace Status'], 'Workspace Created');
    assert.equal(patch['Setup Review Status'], 'Awaiting Review');
  });
});

test('Transactional shows Disbursement Only and Setup Review Not Applicable', () => {
  const patch = patchFor('Transactional');
  assert.equal(patch['Workspace Status'], 'Disbursement Only');
  assert.equal(patch['Setup Review Status'], 'Not Applicable');
});

test('Discretionary shows Registry Only and Setup Review Not Applicable', () => {
  const patch = patchFor('Discretionary', { 'Workspace Status': 'Registry Only', 'Setup Review Status': 'Not Applicable' });
  assert.equal(patch['Workspace Status'], 'Registry Only');
  assert.equal(patch['Setup Review Status'], 'Not Applicable');
});

test('a failed or in-progress Transactional row keeps its real status (only Workspace Created is relabelled)', () => {
  assert.equal(patchFor('Transactional', { 'Workspace Status': 'Needs Attention' })['Workspace Status'], 'Needs Attention');
});

test('Not Applicable is an allowed Setup Review Status value in the dropdown definition', () => {
  const values = plain(loadProject().get('APFP')).ADMIN_TABLES;
  const flat = JSON.stringify(values);
  assert.ok(/"NAME":"Setup Review Status","TYPE":"DROPDOWN","VALUES":\[[^\]]*"Not Applicable"/.test(flat));
});
