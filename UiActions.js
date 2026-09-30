// UiActions.gs — thin, sheet-aware UI actions (button entry points) and dependent disbursement choices.
function selectedDataRow_(sheetName, headerRow) {
  const sheet = ss_().getActiveSheet();
  const range = sheet && sheet.getActiveRange();
  if (!sheet || sheet.getName() !== sheetName || !range || range.getRow() <= headerRow) {
    throw new Error(`Select one data row in ${sheetName}, then run the action again.`);
  }
  if (range.getNumRows() !== 1) throw new Error('Select only one data row.');
  return { sheet: sheet, rowNumber: range.getRow() };
}
function showToast_(message) {
  const timing = slowestStepsSummary_(3);
  SpreadsheetApp.getActive().toast(timing ? `${message} ${timing}` : message, 'APFP', timing ? 15 : 6);
}
// Workspace buttons never write an Action. They run the rows a person (or the system, after a failure) has already marked.
// Retry / Reshare additionally opens its dialog for the selected row when that row already has a workspace.
function uiCreateWorkspace() { processRequestedActions(); }
function uiRetryWorkspace() { processRequestedActions(); }
function uiReshareWorkspace() { processRequestedActions(); }
function uiRetryOrReshareWorkspace() {
  let selected = null;
  try { selected = selectedDataRow_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW); } catch (error) { selected = null; }
  const row = selected ? rowObject_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, selected.rowNumber) : null;
  const requestId = row ? clean_(row['Request ID']) : '', grantId = row ? clean_(row['Grant ID']) : '';
  const tech = requestId ? techByRequest_(requestId) : null;
  // The Technical Registry status decides (the Workspace Status shown on the row is display text and differs for Transactional).
  const shareable = !!tech && ['completed', 'sharing pending', 'workspace created', 'disbursement only']
    .includes(key_(tech.record['Workspace Status']));
  if (!row || !shareable || APFP.INTAKE.PROCESS_ACTIONS.includes(clean_(row['Action']))) {
    processRequestedActions();
    return;
  }
  if (!grantId) throw new Error('The selected row has no Request ID or Grant ID.');
  if (key_(tech.record['Grant ID']) !== key_(grantId))
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
// Pushes the current LIST_* settings (System - Configuration) into the dropdowns of the native Tables. Run after editing a list.
function refreshDropdownsFromConfig() {
  requireAdvancedSheetsService_();
  const plan = dropdownUpdateRequests_(adminTablesSnapshot_(), APFP.ADMIN_TABLES);
  if (plan.requests.length) Sheets.Spreadsheets.batchUpdate({ requests: plan.requests }, ss_().getId());
  showToast_(plan.changed.length ? `Dropdowns updated: ${plan.changed.join('; ')}` : 'All dropdowns already match System - Configuration.');
  return plan.changed;
}
// One-time helper: adds the list / time-zone / financial-year settings to System - Configuration with today's values (never overwrites an existing row).
function seedListsFromDefaults() {
  const sheet = sheet_(APFP.SHEETS.CONFIG), last = sheet.getLastRow(),
    existing = new Set(last >= 3 ? sheet.getRange(3, 1, last - 2, 1).getValues().map(row => key_(row[0])) : []),
    wanted = [['FIRST_FY', '2026-27'], ['FY_YEARS_AHEAD', '3'], ['TIME_ZONE', APFP.TIME_ZONE]]
      .concat(listNames_().filter(name => name !== 'FINANCIAL_YEARS').map(name => [`LIST_${name}`, APFP.LIST_DEFAULTS[name].join('|')]))
      .filter(([name]) => !existing.has(key_(name)));
  if (!wanted.length) { showToast_('System - Configuration already has every list setting.'); return []; }
  const start = Math.max(3, last + 1), end = start + wanted.length - 1;
  if (end > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), end - sheet.getMaxRows());
  sheet.getRange(start, 1, wanted.length, 2).setValues(wanted);
  // Fill the descriptive columns by header name so a moved column still gets the right values.
  const headers = sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), 6)).getDisplayValues()[0].map(clean_);
  const fill = (name, value) => {
    const col = headers.findIndex(h => key_(h) === key_(name)) + 1;
    if (col > 0) sheet.getRange(start, col, wanted.length, 1).setValues(wanted.map(() => [typeof value === 'function' ? value() : value]));
  };
  fill('Active', 'Yes');
  fill('Editable', 'Yes');
  fill('Value Type', 'Text');
  fill('Description', 'Dropdown / setting seeded from defaults; edit the value and run refreshDropdownsFromConfig.');
  fill('Last Updated', () => now_());
  fill('Last Updated By', () => actorEmail_());
  CONFIG_CACHE_ = null;
  showToast_(`Added ${wanted.length} setting(s) to System - Configuration: ${wanted.map(item => item[0]).join(', ')}. Run "refreshDropdownsFromConfig" next if a list changed.`);
  return wanted.map(item => item[0]);
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
// Backward-compatible aliases: keep until the sheet buttons are confirmed not to use them.
function uiRefreshOutcomeProgress() {
  const count = refreshOutcomeProgressTracker_();
  recordAutomationStatus_('Outcome Progress', 'Success', `${count} rows refreshed`);
  showToast_(`${count} outcome rows refreshed.${refreshNote_()}`);
  return count;
}
function uiRefreshSupport() {
  const count = refreshSupportTracker_();
  recordAutomationStatus_('Support', 'Success', `${count} rows refreshed`);
  showToast_(`${count} support rows refreshed.${refreshNote_()}`);
  return count;
}
// Reads every Active workbook again (forgets which ones were unchanged) — use after fixing a workbook by hand or restoring central rows.
function uiRefreshReportingForce() {
  forgetReadMarks_();
  const outcomes = refreshOutcomeProgressTracker_(), support = refreshSupportTracker_(), decisions = refreshDecisionTracker_();
  showToast_(`Full re-read done: ${outcomes} outcome, ${support} support, ${decisions} decision row(s).${refreshNote_()}`);
  return { outcomes, support, decisions };
}
function uiCompleteSelectedSupport() {
  throw new Error('Support closure is manual. Update Status directly in 3. Support.');
}
function uiRefreshDecisions() {
  const count = refreshDecisionTracker_();
  recordAutomationStatus_('Decisions', 'Success', `${count} rows refreshed`);
  showToast_(`${count} decision rows refreshed.${refreshNote_()}`);
  return count;
}
function uiRefreshDecisionDocuments() {
  const count = refreshDecisionDocumentLinks_();
  recordAutomationStatus_('Decision Documents', 'Success', `${count} rows refreshed`);
  showToast_(`${count} Decision Tracker row(s) refreshed with Annual Report, Fund Utilisation and 10BE links.`);
  return count;
}
function uiPushGrantStatus() {
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DECISIONS;
  const selected = selectedDataRow_(APFP.SHEETS.DECISIONS, headerRow);
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
  showToast_(`Grant ${grantId} marked Complete in Workspace Creator and Grant Registry.`);
}
function disbursementOrganisationsForFy_(fy) {
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
  const options = disbursementOrganisationsForFy_(fy);
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
// Whole tracker in a few calls: two column reads, the option list once per financial year, and one write per run of consecutive rows
// that share a financial year (it used to be ~6 calls per row).
function refreshDisbursementOrganisationOptions_() {
  const sheet = disbTracker_(), headerRow = disbHeaderRow_(), map = disbHeaderMap_(sheet),
    fyColumn = disbColumn_(map, 'Financial Year'), organisationColumn = disbColumn_(map, 'Organisation Name'),
    lastRow = Math.max(headerRow + 1, sheet.getLastRow()), count = lastRow - headerRow;
  const fys = sheet.getRange(headerRow + 1, fyColumn, count, 1).getDisplayValues().map(row => clean_(row[0])),
    organisations = sheet.getRange(headerRow + 1, organisationColumn, count, 1).getValues().map(row => clean_(row[0])),
    optionsByFy = {};
  const optionsFor = fy => optionsByFy[key_(fy)] || (optionsByFy[key_(fy)] = disbursementOrganisationsForFy_(fy));
  const rowNumbers = fys.map((fy, i) => (fy ? headerRow + 1 + i : 0)).filter(Boolean);
  // consecutive rows with the same financial year form one group
  const groups = [];
  rowNumbers.forEach(rowNumber => {
    const fy = key_(disbCanonicalFy_(fys[rowNumber - headerRow - 1])), last = groups[groups.length - 1];
    if (last && last.fy === fy && last.rows[last.rows.length - 1] === rowNumber - 1) last.rows.push(rowNumber);
    else groups.push({ fy, rows: [rowNumber] });
  });
  groups.forEach(group => {
    const first = group.rows[0], range = sheet.getRange(first, organisationColumn, group.rows.length, 1),
      options = optionsFor(fys[first - headerRow - 1]);
    range.clearNote();
    if (!options.length) { range.clearDataValidations(); return; }
    range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(true).build());
    group.rows.forEach(rowNumber => {
      const current = organisations[rowNumber - headerRow - 1];
      if (current && !options.some(value => key_(value) === key_(current))) sheet.getRange(rowNumber, organisationColumn).clearContent();
    });
  });
  return rowNumbers.length;
}
function uiRefreshDisbursementOptions() {
  const count = refreshDisbursementOrganisationOptions_();
  showToast_(`Organisation dropdowns refreshed for ${count} disbursement rows.`);
  return count;
}
function uiCorrectWorkspaceDetails() {
  const selected = selectedDataRow_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW);
  const result = correctWorkspaceDetailsForRow_(selected.rowNumber);
  showToast_(
    `Workspace details corrected for ${result.grantId}. No IDs, folders, sharing permissions or historical rows were changed.`
  );
  return result;
}
function uiPushDisbursements() {
  completeDisbursementRows_();
  const result = pushDisbursements_();
  const summary = `${result.changedRows} disbursement row(s) updated in ${result.pushedGrants} grantee workbook(s).`;
  recordAutomationStatus_('Disbursement Push', result.failures.length ? 'Needs attention' : 'Success', summary);
  showToast_(summary);
  const notes = [];
  if (result.stoppedEarly) notes.push('Paused before the time limit. Click Push Disbursements again to continue.');
  if (result.failures.length) notes.push(failureSummary_(result.failures) + '\nSee the Push Status column for each row.');
  if (notes.length) notifyAdmin_(`${summary}\n\n${notes.join('\n')}`);
  return result.changedRows;
}
function runDisbursementLinkSync_(options) {
  const result = syncDisbursementLinks_(options);
  const summary = `${result.linkRows} document link(s) synced from ${result.checkedGrants} grantee workbook(s).`;
  recordAutomationStatus_('Disbursement Sync', result.failures.length ? 'Needs attention' : 'Success', summary);
  showToast_(summary);
  const notes = [];
  if (result.stoppedEarly) notes.push('Paused before the time limit. Click Sync Disbursement Links again to continue.');
  if (result.failures.length) notes.push(failureSummary_(result.failures) + '\nSee the Document Sync Status column for each row.');
  if (notes.length) notifyAdmin_(`${summary}\n\n${notes.join('\n')}`);
  return result.linkRows;
}
function uiSyncDisbursements() { return runDisbursementLinkSync_(); }
// Re-checks rows already marked Synced (a grantee may have replaced a link later).
function uiSyncDisbursementsFullCheck() { return runDisbursementLinkSync_({ full: true }); }
// Redo: blanks Push Status and Document Sync Status for the selected rows.
function uiResetDisbursementStatuses() {
  const sheet = disbTracker_(), range = sheet.getActiveRange();
  if (ss_().getActiveSheet().getName() !== sheet.getName() || !range)
    throw new Error('Select the rows to reset in 6. Committed & Spent Tracker, then run this action again.');
  const count = clearDisbursementStatuses_(sheet, disbHeaderMap_(sheet), range.getRow(), range.getLastRow());
  showToast_(`${count} row(s) will be pushed and synced again.`);
  return count;
}
function uiBackupCentralAdministration() {
  const url = backupCentralAdministration_();
  showToast_('Backup saved in the Central Administration Backups folder.');
  notifyAdmin_(`Backup created:\n${url}`);
  return url;
}
