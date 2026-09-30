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
    removeEditors(emails) { emails.forEach(email => { const i = list.findIndex(u => u.getEmail() === email); if (i >= 0) list.splice(i, 1); }); },
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

test('protection hardening makes few calls: nothing to do when editors are already right, one batched remove otherwise', () => {
  const calls = [];
  const wrap = protection => new Proxy(protection, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { calls.push(String(k)); return t[k](...a); } : t[k] });
  const p = loadProject();
  p.override('workbookOwnerEmail_', () => 'owner@example.org');
  p.override('config_', () => ({}));
  const ok = fakeProtection(['owner@example.org', 'tester@example.org']);
  p.get('hardenProtectionEditors_')(wrap(ok), { getId: () => 'wb1' });
  assert.deepEqual(calls.filter(c => /add|remove/.test(c)), []);
  calls.length = 0;
  const dirty = fakeProtection(['owner@example.org', 'a@x.org', 'b@x.org']);
  p.get('hardenProtectionEditors_')(wrap(dirty), { getId: () => 'wb1' });
  assert.deepEqual(calls.filter(c => /add|remove/.test(c)), ['addEditors', 'removeEditors']);
  assert.deepEqual(dirty.emails().sort(), ['owner@example.org', 'tester@example.org']);
});

test('the owner/actor lookup happens once per workbook, not once per protection', () => {
  let lookups = 0;
  const p = loadProject();
  p.override('workbookOwnerEmail_', () => { lookups++; return 'owner@example.org'; });
  p.override('config_', () => ({}));
  const wb = { getId: () => 'wb2' };
  for (let i = 0; i < 13; i++) p.get('hardenProtectionEditors_')(fakeProtection(['owner@example.org', 'tester@example.org']), wb);
  assert.equal(lookups, 1);
});

function shareAssertSetup() {
  const calls = [];
  const p = loadProject();
  const wb = id => ({ getId: () => id });
  const books = { setup: wb('setup'), outcome: wb('outcome') };
  p.override('techByRequest_', () => ({ record: { 'Grant Type': 'Restricted', 'Setup Workbook URL': 'https://x/d/setup/edit',
    'Outcome Progress Workbook URL': 'https://x/d/outcome/edit', 'Primary Contact Email': 'g@x.org' } }));
  p.override('urlId_', url => (url.includes('/setup/') ? 'setup' : 'outcome'));
  p.override('openSpreadsheetCached_', id => books[id]);
  p.override('templateFieldConfigRows_', () => []);
  ['verifyGeneratedLinks_', 'verifyTemplateProtections_', 'verifyOutcomeWorkbookLinks_', 'verifyOutcomeWorkbookProtections_', 'verifySpreadsheetTimeZone_', 'verifyGranteeProtectionAccess_']
    .forEach(name => p.override(name, () => calls.push(name)));
  p.override('setupWorkbookProtectionSpecs_', () => []);
  p.override('outcomeWorkbookProtectionSpecs_', () => []);
  return { p, calls, books };
}

test('pre-share check repeats the full verification unless this same run just verified the workbooks', () => {
  const fresh = shareAssertSetup();
  fresh.p.get('assertWorkspaceFilesSafeToShare_')('REQ1', {});
  assert.equal(fresh.calls.filter(c => c === 'verifyTemplateProtections_').length, 1);
  assert.equal(fresh.calls.filter(c => c === 'verifyOutcomeWorkbookProtections_').length, 1);

  const warm = shareAssertSetup();
  warm.p.get('markVerifiedThisRun_')(warm.books.setup);
  warm.p.get('markVerifiedThisRun_')(warm.books.outcome);
  warm.p.get('assertWorkspaceFilesSafeToShare_')('REQ1', {});
  assert.deepEqual(warm.calls, ['verifyGranteeProtectionAccess_', 'verifyGranteeProtectionAccess_'], 'grantee-access check still runs');
});

test('the after-sharing check (email given) always does the full verification, even in the same run', () => {
  const warm = shareAssertSetup();
  warm.p.get('markVerifiedThisRun_')(warm.books.setup);
  warm.p.get('markVerifiedThisRun_')(warm.books.outcome);
  warm.p.get('assertWorkspaceFilesSafeToShare_')('REQ1', {}, 'g@x.org');
  assert.equal(warm.calls.filter(c => c === 'verifyTemplateProtections_').length, 1);
  assert.equal(warm.calls.filter(c => c === 'verifySpreadsheetTimeZone_').length, 2);
});
