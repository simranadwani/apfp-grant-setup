'use strict';
// Outcome IDs must stay attached to their indicator (and to the row where the grantee types quarterly progress),
// even if the Setup lists the indicators in a different order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain, FakeSheet } = require('./harness');

const p = loadProject();
const rows = (...items) => Array.from({ length: 10 }, (_, i) => items[i] || { id: '', indicator: '' });
const plan = (existing, indicators) => plain(p.get('planOutcomeRows_')(existing, indicators));

test('reordered indicators keep their rows and IDs', () => {
  const existing = rows({ id: 'OUT-G1-01', indicator: 'A' }, { id: 'OUT-G1-02', indicator: 'B' });
  const claimed = plan(existing, ['B', 'A']);
  assert.equal(claimed[0], 1, 'row 0 (A) is now setup item 1');
  assert.equal(claimed[1], 0, 'row 1 (B) is now setup item 0');
});

test('matching ignores case and extra spaces', () => {
  const existing = rows({ id: 'OUT-G1-01', indicator: 'Reach  100 kids' });
  assert.equal(plan(existing, ['reach 100 KIDS'])[0], 0);
});

test('a new indicator takes a never-used row', () => {
  const existing = rows({ id: 'OUT-G1-01', indicator: 'A' }, { id: 'OUT-G1-02', indicator: 'B' });
  const claimed = plan(existing, ['A', 'B', 'C']);
  assert.equal(claimed[2], 2);
});

test('an edited indicator at the same position keeps its row and ID', () => {
  const existing = rows({ id: 'OUT-G1-01', indicator: 'Reach 100 kids' }, { id: 'OUT-G1-02', indicator: 'B' });
  const claimed = plan(existing, ['Reach 120 kids', 'B']);
  assert.equal(claimed[0], 0);
  assert.equal(claimed[1], 1);
});

test('retired outcomes keep their row and ID and are never reused for a new indicator', () => {
  const existing = rows({ id: 'OUT-G1-01', indicator: 'A' }, { id: 'OUT-G1-02', indicator: '' });
  const claimed = plan(existing, ['A', 'New']);
  assert.equal(claimed[1], -1, 'the retired row stays unclaimed');
  assert.equal(claimed[2], 1, 'the new indicator uses a fresh row');
});

test('a removed indicator leaves its row unclaimed', () => {
  const existing = rows({ id: 'OUT-G1-01', indicator: 'A' }, { id: 'OUT-G1-02', indicator: 'B' });
  assert.deepEqual(plan(existing, ['A']).slice(0, 2), [0, -1]);
});

test('no free row gives a clear error instead of reusing history', () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ id: `OUT-G1-${String(i + 1).padStart(2, '0')}`, indicator: i === 9 ? '' : `I${i}` }));
  assert.throws(() => p.get('planOutcomeRows_')(full, [...full.slice(0, 9).map(r => r.indicator), 'Brand new']), /no free row for the indicator "Brand new"/);
});

// ---- writing the system columns of a real-looking Outcome Progress sheet ----
const HEADERS = ['Grant ID', 'Grant Title', 'Outcome ID', 'Outcome / Indicator', 'End-of-Program Cycle Target',
  'Q1 Progress', 'Upload Folder', 'Q1 Evidence Link', 'Q1 Support Type', 'Q1 Support Required'];

function outcomeSheet(existing) {
  const grid = [[], [], [], HEADERS.slice()];
  for (let i = 0; i < 10; i++) {
    const e = existing[i] || {};
    grid.push(['G1', 'Old title', e.id || '', e.indicator || '', e.target || '', e.progress || '', 'Upload Folder', '', '', '']);
  }
  return new FakeSheet('Outcome Progress', grid, { maxRows: 14 });
}
function tableFor(sheet) {
  const columns = p.get('columnsByHeader_')(sheet, 4, 'Outcome Progress for Grant ID G1');
  return { sheet, width: columns.width, col: columns.col, firstRow: 5, rows: 10 };
}

test('reordering in the Setup does not move progress: IDs stay on their rows, progress and Upload Folder are untouched', () => {
  const sheet = outcomeSheet([
    { id: 'OUT-G1-01', indicator: 'A', target: '10', progress: 'A progress' },
    { id: 'OUT-G1-02', indicator: 'B', target: '20', progress: 'B progress' }]);
  const count = p.get('writeOutcomeSystemColumns_')(tableFor(sheet), 'G1', 'New title', ['B', 'A', 'C'], ['21', '11', '30']);
  assert.equal(count, 3);
  assert.equal(sheet.cell(5, 3), 'OUT-G1-01');
  assert.equal(sheet.cell(5, 4), 'A');
  assert.equal(sheet.cell(5, 5), '11', 'A gets its own new target');
  assert.equal(sheet.cell(5, 6), 'A progress');
  assert.equal(sheet.cell(6, 3), 'OUT-G1-02');
  assert.equal(sheet.cell(6, 4), 'B');
  assert.equal(sheet.cell(7, 3), 'OUT-G1-03', 'a brand new indicator gets the next free ID');
  assert.equal(sheet.cell(5, 2), 'New title');
  assert.ok(sheet.writes.every(w => w.col !== 7), 'the Upload Folder column is never written');
});

test('removing an indicator clears its text but keeps the Outcome ID and its progress', () => {
  const sheet = outcomeSheet([{ id: 'OUT-G1-01', indicator: 'A', target: '10', progress: 'kept' }, { id: 'OUT-G1-02', indicator: 'B', target: '20' }]);
  const count = p.get('writeOutcomeSystemColumns_')(tableFor(sheet), 'G1', 'Old title', ['B'], ['20']);
  assert.equal(count, 1);
  assert.equal(sheet.cell(5, 3), 'OUT-G1-01');
  assert.equal(sheet.cell(5, 4), '');
  assert.equal(sheet.cell(5, 6), 'kept');
  assert.equal(sheet.cell(6, 4), 'B');
});

test('running the same approval twice writes nothing the second time', () => {
  const sheet = outcomeSheet([{ id: 'OUT-G1-01', indicator: 'A', target: '10' }]);
  p.get('writeOutcomeSystemColumns_')(tableFor(sheet), 'G1', 'Old title', ['A', 'B'], ['10', '20']);
  const writes = sheet.writes.length;
  p.get('writeOutcomeSystemColumns_')(tableFor(sheet), 'G1', 'Old title', ['A', 'B'], ['10', '20']);
  assert.equal(sheet.writes.length, writes);
});

test('a duplicate Outcome ID in the sheet is reported', () => {
  const sheet = outcomeSheet([{ id: 'OUT-G1-01', indicator: 'A' }, { id: 'OUT-G1-01', indicator: 'B' }]);
  assert.throws(() => p.get('writeOutcomeSystemColumns_')(tableFor(sheet), 'G1', 'T', ['A'], ['1']), /Duplicate Outcome ID OUT-G1-01/);
});
