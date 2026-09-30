'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

function fakeProtection(initial, denied) {
  const list = initial.map(email => ({ getEmail: () => email }));
  const add = email => { if (!list.some(u => u.getEmail() === email)) list.push({ getEmail: () => email }); };
  return {
    addEditors: emails => emails.forEach(add),
    addEditor(email) { if ((denied || []).includes(email)) throw new Error('no access to this file'); add(email); },
    getEditors: () => list.slice(),
    removeEditor(user) { const i = list.indexOf(user); if (i >= 0) list.splice(i, 1); },
    canDomainEdit: () => false, setDomainEdit() {},
    emails: () => list.map(u => u.getEmail())
  };
}
function harden(config, protection) {
  const p = loadProject();
  p.override('workbookOwnerEmail_', () => 'owner@example.org');
  p.override('config_', () => config);
  p.get('hardenProtectionEditors_')(protection, {});
  return protection.emails().sort();
}

test('protection keeps only owner and the running account by default', () => {
  const editors = harden({}, fakeProtection(['stranger@example.org', 'grantee@example.org']));
  assert.deepEqual(editors, ['owner@example.org', 'tester@example.org']);
});

test('PROTECTION_EDITORS adds the approved editors (any separator) and still removes everyone else', () => {
  const editors = harden({ PROTECTION_EDITORS: 'team@goalkeep.net; Anagha@Example.org | not-an-email' },
    fakeProtection(['stranger@example.org']));
  assert.deepEqual(editors, ['Anagha@Example.org', 'owner@example.org', 'team@goalkeep.net', 'tester@example.org']);
});

test('an approved editor without access to a workbook is skipped, not fatal', () => {
  const editors = harden({ PROTECTION_EDITORS: 'team@goalkeep.net,anagha@example.org' },
    fakeProtection([], ['anagha@example.org']));
  assert.deepEqual(editors, ['owner@example.org', 'team@goalkeep.net', 'tester@example.org']);
});

test('the end-of-run message names each row that needs attention and why', () => {
  const p = loadProject();
  const msg = p.get('runSummaryMessage_')(3, 1, 2, [
    { rowNumber: 9, organisation: 'Zz Test Org', reason: 'Grant End Date is required.' },
    { rowNumber: 12, organisation: '', reason: 'Enter a valid Primary Contact Email.' }], ' Paused.');
  assert.match(msg, /^Processed 3 requested action\(s\)\. 1 completed; 2 need attention\. Paused\./);
  assert.match(msg, /• Row 9 \(Zz Test Org\): Grant End Date is required\./);
  assert.match(msg, /• Row 12: Enter a valid Primary Contact Email\./);
  assert.doesNotMatch(p.get('runSummaryMessage_')(1, 1, 0, [], ''), /Needs attention/);
});

test('long failure lists are shortened', () => {
  const p = loadProject();
  const many = Array.from({ length: 11 }, (_, i) => ({ rowNumber: i + 3, organisation: 'O', reason: 'x' }));
  assert.match(p.get('runSummaryMessage_')(11, 0, 11, many, ''), /…and 3 more/);
});

test('backup copies the workbook into <Central Admin folder>/Backups with a timestamp', () => {
  const copies = [];
  const DriveApp = {
    getFolderById: id => ({ id }),
    getFileById: id => ({ makeCopy: (name, folder) => { copies.push({ id, name, folder }); return { getUrl: () => 'https://drive.example/copy' }; } })
  };
  const p = loadProject({ DriveApp });
  p.override('config_', () => ({ CENTRAL_ADMIN_FOLDER_ID: 'admin-folder' }));
  p.override('ss_', () => ({ getId: () => 'sheet-id', getName: () => 'APFP Central Administration' }));
  p.override('getOrCreateUniqueChildFolder_', (parent, name) => ({ parent: parent.id, name }));
  assert.equal(p.get('backupCentralAdministration_')(), 'https://drive.example/copy');
  assert.equal(copies[0].id, 'sheet-id');
  assert.match(copies[0].name, /^APFP Central Administration — backup \d{4}-\d{2}-\d{2} \d{4}$/);
  assert.deepEqual(copies[0].folder, { parent: 'admin-folder', name: 'Backups' });
});

test('backup explains what is missing when CENTRAL_ADMIN_FOLDER_ID is not configured', () => {
  const p = loadProject({ DriveApp: {} });
  p.override('config_', () => ({}));
  assert.throws(() => p.get('backupCentralAdministration_')(), /Missing active configuration: CENTRAL_ADMIN_FOLDER_ID/);
});
