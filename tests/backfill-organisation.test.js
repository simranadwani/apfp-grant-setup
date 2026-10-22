'use strict';
// Version 1.6: an organisation is New in one financial year only; a later year may already exist (back-filling earlier years).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

const org = { rowNumber: 5, record: { 'Organisation ID': 'O1', 'Organisation Name': 'Arpan', 'Record Status': 'Active' } };
function setup(techRows) {
  const p = loadProject(), writes = [], appended = [];
  p.override('technicalRegistryRows_', () => techRows.map(record => ({ record })));
  p.override('organisationRecordsByName_', name => (name === 'Arpan' ? [org] : []));
  p.override('activeOrganisationRecordsByName_', name => (name === 'Arpan' ? [org] : []));
  p.override('findDuplicateGrant_', () => false);
  p.override('techByRequest_', () => null);
  p.override('setByHeaders_', (...a) => writes.push(a));
  p.override('appendObject_', (...a) => appended.push(a));
  p.override('uniqueOrganisationId_', () => 'NEW_ID');
  const row = (extra) => Object.assign({ action: 'Create Workspace', requestId: 'R-NEW', organisationName: 'Arpan', projectTitle: 'T', grantType: 'Transactional',
    amountApproved: 1000, granteeEmail: 'a@x.org', organisationType: 'New Organisation', financialYear: '2024-25',
    grantStartDate: new (p.get('Date'))(2024, 3, 1), grantEndDate: new (p.get('Date'))(2025, 2, 31) }, extra);
  return { p, writes, appended, row, validate: extra => p.get('validateIntakeRequest_')(row(extra)) };
}
const t = (id, type, fy, req) => ({ 'Organisation ID': id, 'Organisation Type': type, 'Financial Year': fy, 'Request ID': req });

test('New in 2024-25 is allowed when the organisation exists only through a Returning 2026-27 grant', () => {
  const s = setup([t('O1', 'Returning Organisation', '2026-27', 'R-OLD')]);
  assert.equal(s.validate().ok, true);
});

test('New is refused when the organisation is already New in another year, naming that year', () => {
  const s = setup([t('O1', 'New Organisation', '2025-26', 'R-OLD')]);
  const result = s.validate();
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /already marked as a New Organisation in 2025-26/);
});

test('a retry of the same request is not blocked by its own record', () => {
  const s = setup([t('O1', 'New Organisation', '2024-25', 'R-NEW')]);
  assert.equal(s.validate().ok, true);
});

test('a name that is not in the registry is still a valid New Organisation', () => {
  const s = setup([]);
  assert.equal(s.validate({ organisationName: 'Brand New Trust' }).ok, true);
});

test('creating the back-filled grant reuses the existing organisation and adds no second registry row', () => {
  const s = setup([t('O1', 'Returning Organisation', '2026-27', 'R-OLD')]);
  const record = s.p.get('resolveOrganisation_')({ organisationType: 'New Organisation', organisationName: 'Arpan', financialYear: '2024-25', requestId: 'R-NEW' }, null);
  assert.equal(record['Organisation ID'], 'O1');
  assert.equal(s.appended.length, 0);
});

test('creating is refused when the organisation is already New in another year', () => {
  const s = setup([t('O1', 'New Organisation', '2026-27', 'R-OLD')]);
  assert.throws(() => s.p.get('resolveOrganisation_')({ organisationType: 'New Organisation', organisationName: 'Arpan', financialYear: '2024-25', requestId: 'R-NEW' }, null), /already marked as a New Organisation in 2026-27/);
});

test('an unknown name still creates a new organisation', () => {
  const s = setup([]);
  const record = s.p.get('resolveOrganisation_')({ organisationType: 'New Organisation', organisationName: 'Brand New Trust', financialYear: '2024-25', requestId: 'R-NEW' }, null);
  assert.equal(record['Organisation ID'], 'NEW_ID');
  assert.equal(s.appended.length, 1);
});

test('rows beyond 501 are read: there is no fixed row ceiling in Workspace Creator', () => {
  const { p } = setup([]);
  assert.equal(p.get('APFP').INTAKE.MAX_ROW, undefined);
  const rows = Array.from({ length: 650 }, (_, i) => (i === 649 ? ['Create Workspace'] : ['']));
  const sheet = { getLastRow: () => 652, getLastColumn: () => 1, getRange: (r, c, n) => ({
    getDisplayValues: () => [['Action']], getValues: () => rows.slice(0, n) }) };
  p.override('sheet_', () => sheet);
  assert.equal(p.get('intakeRowsWithActions_')().length, 1);
  assert.equal(p.get('intakeRowsWithActions_')()[0].rowNumber, 652);
});
