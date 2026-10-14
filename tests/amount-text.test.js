'use strict';
// Version 1.4: an Amount Approved pasted as text ("₹7,50,000.00") is turned into a number instead of showing as blank.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, FakeSheet } = require('./harness');

function setup(rows) {
  const p = loadProject();
  const sheet = new FakeSheet('1. Workspace Creator', [['x'], ['Organisation Name', 'Amount Approved'].concat([]), ...rows]);
  p.override('sheet_', () => sheet);
  return { p, sheet };
}
const amounts = sheet => [3, 4, 5, 6, 7, 8].map(r => sheet.cell(r, 2));

test('text amounts that read as money become numbers; real numbers, blanks and other text are left alone', () => {
  const { p, sheet } = setup([['A', '₹7,50,000.00'], ['B', 90000], ['C', ''], ['D', '₹1,00,00,000.00'], ['E', 'to be confirmed'], ['F', '2,50,000']]);
  const changed = p.get('normaliseAmountColumn_')('1. Workspace Creator', 2, 3, 8);
  assert.equal(changed, 3);
  assert.deepEqual(amounts(sheet), [750000, 90000, '', 10000000, 'to be confirmed', 250000]);
});

test('an edit or paste only repairs the rows it touched', () => {
  const { p, sheet } = setup([['A', '₹7,50,000.00'], ['B', '₹2,00,000.00'], ['C', '₹3,00,000.00']]);
  p.override('intakeColumn_', () => 2);
  p.get('normaliseAmountApprovedEdit_')({ range: { getRow: () => 4, getLastRow: () => 4, getColumn: () => 2, getLastColumn: () => 2, getSheet: () => sheet } });
  assert.deepEqual([3, 4, 5].map(r => sheet.cell(r, 2)), ['₹7,50,000.00', 200000, '₹3,00,000.00']);
});

test('the open-time repair covers Workspace Creator, Grant Registry and Technical Registry', () => {
  const p = loadProject(), calls = [];
  p.override('normaliseAmountColumn_', (name, header, start) => { calls.push([name, header, start]); return 1; });
  assert.equal(p.get('normaliseAmountApprovedEverywhere_')(), 3);
  assert.deepEqual(calls.map(c => c[0]), ['1. Workspace Creator', '8. Grant Registry', 'System - Technical Registry']);
});

test('opening the sheet never fails because of the repair', () => {
  const p = loadProject();
  p.override('applyWorkspaceOrganisationDropdown_', () => {});
  p.override('normaliseAmountApprovedEverywhere_', () => { throw new Error('boom'); });
  assert.doesNotThrow(() => p.get('handleCentralAdminOpen')());
});

test('validation carries a pasted-text amount on as a number, also for a grant that already exists', () => {
  const p = loadProject();
  p.override('techByRequest_', () => ({ record: { 'Grant ID': 'G1', 'Organisation ID': 'O1' } }));
  p.override('activeOrganisationRecordsByName_', () => []);
  p.override('organisationRecordsByName_', () => []);
  p.override('findDuplicateGrant_', () => false);
  const row = { action: 'Retry Workspace', requestId: 'R1', organisationName: 'Org', projectTitle: 'T', grantType: 'Transactional', amountApproved: '₹7,50,000.00',
    granteeEmail: 'a@x.org', organisationType: 'New Organisation', financialYear: '2026-27', grantStartDate: new (p.get('Date'))(2026, 3, 1), grantEndDate: new (p.get('Date'))(2027, 2, 31) };
  p.get('validateIntakeRequest_')(row);
  assert.equal(row.amountApproved, 750000);
});
