'use strict';
// The Setup template's "Upload Folder" cells only work when a Links cell's DISPLAYED text is a URL; the generated Links cells show a
// label, so the cells stayed plain text. writeSetupUploadFolderLinks_ writes the real link from the workbook's own Links sheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

const TEMPLATE = n => `=IFERROR(__xludf.DUMMYFUNCTION("IF(REGEXMATCH(Links!B${n},""^https://""),HYPERLINK(Links!B${n},""Upload Folder""),""Upload Folder"")"),"Upload Folder")`;

function sheet(name, top, left, grid) {
  return { getName: () => name, getDataRange: () => ({ getRow: () => top, getColumn: () => left, getFormulas: () => grid }) };
}
function setup(orgGrid) {
  const batches = [];
  const links = {
    getName: () => 'Links', getLastRow: () => 6,
    getRange: () => ({
      getFormulas: () => [['=HYPERLINK("https://drive.google.com/drive/folders/ORG","Open organisation workspace")'],
        ['=HYPERLINK("https://drive.google.com/drive/folders/SUP","Open supporting documents")'],
        ['=HYPERLINK("https://drive.google.com/drive/folders/BUD","Open budget & utilisation")']],
      getDisplayValues: () => [['Open organisation workspace'], ['Open supporting documents'], ['Open budget & utilisation']]
    })
  };
  const org = sheet('A. Org Information', 1, 1, orgGrid);
  const book = { getSheetByName: n => (n === 'Links' ? links : null), getSheets: () => [links, org], getId: () => 'SETUP_WORKBOOK_ID_1234567890' };
  const p = loadProject({ Sheets: { Spreadsheets: { Values: { batchUpdate: (body, id) => batches.push({ body, id }) } } } });
  p.override('requireAdvancedSheetsService_', () => {});
  return { p, book, batches };
}

test('every Upload Folder cell gets a real link to the folder named by its Links row', () => {
  const grid = [['', '', '', ''], ['', '', '', ''], ['', '', '', TEMPLATE(5)], ['', '', '', TEMPLATE(6)], ['Plain', 'text', '', '']];
  const { p, book, batches } = setup(grid);
  assert.equal(p.get('writeSetupUploadFolderLinks_')(book), 2);
  const data = plain(batches[0].body.data);
  assert.deepEqual(data.map(d => d.range), ["'A. Org Information'!D3", "'A. Org Information'!D4"]);
  assert.equal(data[0].values[0][0], '=HYPERLINK("https://drive.google.com/drive/folders/SUP","Upload Folder")');
  assert.equal(data[1].values[0][0], '=HYPERLINK("https://drive.google.com/drive/folders/BUD","Upload Folder")');
  assert.equal(batches[0].body.valueInputOption, 'USER_ENTERED');
});

test('cells that already hold the right link, and unrelated formulas, are left alone (one Sheets call, nothing when done)', () => {
  const done = '=HYPERLINK("https://drive.google.com/drive/folders/SUP","Upload Folder")';
  const { p, book, batches } = setup([['', done, '=SUM(A1:A2)', '=Links!B5']]);
  assert.equal(p.get('writeSetupUploadFolderLinks_')(book), 0);
  assert.equal(batches.length, 0);
});

test('a Links row without a URL (not configured) leaves its Upload Folder cells unchanged', () => {
  const { p, book, batches } = setup([[TEMPLATE(9)]]);
  assert.equal(p.get('writeSetupUploadFolderLinks_')(book), 0);
  assert.equal(batches.length, 0);
});
