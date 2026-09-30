'use strict';
// Each test here documents a code ↔ template mismatch found in the review (see CHANGELOG / plan).
// They are marked `todo`: they FAIL today and are reported as TODO, not as suite failures.
// When the fix lands, remove the `todo` flag so the test guards the behaviour permanently.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, FakeSheet, FakeSpreadsheet } = require('./harness');

const RECEIPT = 'https://drive.google.com/file/d/RECEIPT_FILE_ID_1234567890/view';
const LETTER = 'https://drive.google.com/file/d/LETTER_FILE_ID_1234567890/view';

function centralDisbursementSheet(project, overrides) {
  const headers = Array.from(project.get('APFP').DISBURSEMENT_HEADERS);
  const row = headers.map(h => (overrides && overrides[h] != null ? overrides[h] : ''));
  return new FakeSheet('6. Committed & Spent Tracker', [[], headers, row], { maxRows: 50 });
}

// Live Disbursement Documents layout: A Grant ID | B Disbursement ID | C Date | D Amount |
// E Upload Folder (always displays "Upload Folder") | F Receipt Link | G Letter Link. Header on row 4.
function granteeDisbursementSheet(withLinks) {
  const grid = [[], [], [], ['Grant ID', 'Disbursement ID', 'Disbursement Date', 'Disbursed Amount',
    'Upload Folder', 'Donation Receipt Link', 'Donation Letter Link']];
  for (let i = 0; i < 100; i++) grid.push(['', '', '', '', 'Upload Folder', '', '']);
  if (withLinks) grid[4] = ['G1', 'DISB-2627-0001', '', 500000, 'Upload Folder', RECEIPT, LETTER];
  return new FakeSheet('Disbursement Documents', grid, { maxRows: 104 });
}

test('Disbursement link sync copies Receipt and Letter links (not the Upload Folder column)',
  { todo: 'reads row[4]/row[5]; template is E=Upload Folder, F=Receipt, G=Letter' }, () => {
    const project = loadProject();
    const central = centralDisbursementSheet(project, { 'Disbursement ID': 'DISB-2627-0001', 'Grant ID': 'G1' });
    const grantee = granteeDisbursementSheet(true);
    project.override('disbursementSheet_', () => central);
    project.override('disbursementWorkbookForGrant_', () => new FakeSpreadsheet([grantee]));
    project.get('syncGranteeDisbursementLinksToCentral_')();
    const headers = central.grid[1];
    assert.equal(central.grid[2][headers.indexOf('Donation Receipt Link')], RECEIPT);
    assert.equal(central.grid[2][headers.indexOf('Donation Letter Link')], LETTER);
  });

test('Disbursement push never writes into the Upload Folder column',
  { todo: 'writes columns A–F including old[4], replacing the Upload Folder formula with plain text' }, () => {
    const project = loadProject();
    const central = centralDisbursementSheet(project, {
      'Disbursement ID': 'DISB-2627-0001', 'Grant ID': 'G1', 'Status': 'Disbursed',
      'Actual Date': project.date(2026, 5, 1), 'Actual Amount': 500000
    });
    const grantee = granteeDisbursementSheet(false);
    project.override('disbursementSheet_', () => central);
    project.override('disbursementWorkbookForGrant_', () => new FakeSpreadsheet([grantee]));
    project.get('syncDisbursementsToGranteeWorkbooks_')();
    const touchesUploadFolder = grantee.writes.some(w => w.col <= 5 && w.col + w.cols - 1 >= 5);
    assert.equal(touchesUploadFolder, false, 'column E (Upload Folder) must not be overwritten');
  });

test('Disbursement push finds an empty row even though every Upload Folder cell shows text',
  { todo: 'empty-row detection treats the always-visible "Upload Folder" text as data' }, () => {
    const project = loadProject();
    const central = centralDisbursementSheet(project, {
      'Disbursement ID': 'DISB-2627-0001', 'Grant ID': 'G1', 'Status': 'Disbursed',
      'Actual Date': project.date(2026, 5, 1), 'Actual Amount': 500000
    });
    const grantee = granteeDisbursementSheet(false);
    project.override('disbursementSheet_', () => central);
    project.override('disbursementWorkbookForGrant_', () => new FakeSpreadsheet([grantee]));
    assert.doesNotThrow(() => project.get('syncDisbursementsToGranteeWorkbooks_')());
    assert.equal(grantee.cell(5, 2), 'DISB-2627-0001');
  });

test('Decision Tracker outcome summary reports the latest quarterly progress, not an Upload Folder cell',
  { todo: 'uses column indices 21/17/13/9/5 from the old 17-column layout' }, () => {
    const project = loadProject();
    // 26 columns: A..E system, then per quarter: Progress, Upload Folder, Evidence, Support Type, Support Required.
    const row = ['G1', 'Title', 'OUT-G1-01', 'Indicator A', '100',
      'Q1 progress text', 'Upload Folder', '', '', '',
      'Q2 progress text', 'Upload Folder', '', '', '',
      '', 'Upload Folder', '', '', '',
      '', 'Upload Folder', '', '', '', ''];
    assert.equal(row.length, 26);
    const grid = [[], [], [], [], row];
    const outcomeSheet = new FakeSheet('Outcome Progress', grid, { maxRows: 14 });
    project.override('outcomeProgressWorkbookForGrant_', () => new FakeSpreadsheet([outcomeSheet]));
    const summary = project.get('outcomeSummaryForGrant_')({ 'Grant ID': 'G1', 'Grant Type': 'Restricted' });
    assert.equal(summary, 'Indicator A — Q2 progress text');
  });
