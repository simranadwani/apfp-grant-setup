'use strict';
// The registered organisation name is never overwritten by saving a grant, changing a Grant Status, or a Returning Organisation match.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

function setup(record) {
  const writes = [], p = loadProject();
  p.override('organisationById_', () => ({ rowNumber: 4, record }));
  p.override('setByHeaders_', (sheet, hr, row, patch) => writes.push(plain(patch)));
  return { p, writes };
}

test('refreshing an organisation never changes its registered name', () => {
  const { p, writes } = setup({ 'Organisation Name': 'Sadaya Foundation Trust', 'Record Status': 'Active' });
  p.get('refreshOrganisationRegistryEntry_')('ORG1', 'Sadaya Foundation');
  assert.deepEqual(writes, []);
});

test('only a blank Record Status is filled in', () => {
  const { p, writes } = setup({ 'Organisation Name': 'Sadaya Foundation Trust', 'Record Status': '' });
  p.get('refreshOrganisationRegistryEntry_')('ORG1');
  assert.deepEqual(writes, [{ 'Record Status': 'Active' }]);
  assert.equal('Organisation Name' in writes[0], false);
});

test('a Returning Organisation match keeps the registered name exactly', () => {
  const writes = [], p = loadProject();
  p.override('organisationById_', () => null);
  p.override('activeOrganisationRecordsByName_', () => [{ rowNumber: 4, record: { 'Organisation Name': 'Sadaya Foundation Trust' } }]);
  p.override('setByHeaders_', (sheet, hr, row, patch) => writes.push(plain(patch)));
  const result = plain(p.get('resolveOrganisation_')({ organisationType: 'Returning Organisation', organisationName: 'sadaya foundation trust' }, null));
  assert.equal(result['Organisation Name'], 'Sadaya Foundation Trust');
  assert.equal(writes.every(patch => !('Organisation Name' in patch)), true);
});
