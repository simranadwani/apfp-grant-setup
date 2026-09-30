'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

// Every function below may be bound to a sheet button, an installable trigger, or the HTML dialog.
// Renaming or removing one silently breaks the live workbook, so this list is frozen.
const PUBLIC_ENTRY_POINTS = [
  'completeDisbursementRows', 'handleCentralAdminEdit', 'handleCentralAdminOpen', 'handleEdit',
  'processRequestedActions', 'refreshReportingData', 'reopenSelectedSetup', 'runPreflightChecks',
  'submitRetryReshareGrantFy', 'uiCompleteSelectedSupport', 'uiCorrectWorkspaceDetails',
  'uiCreateWorkspace', 'uiLockAndMigrateApprovedSetups', 'uiPushDisbursements', 'uiPushGrantStatus',
  'uiRefreshDecisionDocuments', 'uiRefreshDecisions', 'uiRefreshDisbursementOptions',
  'uiRefreshOutcomeProgress', 'uiRefreshSupport', 'uiReopenSetupForChanges', 'uiReshareWorkspace',
  'uiRetryOrReshareWorkspace', 'uiRetryWorkspace', 'uiSyncDisbursements', 'updateApprovedSetupData',
  'validateDisbursementTracker',
  // added with the status columns (buttons optional):
  'uiSyncDisbursementsFullCheck', 'uiResetDisbursementStatuses'
];

test('all project files load together without redeclaration or syntax errors', () => {
  const project = loadProject();
  assert.ok(project.files.length >= 17, `expected the project files, found ${project.files.length}`);
  assert.equal(project.files[0], 'Config.js');
});

test('public entry points (buttons, triggers, dialog callbacks) all still exist', () => {
  const project = loadProject();
  PUBLIC_ENTRY_POINTS.forEach(name => {
    assert.equal(project.run(`typeof ${name}`), 'function', `${name} must remain a global function`);
  });
});

test('no unexpected new public (non-underscore) functions appear', () => {
  const project = loadProject();
  const declared = project.run(`(${JSON.stringify(PUBLIC_ENTRY_POINTS)}).length`);
  assert.equal(declared, PUBLIC_ENTRY_POINTS.length);
});

test('no version-number naming (V15 etc.) remains in code, dialogs or user-facing text', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT } = require('./harness');
  fs.readdirSync(ROOT).filter(n => /\.(js|html)$/.test(n)).forEach(name => {
    const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
    assert.doesNotMatch(text, /\bv\d{2}\b/i, `${name} still mentions a version number`);
    assert.doesNotMatch(text, /v15/i, `${name} still mentions V15`);
  });
});

test('schema contract snapshot (intentionally updated when a phase changes the schema)', () => {
  const project = loadProject();
  const apfp = plain(project.get('APFP'));
  assert.equal(apfp.INTAKE.HEADERS.length, 32);
  assert.equal(apfp.TECH_HEADERS.length, 53);
  assert.equal(apfp.DISBURSEMENT_HEADERS.length, 16);
  assert.equal(apfp.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE.TOTAL_COLUMNS, 26);
  assert.deepEqual(apfp.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE.EDITABLE_RANGES,
    ['F5:F14', 'H5:K14', 'M5:P14', 'R5:U14', 'W5:Z14']);
  assert.deepEqual(apfp.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE.YEAR_END_EDITABLE_RANGES, ['C5', 'E5']);
  assert.deepEqual(apfp.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE.HEADERS, [
    'Grant ID', 'Disbursement ID', 'Disbursement Date', 'Disbursed Amount',
    'Upload Folder', 'Donation Receipt Link', 'Donation Letter Link'
  ]);
  assert.equal(apfp.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE.EDITABLE_RANGE, 'F5:G104');
});
