'use strict';
// Version 1.8: Correct Workspace Details can rename the organisation; the new name reaches every grant and tracker of that organisation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

function setup(extra) {
  const writes = [], p = loadProject();
  const org = { rowNumber: 4, record: { 'Organisation ID': 'O1', 'Organisation Name': 'Atma Educaton' } };
  const grants = [{ rowNumber: 5, record: { 'Grant ID': 'G1', 'Organisation ID': 'O1' } }, { rowNumber: 6, record: { 'Grant ID': 'G2', 'Organisation ID': 'O1' } },
    { rowNumber: 7, record: { 'Grant ID': 'G9', 'Organisation ID': 'O2' } }];
  const techs = [{ rowNumber: 3, record: { 'Organisation ID': 'O1' } }, { rowNumber: 4, record: { 'Organisation ID': 'O2' } }];
  p.override('organisationById_', () => org);
  p.override('grantRegistryRows_', () => grants);
  p.override('technicalRegistryRows_', () => techs);
  p.override('setByHeaders_', (sheet, header, row, patch) => { if (extra && extra.failSheet === sheet) throw new Error('boom'); writes.push([sheet, row, plain(patch)]); });
  p.override('setIntake_', (row, patch) => writes.push(['intake', row, plain(patch)]));
  p.override('findRows_', (sheet, header, name, value) => (name === 'Organisation ID' ? [11, 12] : [value === 'G1' ? 20 : 30]));
  p.override('now_', () => 'NOW');
  return { p, writes, rename: () => p.get('renameOrganisationEverywhere_')('O1', 'Atma Education') };
}

test('the new name reaches the registry, every grant of that organisation, the intake rows and all five trackers', () => {
  const { writes, rename } = setup();
  const warnings = rename();
  assert.deepEqual(plain(warnings), []);
  const where = name => writes.filter(w => w[0] === name);
  assert.equal(where('9. Organisation Registry').length, 1);
  assert.deepEqual(where('8. Grant Registry').map(w => w[1]), [5, 6]);            // O2's grant is untouched
  assert.deepEqual(where('System - Technical Registry').map(w => w[1]), [3]);
  assert.deepEqual(where('intake').map(w => w[1]), [11, 12]);
  ['2. Outcome Progress', '3. Support', '4. Decision Tracker', '6. Committed & Spent Tracker', '7. Organisation Maturity']
    .forEach(sheet => assert.equal(where(sheet).length, 2, sheet));                  // one row per grant (G1, G2)
  assert.equal(writes.every(w => w[2]['Organisation Name'] === 'Atma Education'), true);
});

test('a tracker that cannot be updated is reported, and the other places are still renamed', () => {
  const { writes, rename } = setup({ failSheet: '3. Support' });
  const warnings = plain(rename());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /3\. Support could not be updated/);
  assert.equal(writes.some(w => w[0] === '8. Grant Registry'), true);
});

function correct(changes, existingNames) {
  const p = loadProject(), calls = { renamed: [] };
  p.override('grantById_', () => ({ rowNumber: 5, record: { 'Project Title': 'T', 'Organisation ID': 'O1', 'Organisation Name': 'Atma Educaton', 'Financial Year': '2026-27' } }));
  p.override('techByRequest_', () => ({ record: { 'Grant ID': 'G1', 'Workspace Status': 'Workspace Created', 'Financial Year': '2026-27' } }));
  p.override('organisationRecordsByName_', name => (existingNames || {})[name.toLowerCase()] ? [{ record: { 'Organisation ID': existingNames[name.toLowerCase()] } }] : []);
  p.override('renameOrganisationEverywhere_', (id, name) => { calls.renamed.push([id, name]); return []; });
  p.override('setByHeaders_', () => {}); p.override('saveTech_', () => ({ record: {} })); p.override('setIntake_', () => {}); p.override('now_', () => 'NOW');
  p.ctx.SpreadsheetApp = { flush() {} };
  return { calls, run: () => plain(p.get('applyGrantCorrections_')('G1', 'R1', 7, changes)) };
}

test('correcting the name renames the organisation once and says what it did not touch', () => {
  const c = correct({ organisationName: '  Atma Education ' });
  const result = c.run();
  assert.deepEqual(result.applied, ['Organisation Name']);
  assert.deepEqual(c.calls.renamed, [['O1', 'Atma Education']]);
  assert.match(result.warning, /folder.*keep the old name/);
});

test('a blank name, or a name that already belongs to another organisation, is refused before anything changes', () => {
  assert.throws(() => correct({ organisationName: '  ' }).run(), /cannot be blank/);
  const c = correct({ organisationName: 'Arpan' }, { arpan: 'O7' });
  assert.throws(() => c.run(), /Another organisation is already called "Arpan"/);
  assert.equal(c.calls.renamed.length, 0);
});

test('the same name, or only different capitalisation of its own name, is not a conflict', () => {
  const same = correct({ organisationName: 'Atma Educaton' });
  assert.deepEqual(same.run().applied, []);
  const own = correct({ organisationName: 'ATMA EDUCATON' }, { 'atma educaton': 'O1' });
  assert.deepEqual(own.run().applied, ['Organisation Name']);
});
