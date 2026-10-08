'use strict';
// Transactional workbooks: each Upload Folder cell links to the grant's Disbursement Documents folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

test('Transactional Upload Folder cells become a link to the Disbursement Documents folder (idempotent, other columns untouched)', () => {
  const p = loadProject();
  const A = plain(p.get('APFP')), schema = A.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE;
  const formulas = Array.from({ length: schema.DATA_ROWS }, () => ['']), writes = [];
  const sheet = {
    getLastColumn: () => schema.HEADERS.length,
    getRange: (row, col, n, w) => ({
      getDisplayValues: () => [schema.HEADERS.slice(0, w || schema.HEADERS.length)],
      getFormulas: () => formulas.map(r => r.slice()),
      setFormulas: values => { writes.push({ row, col, n, values }); values.forEach((v, i) => { formulas[i][0] = v[0]; }); }
    })
  };
  const book = { getSheetByName: name => (name === A.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS ? sheet : null) };
  const url = 'https://drive.google.com/drive/folders/ABC';
  assert.equal(p.get('writeTransactionalUploadLinks_')(book, url), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].col, schema.HEADERS.indexOf('Upload Folder') + 1);
  assert.equal(writes[0].row, schema.DATA_START_ROW);
  assert.equal(writes[0].values.length, schema.DATA_ROWS);
  assert.equal(writes[0].values[0][0], `=HYPERLINK("${url}","Upload Folder")`);
  assert.equal(p.get('writeTransactionalUploadLinks_')(book, url), false, 'second run writes nothing');
  assert.throws(() => p.get('writeTransactionalUploadLinks_')(book, ''), /Disbursement Folder URL is missing/);
});
