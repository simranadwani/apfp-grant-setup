'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain, FakeSheet } = require('./harness');

const p = loadProject();

// '2. Outcome Progress' has its header on row 2 (APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.OUTCOMES).
function trackerSheet(dataRows, maxRows) {
  const grid = [['TITLE'], ['grant', 'outcome', 'value', 'manual'], ...dataRows];
  return new FakeSheet('2. Outcome Progress', grid, { maxRows: maxRows || 10 });
}

test('writeChangedMatrixRows_ writes nothing when nothing changed', () => {
  const sheet = trackerSheet([]);
  const changed = p.get('writeChangedMatrixRows_')(sheet, 3, 1, [['a', 1]], [['a', 1]]);
  assert.equal(changed, 0);
  assert.equal(sheet.writes.length, 0);
});

test('writeChangedMatrixRows_ groups consecutive changed rows into one write', () => {
  const sheet = trackerSheet([]);
  const current = [['a', 1], ['b', 2], ['c', 3], ['d', 4]];
  const desired = [['a', 9], ['b', 9], ['c', 3], ['d', 5]];
  const changed = p.get('writeChangedMatrixRows_')(sheet, 3, 1, current, desired);
  assert.equal(changed, 3);
  assert.deepEqual(sheet.writes.map(w => [w.row, w.rows]), [[3, 2], [6, 1]]);
});

test('rowValuesEqual_ treats different lengths as different (why partial-width rows always look changed)', () => {
  assert.equal(p.get('rowValuesEqual_')(['a', 1, 'x'], ['a', 1]), false);
  assert.equal(p.get('rowValuesEqual_')(['a', 1], ['a', 1]), true);
});

test('upsertTrackerRowsByKey_ adds a new key into the first empty row and keeps existing rows', () => {
  const sheet = trackerSheet([['G1', 'O1', 'old', 'keep me']]);
  const desired = [['G2', 'O1', 'new', '']];
  p.get('upsertTrackerRowsByKey_')(sheet, 4, desired, [0, 1], true);
  assert.deepEqual(plain(sheet.grid.slice(2, 4)), [['G1', 'O1', 'old', 'keep me'], ['G2', 'O1', 'new', '']]);
});

test('upsertTrackerRowsByKey_ updates a matching key in place', () => {
  const sheet = trackerSheet([['G1', 'O1', 'old', 'keep me']]);
  p.get('upsertTrackerRowsByKey_')(sheet, 4, [['g1', 'o1', 'fresh', 'keep me']], [0, 1], true);
  assert.deepEqual(plain(sheet.grid[2]), ['g1', 'o1', 'fresh', 'keep me']);
});

test('upsertTrackerRowsByKey_ preserves unmatched rows only when asked to', () => {
  const build = () => trackerSheet([['G1', 'O1', 'a', ''], ['G2', 'O1', 'b', '']]);
  const keep = build();
  p.get('upsertTrackerRowsByKey_')(keep, 4, [['G1', 'O1', 'a2', '']], [0, 1], true);
  assert.equal(keep.cell(4, 1), 'G2');
  const drop = build();
  p.get('upsertTrackerRowsByKey_')(drop, 4, [['G1', 'O1', 'a2', '']], [0, 1], false);
  assert.equal(drop.cell(4, 1), '');
});

test('upsertTrackerRowsByKey_ rejects duplicate keys', () => {
  assert.throws(() => p.get('upsertTrackerRowsByKey_')(trackerSheet([]), 4,
    [['G1', 'O1', 'x', ''], ['G1', 'O1', 'y', '']], [0, 1], true), /Duplicate desired key/);
});

test('upsertTrackerRowsByKey_ grows the sheet and its Table when full, instead of failing (history is never dropped)', () => {
  const project = loadProject(), grown = [];
  project.override('extendTableToSheetEnd_', name => grown.push(name));
  // maxRows 3 with the header on row 2: room for exactly one data row, and it is already used.
  const sheet = trackerSheet([['G0', 'O1', 'old', 'keep me']], 3);
  project.get('upsertTrackerRowsByKey_')(sheet, 4, [['G1', 'O1', 'x', ''], ['G2', 'O1', 'y', '']], [0, 1], true);
  assert.deepEqual(grown, ['2. Outcome Progress']);
  assert.ok(sheet.getMaxRows() >= 100, 'the sheet gained headroom');
  assert.deepEqual([sheet.cell(3, 1), sheet.cell(4, 1), sheet.cell(5, 1)], ['G0', 'G1', 'G2']);
  assert.equal(sheet.cell(3, 4), 'keep me');
});

test('upsertTrackerRowsByKey_ does not grow the table while there is room', () => {
  const project = loadProject(), grown = [];
  project.override('extendTableToSheetEnd_', name => grown.push(name));
  project.get('upsertTrackerRowsByKey_')(trackerSheet([]), 4, [['G1', 'O1', 'x', '']], [0, 1], true);
  assert.deepEqual(grown, []);
});
