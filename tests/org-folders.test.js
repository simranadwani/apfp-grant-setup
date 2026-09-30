'use strict';
// Two organisations whose names reduce to the same folder name each get their own folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

function fakeDrive() {
  const folders = [];
  const make = name => {
    const f = { name, id: 'FOLDER_ID_' + String(folders.length + 1).padStart(12, '0'), getName() { return this.name; }, getId() { return this.id; },
      getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; } };
    folders.push(f);
    return f;
  };
  const parent = { getId: () => 'PARENT_FOLDER_ID_000001', getName: () => 'FY', createFolder: make,
    getFoldersByName(name) { const list = folders.filter(f => f.name === name); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; } };
  return { parent, folders };
}
function setup(rows) {
  const p = loadProject();
  p.override('technicalRegistryRows_', () => rows.map(record => ({ record })));
  return p;
}

test('the first organisation keeps the plain folder name, the second gets its own suffixed folder', () => {
  const { parent, folders } = fakeDrive();
  const rows = [];
  const p = setup(rows);
  const first = p.get('organisationFolderFor_')(parent, '', 'A-B', 'ORG-1');
  rows.push({ 'Organisation ID': 'ORG-1', 'Organisation Folder URL': first.getUrl() });
  const second = p.get('organisationFolderFor_')(parent, '', 'A-B', 'ORG-2');
  assert.equal(first.getName(), 'A-B');
  assert.equal(second.getName(), 'A-B (ORG-2)');
  assert.notEqual(first.getId(), second.getId());
  assert.equal(folders.length, 2);
});

test('a retry of the second organisation reuses its own folder', () => {
  const { parent, folders } = fakeDrive();
  const rows = [];
  const p = setup(rows);
  const first = p.get('organisationFolderFor_')(parent, '', 'A-B', 'ORG-1');
  rows.push({ 'Organisation ID': 'ORG-1', 'Organisation Folder URL': first.getUrl() });
  const second = p.get('organisationFolderFor_')(parent, '', 'A-B', 'ORG-2');
  // not saved yet (crash before the checkpoint): the same call must find the suffixed folder again, not create a third
  const again = p.get('organisationFolderFor_')(parent, '', 'A-B', 'ORG-2');
  assert.equal(again.getId(), second.getId());
  assert.equal(folders.length, 2);
});

test('the same organisation finds its own folder, and an unrecorded folder is still reused', () => {
  const { parent, folders } = fakeDrive();
  const rows = [];
  const p = setup(rows);
  const byHand = parent.createFolder('Hand Made');
  assert.equal(p.get('organisationFolderFor_')(parent, '', 'Hand Made', 'ORG-9').getId(), byHand.getId());
  const own = p.get('organisationFolderFor_')(parent, '', 'Own', 'ORG-1');
  rows.push({ 'Organisation ID': 'ORG-1', 'Organisation Folder URL': own.getUrl() });
  assert.equal(p.get('organisationFolderFor_')(parent, '', 'Own', 'ORG-1').getId(), own.getId());
  assert.equal(folders.length, 2);
});
