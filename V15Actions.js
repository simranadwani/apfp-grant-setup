// V15Actions.gs — thin, sheet-aware UI actions and dependent disbursement choices.
function v15SelectedDataRow_(sheetName, headerRow) {
  const sheet = ss_().getActiveSheet();
  const range = sheet && sheet.getActiveRange();
  if (!sheet || sheet.getName() !== sheetName || !range || range.getRow() <= headerRow) {
    throw new Error(`Select one data row in ${sheetName}, then run the action again.`);
  }
  if (range.getNumRows() !== 1) throw new Error('Select only one data row.');
  return { sheet: sheet, rowNumber: range.getRow() };
}
function v15Notify_(message) {
  SpreadsheetApp.getActive().toast(message, 'APFP V15', 6);
}
function v15RunWorkspaceAction_(action) {
  const selected = v15SelectedDataRow_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW);
  selected.sheet.getRange(selected.rowNumber, APFP.INTAKE.ACTION_COLUMN).setValue(action);
  processRequestedActions();
}
function uiCreateWorkspace() { v15RunWorkspaceAction_('Create Workspace'); }
function uiRetryOrReshareWorkspace() {
  const selected = v15SelectedDataRow_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW);
  const row = rowObject_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, selected.rowNumber);
  const status = key_(row['Workspace Status']);
  const action = ['completed', 'sharing pending', 'workspace created'].includes(status)
    ? 'Retry Sharing' : 'Retry Workspace';
  if (action === 'Retry Workspace') {
    selected.sheet.getRange(selected.rowNumber, APFP.INTAKE.ACTION_COLUMN).setValue(action);
    processRequestedActions();
    return;
  }
  const requestId = clean_(row['Request ID']), grantId = clean_(row['Grant ID']);
  if (!requestId || !grantId) throw new Error('The selected row has no Request ID or Grant ID.');
  const tech = techByRequest_(requestId);
  if (!tech || key_(tech.record['Grant ID']) !== key_(grantId))
    throw new Error('The selected row is not linked to one unambiguous Grant-FY record.');
  const template = HtmlService.createTemplateFromFile('RetryReshareDialog');
  template.context = {
    rowNumber: selected.rowNumber,
    requestId,
    grantId,
    organisationName: clean_(row['Organisation Name']),
    financialYear: clean_(row['Financial Year']),
    currentEmail: clean_(tech.record['Primary Contact Email'])
  };
  SpreadsheetApp.getUi().showModalDialog(
    template.evaluate().setWidth(470).setHeight(430),
    'Retry / Reshare Grant-FY workspace'
  );
}
function submitRetryReshareGrantFy(payload) {
 const lock = LockService.getScriptLock();
 if (!lock.tryLock(30000)) throw new Error('Another APFP automation run is active. Try again shortly.');
 try {
   const rowNumber = Number(payload && payload.rowNumber);
   const object = rowObject_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, rowNumber);
   if (clean_(object['Request ID']) !== clean_(payload.requestId) ||
       clean_(object['Grant ID']) !== clean_(payload.grantId))
     throw new Error('The selected row changed while the dialog was open. Close it and try again.');
   const row = intakeRowsWithActions_().find(item => item.rowNumber === rowNumber) || {
     rowNumber,
     requestId: clean_(object['Request ID']), grantId: clean_(object['Grant ID']),
     granteeEmail: clean_(object['Primary Contact Email'])
   };
   const tech = techByRequest_(row.requestId);
   if (!tech || key_(tech.record['Grant ID']) !== key_(row.grantId))
     throw new Error('The selected Grant-FY record could not be verified.');
   const mode = key_(payload && payload.mode);
   const email = mode === 'change' ? clean_(payload.newEmail) : clean_(tech.record['Primary Contact Email']);
   const ok = mode === 'change'
     ? transferGrantFyPrimaryEmail_(row, email, config_())
     : retrySharingForIntakeRow_(row, config_(), { email });
   if (!ok) throw new Error('Retry/reshare needs attention. Review the selected row and try again.');
   return `Grant-FY ${row.grantId} was shared successfully with ${email}.`;
 } finally {
   lock.releaseLock();
 }
}
function uiLockAndMigrateApprovedSetups() {
  updateApprovedSetupData();
}
function uiReopenSetupForChanges() {
  reopenSelectedSetup();
}
// Backward-compatible aliases for any drawings assigned before V15.
function uiRetryWorkspace() { v15RunWorkspaceAction_('Retry Workspace'); }
function uiReshareWorkspace() { v15RunWorkspaceAction_('Retry Sharing'); }
function uiRefreshOutcomeProgress() {
  const count = refreshOutcomeProgressTracker_();
  recordAutomationStatus_('Outcome Progress', 'Success', `${count} rows refreshed`);
  v15Notify_(`${count} outcome rows refreshed.`);
  return count;
}
function uiRefreshSupport() {
  const count = refreshSupportTracker_();
  recordAutomationStatus_('Support', 'Success', `${count} rows refreshed`);
  v15Notify_(`${count} support rows refreshed.`);
  return count;
}
function uiCompleteSelectedSupport() {
  throw new Error('Support closure is manual in V15. Update Status directly in 3. Support.');
}
function uiRefreshDecisions() {
  const count = refreshDecisionTracker_();
  recordAutomationStatus_('Decisions', 'Success', `${count} rows refreshed`);
  v15Notify_(`${count} decision rows refreshed.`);
  return count;
}
function uiRefreshDecisionDocuments() {
  const count = refreshDecisionDocumentLinks_();
  recordAutomationStatus_('Decision Documents', 'Success', `${count} rows refreshed`);
  v15Notify_(`${count} Decision Tracker row(s) refreshed with Annual Report, Fund Utilisation and 10BE links.`);
  return count;
}
function uiPushGrantStatus() {
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DECISIONS;
  const selected = v15SelectedDataRow_(APFP.SHEETS.DECISIONS, headerRow);
  const row = rowObject_(APFP.SHEETS.DECISIONS, headerRow, selected.rowNumber);
  const grantId = clean_(row['Grant ID']);
  if (!grantId) throw new Error('The selected Decision Tracker row has no Grant ID.');
  if (!clean_(row['Decision Type']) || !clean_(row['Decision Status']))
    throw new Error('Complete both Decision Type and Decision Status before pushing Grant Status.');
  updateGrantStatus_(grantId, 'Complete');
  findRows_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, 'Grant ID', grantId).forEach(rowNumber =>
    setByHeaders_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, rowNumber, {
      'Grant Status': 'Complete', 'Last Updated': now_()
    }));
  refreshWorkspaceCreatorRow_(grantId);
  v15Notify_(`Grant ${grantId} marked Complete in Workspace Creator and Grant Registry.`);
}
function v15DisbursementOrganisationsForFy_(fy) {
  const wanted = key_(disbCanonicalFy_(fy));
  if (!wanted) return [];
  const seen = {};
  return availableDisbursementGrantRecords_()
    .filter(record => key_(disbCanonicalFy_(record['Financial Year'])) === wanted)
    .map(record => clean_(record['Organisation Name']))
    .filter(name => name && !seen[key_(name)] && (seen[key_(name)] = true))
    .sort((a, b) => a.localeCompare(b));
}
function refreshDisbursementOrganisationOptionsForRow_(sheet, rowNumber, map) {
  const fy = sheet.getRange(rowNumber, disbColumn_(map, 'Financial Year')).getDisplayValue();
  const organisationCell = sheet.getRange(rowNumber, disbColumn_(map, 'Organisation Name'));
  const options = v15DisbursementOrganisationsForFy_(fy);
  organisationCell.clearNote();
  if (!options.length) {
    organisationCell.clearDataValidations();
    return 0;
  }
  const current = clean_(organisationCell.getValue());
  organisationCell.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(true).build()
  );
  if (current && !options.some(value => key_(value) === key_(current))) organisationCell.clearContent();
  return options.length;
}
function refreshDisbursementOrganisationOptions_() {
  const sheet = disbTracker_();
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DISBURSEMENTS;
  const map = disbHeaderMap_(sheet);
  const lastRow = Math.max(headerRow + 1, sheet.getLastRow());
  let updated = 0;
  for (let row = headerRow + 1; row <= lastRow; row++) {
    const fy = clean_(sheet.getRange(row, disbColumn_(map, 'Financial Year')).getValue());
    if (!fy) continue;
    refreshDisbursementOrganisationOptionsForRow_(sheet, row, map);
    updated++;
  }
  return updated;
}
function uiRefreshDisbursementOptions() {
  const count = refreshDisbursementOrganisationOptions_();
  v15Notify_(`Organisation dropdowns refreshed for ${count} disbursement rows.`);
  return count;
}
function uiPushDisbursements() {
  completeDisbursementRows_();
  const count = syncDisbursementsToGranteeWorkbooks_();
  recordAutomationStatus_('Disbursement Push', 'Success', `${count} rows pushed`);
  v15Notify_(`${count} disbursement rows pushed to grantee workbooks.`);
  return count;
}
function uiSyncDisbursements() {
  const links = syncGranteeDisbursementLinksToCentral_();
  recordAutomationStatus_('Disbursement Sync', 'Success', `${links} links synced`);
  v15Notify_(`${links} grantee document links synced.`);
  return links;
}
function uiCorrectWorkspaceDetails() {
  const selected = v15SelectedDataRow_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW);
  const result = correctWorkspaceDetailsForRow_(selected.rowNumber);
  v15Notify_(
    `Workspace details corrected for ${result.grantId}. No IDs, folders, sharing permissions or historical rows were changed.`
  );
  return result;
}