'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

function setup(valueRanges, maxRows) {
  const calls = [];
  const Sheets = { Spreadsheets: { Values: { batchGet: (id, options) => { calls.push({ id, options }); return { valueRanges }; } } } };
  const p = loadProject({ Sheets });
  p.override('requireAdvancedSheetsService_', () => {});
  const spreadsheet = { getId: () => 'wb1', getSheetByName: n => (n === 'Nope' ? null : { getMaxRows: () => maxRows || 100, getMaxColumns: () => 8 }) };
  const fieldConfig = [
    { 'Field Code': 'org_name', 'Sheet Name': 'Setup', 'Value Cell(s)': 'C5' },
    { 'Field Code': 'grant_title', 'Sheet Name': 'Setup', 'Value Cell(s)': 'C6:C7' }];
  return { p, calls, spreadsheet, fieldConfig };
}
const verify = ctx => ctx.p.get('verifyConfiguredWorkbook_')(ctx.spreadsheet, ctx.fieldConfig);

test('placeholder check reads all Field Config ranges in ONE Sheets call', () => {
  const ctx = setup([{ values: [['Sadaya']] }, { values: [['x'], ['y']] }]);
  verify(ctx);
  assert.equal(ctx.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls[0].options.ranges)), ["'Setup'!C5", "'Setup'!C6:C7"]);
});

test('an invisible placeholder (non-breaking space) is still reported, with the field code', () => {
  const ctx = setup([{ values: [['Sadaya']] }, { values: [['ok'], [' ']] }]);
  assert.throws(() => verify(ctx), /Invisible placeholder remained in grant_title/);
});

test('empty ranges (Sheets omits values) pass; a Field Config row pointing at a missing sheet fails', () => {
  verify(setup([{}, {}]));
  const bad = setup([{}, {}]);
  bad.fieldConfig[1]['Sheet Name'] = 'Nope';
  assert.throws(() => verify(bad), /Field Config references missing generated sheet: Nope/);
});

test('clipA1ToGrid_ shortens, skips or passes ranges through (the Sheets API rejects out-of-grid ranges)', () => {
  const clip = loadProject().get('clipA1ToGrid_');
  assert.equal(clip('C5', 6, 8), 'C5');
  assert.equal(clip('B7', 6, 8), '');
  assert.equal(clip('B5:B12', 6, 8), 'B5:B6');
  assert.equal(clip('A1:J3', 6, 8), 'A1:H3');
  assert.equal(clip('J2', 6, 8), '');
  assert.equal(clip("$C$5:$D$6", 6, 8), 'C5:D6');
  assert.equal(clip('A:A', 6, 8), 'A:A');
});

test('a Field Config range beyond the sheet grid (stale Links!B7 row) no longer breaks the check', () => {
  const ctx = setup([{ values: [['ok']] }], 6);
  ctx.fieldConfig = [{ 'Field Code': 'link_q1', 'Sheet Name': 'Links', 'Value Cell(s)': 'B7' },
    { 'Field Code': 'org_name', 'Sheet Name': 'Links', 'Value Cell(s)': 'B5:B12' }];
  verify(ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls[0].options.ranges)), ["'Links'!B5:B6"]);
});
