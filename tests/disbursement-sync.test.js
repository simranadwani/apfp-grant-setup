'use strict';
// Guards the disbursement push/sync and the Decision Tracker outcome summary against the layout of the
// live templates: the grantee "Disbursement Documents" sheet has an "Upload Folder" column (always showing
// text) between the amount and the link columns, and the Outcome Progress sheet has an "Upload Folder"
// column after every quarter. Columns must be found by header name, never by position.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, FakeSheet, FakeSpreadsheet } = require('./harness');

const RECEIPT = 'https://drive.google.com/file/d/RECEIPT_FILE_ID_1234567890/view';
const LETTER = 'https://drive.google.com/file/d/LETTER_FILE_ID_1234567890/view';
const LIVE_HEADERS = ['Grant ID', 'Disbursement ID', 'Disbursement Date', 'Disbursed Amount',
  'Upload Folder', 'Donation Receipt Link', 'Donation Letter Link'];

// Central "6. Committed & Spent Tracker": header on row 2, data from row 3.
function central(project, rows) {
  const headers = Array.from(project.get('APFP').DISBURSEMENT_HEADERS);
  const data = (rows || []).map(overrides => headers.map(h => (overrides[h] != null ? overrides[h] : '')));
  return new FakeSheet('6. Committed & Spent Tracker', [[], headers, ...data], { maxRows: 400 });
}

// Grantee Disbursement Documents: header on row 4, 100 data rows from row 5.
// `headers` lets a test insert or reorder columns; Upload Folder always displays text.
function grantee(headers, rows) {
  const hdr = headers || LIVE_HEADERS;
  const blank = () => hdr.map(h => (h === 'Upload Folder' ? 'Upload Folder' : ''));
  const grid = [[], [], [], hdr.slice()];
  for (let i = 0; i < 100; i++) {
    const row = blank();
    const values = rows && rows[i];
    if (values) Object.keys(values).forEach(h => { row[hdr.indexOf(h)] = values[h]; });
    grid.push(row);
  }
  return new FakeSheet('Disbursement Documents', grid, { maxRows: 104 });
}

function wire(project, centralSheet, granteeSheet) {
  project.override('disbursementSheet_', () => centralSheet);
  project.override('disbursementWorkbookForGrant_', () => new FakeSpreadsheet([granteeSheet]));
}

const disbursed = (project, id, amount, extra) => Object.assign({
  'Disbursement ID': id, 'Grant ID': 'G1', 'Status': 'Disbursed',
  'Actual Date': project.date(2026, 5, 1), 'Actual Amount': amount
}, extra || {});

// ---------- link sync (grantee -> central) ----------
test('link sync copies Receipt and Letter links, not the Upload Folder text', () => {
  const project = loadProject();
  const c = central(project, [{ 'Disbursement ID': 'DISB-2627-0001', 'Grant ID': 'G1' }]);
  const g = grantee(null, [{ 'Grant ID': 'G1', 'Disbursement ID': 'DISB-2627-0001',
    'Donation Receipt Link': RECEIPT, 'Donation Letter Link': LETTER }]);
  wire(project, c, g);
  assert.equal(project.get('syncGranteeDisbursementLinksToCentral_')(), 1);
  const headers = c.grid[1];
  assert.equal(c.grid[2][headers.indexOf('Donation Receipt Link')], RECEIPT);
  assert.equal(c.grid[2][headers.indexOf('Donation Letter Link')], LETTER);
});

test('link sync still works when columns are added or reordered in the grantee sheet', () => {
  const project = loadProject();
  const c = central(project, [{ 'Disbursement ID': 'DISB-2627-0001', 'Grant ID': 'G1' }]);
  const reordered = ['Notes', 'Grant ID', 'Disbursement ID', 'Donation Letter Link', 'Upload Folder',
    'Disbursement Date', 'Disbursed Amount', 'Donation Receipt Link'];
  const g = grantee(reordered, [{ 'Grant ID': 'G1', 'Disbursement ID': 'DISB-2627-0001',
    'Donation Receipt Link': RECEIPT, 'Donation Letter Link': LETTER }]);
  wire(project, c, g);
  project.get('syncGranteeDisbursementLinksToCentral_')();
  const headers = c.grid[1];
  assert.equal(c.grid[2][headers.indexOf('Donation Receipt Link')], RECEIPT);
  assert.equal(c.grid[2][headers.indexOf('Donation Letter Link')], LETTER);
});

test('link sync does not blank a central link when the grantee cell is empty', () => {
  const project = loadProject();
  const c = central(project, [{ 'Disbursement ID': 'DISB-2627-0001', 'Grant ID': 'G1', 'Donation Receipt Link': RECEIPT }]);
  const g = grantee(null, [{ 'Grant ID': 'G1', 'Disbursement ID': 'DISB-2627-0001' }]);
  wire(project, c, g);
  assert.equal(project.get('syncGranteeDisbursementLinksToCentral_')(), 0);
  assert.equal(c.grid[2][c.grid[1].indexOf('Donation Receipt Link')], RECEIPT);
});

test('link sync reports a clear error if a required grantee column is missing', () => {
  const project = loadProject();
  const c = central(project, [{ 'Disbursement ID': 'DISB-2627-0001', 'Grant ID': 'G1' }]);
  wire(project, c, grantee(['Grant ID', 'Disbursement ID', 'Upload Folder']));
  assert.throws(() => project.get('syncGranteeDisbursementLinksToCentral_')(),
    /missing the column "Donation Receipt Link"/);
});

// ---------- push (central -> grantee) ----------
test('push writes only the four system columns and never the Upload Folder column', () => {
  const project = loadProject();
  const c = central(project, [disbursed(project, 'DISB-2627-0001', 500000)]);
  const g = grantee();
  wire(project, c, g);
  assert.equal(project.get('syncDisbursementsToGranteeWorkbooks_')(), 1);
  assert.deepEqual(g.writes.map(w => w.col).sort(), [1, 2, 3, 4]);
  assert.equal(g.cell(5, 1), 'G1');
  assert.equal(g.cell(5, 2), 'DISB-2627-0001');
  assert.equal(g.cell(5, 4), 500000);
  assert.equal(g.cell(5, 5), 'Upload Folder');
  assert.equal(g.cell(5, 6), '');
});

test('push finds a free row although every Upload Folder cell shows text, and is idempotent', () => {
  const project = loadProject();
  const c = central(project, [disbursed(project, 'DISB-2627-0001', 500000), disbursed(project, 'DISB-2627-0002', 250000)]);
  const g = grantee();
  wire(project, c, g);
  assert.equal(project.get('syncDisbursementsToGranteeWorkbooks_')(), 2);
  assert.equal(g.cell(6, 2), 'DISB-2627-0002');
  const writesAfterFirstRun = g.writes.length;
  assert.equal(project.get('syncDisbursementsToGranteeWorkbooks_')(), 0);
  assert.equal(g.writes.length, writesAfterFirstRun, 'a second push must not write anything');
});

test('push updates an existing disbursement in place and keeps the grantee links', () => {
  const project = loadProject();
  const c = central(project, [disbursed(project, 'DISB-2627-0001', 600000)]);
  const g = grantee(null, [{ 'Grant ID': 'G1', 'Disbursement ID': 'DISB-2627-0001',
    'Disbursement Date': project.date(2026, 5, 1), 'Disbursed Amount': 500000,
    'Donation Receipt Link': RECEIPT, 'Donation Letter Link': LETTER }]);
  wire(project, c, g);
  assert.equal(project.get('syncDisbursementsToGranteeWorkbooks_')(), 1);
  assert.equal(g.cell(5, 4), 600000);
  assert.equal(g.cell(5, 6), RECEIPT);
  assert.equal(g.cell(5, 7), LETTER);
  assert.equal(g.writes.length, 1, 'only the changed amount cell is written');
});

test('push works when columns are added or reordered in the grantee sheet', () => {
  const project = loadProject();
  const c = central(project, [disbursed(project, 'DISB-2627-0001', 500000)]);
  const reordered = ['Notes', 'Upload Folder', 'Disbursed Amount', 'Grant ID', 'Disbursement Date',
    'Disbursement ID', 'Donation Receipt Link', 'Donation Letter Link'];
  const g = grantee(reordered);
  wire(project, c, g);
  project.get('syncDisbursementsToGranteeWorkbooks_')();
  assert.equal(g.cell(5, reordered.indexOf('Grant ID') + 1), 'G1');
  assert.equal(g.cell(5, reordered.indexOf('Disbursement ID') + 1), 'DISB-2627-0001');
  assert.equal(g.cell(5, reordered.indexOf('Disbursed Amount') + 1), 500000);
  assert.equal(g.cell(5, reordered.indexOf('Upload Folder') + 1), 'Upload Folder');
});

test('push refuses to drop disbursements when the grantee sheet is full', () => {
  const project = loadProject();
  const many = Array.from({ length: 101 }, (_, i) => disbursed(project, `DISB-2627-${String(i + 1).padStart(4, '0')}`, 1000));
  wire(project, central(project, many), grantee());
  assert.throws(() => project.get('syncDisbursementsToGranteeWorkbooks_')(), /holds 100 rows; 101 disbursements need a row/);
});

// ---------- Decision Tracker outcome summary ----------
const OUTCOME_HEADERS = ['Grant ID', 'Grant Title', 'Outcome ID', 'Outcome / Indicator', 'End-of-Program Cycle Target',
  'Q1 Progress', 'Upload Folder', 'Q1 Evidence Link', 'Q1 Support Type', 'Q1 Support Required',
  'Q2 Progress', 'Upload Folder', 'Q2 Evidence Link', 'Q2 Support Type', 'Q2 Support Required',
  'Q3 Progress', 'Upload Folder', 'Q3 Evidence Link', 'Q3 Support Type', 'Q3 Support Required',
  'Q4 Progress', 'Upload Folder', 'Q4 Evidence Link', 'Q4 Support Type', 'Q4 Support Required', 'Final Actual'];

function outcomeSummary(rows, headers) {
  const project = loadProject();
  const hdr = headers || OUTCOME_HEADERS;
  const grid = [[], [], [], hdr.slice()];
  rows.forEach(values => grid.push(hdr.map(h => (h === 'Upload Folder' ? 'Upload Folder' : (values[h] || '')))));
  const sheet = new FakeSheet('Outcome Progress', grid, { maxRows: 14 });
  project.override('outcomeProgressWorkbookForGrant_', () => new FakeSpreadsheet([sheet]));
  return project.get('outcomeSummaryForGrant_')({ 'Grant ID': 'G1', 'Grant Type': 'Restricted' });
}

test('outcome summary reports the latest quarterly progress, not an Upload Folder cell', () => {
  assert.equal(outcomeSummary([{ 'Outcome ID': 'O1', 'Outcome / Indicator': 'Indicator A',
    'Q1 Progress': 'Q1 text', 'Q2 Progress': 'Q2 text' }]), 'Indicator A — Q2 text');
});

test('outcome summary prefers Final Actual, then the latest quarter, and handles no progress', () => {
  const rows = [
    { 'Outcome ID': 'O1', 'Outcome / Indicator': 'A', 'Q4 Progress': 'Q4 text', 'Final Actual': '95%' },
    { 'Outcome ID': 'O2', 'Outcome / Indicator': 'B' },
    { 'Outcome ID': '', 'Outcome / Indicator': 'ignored (no Outcome ID)' }
  ];
  assert.equal(outcomeSummary(rows), 'A — 95%\nB — No progress reported yet');
});

test('outcome summary is unaffected by columns added or reordered', () => {
  const headers = ['Notes', ...OUTCOME_HEADERS.slice().reverse()];
  assert.equal(outcomeSummary([{ 'Outcome ID': 'O1', 'Outcome / Indicator': 'Indicator A', 'Q3 Progress': 'Q3 text' }], headers),
    'Indicator A — Q3 text');
});
