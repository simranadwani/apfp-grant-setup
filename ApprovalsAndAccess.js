// ApprovalsAndAccess.gs — Central Admin edit routing, approval, reopening, and access.
function handleCentralAdminEdit(e) {
  if (!e || !e.range) return;
  handleEdit(e);
  handleDisbursementTrackerEdit_(e);
}
function handleEdit(e) {
 if (!e || !e.range) return;
 const name = e.range.getSheet().getName();
 if (name !== APFP.SHEETS.INTAKE) return;
 // Workspace Creator carries both intake and review fields.
 handleTrackerReviewEdit_(e);
 handleGrantStatusEdit_(e);
 handleOrganisationInputEdit_(e);
 guardCompletedIntakeIdentityEdit_(e);
}
function handleOrganisationInputEdit_(e) {
  const range = e.range;
  if (range.getRow() < APFP.INTAKE.START_ROW) return;
  const first = range.getColumn();
  const last = range.getLastColumn();
  const touchesType = first <= APFP.INTAKE.ORGANISATION_TYPE_COLUMN &&
    last >= APFP.INTAKE.ORGANISATION_TYPE_COLUMN;
  const touchesName = first <= APFP.INTAKE.ORGANISATION_NAME_COLUMN &&
    last >= APFP.INTAKE.ORGANISATION_NAME_COLUMN;
  if (!touchesType && !touchesName) return;

  const sheet = range.getSheet();
  const map = headerMap_(sheet, APFP.INTAKE.HEADER_ROW);
  for (let row = range.getRow(); row <= range.getLastRow(); row++) {
    if (completedWorkspaceIntakeContext_(sheet, map, row)) continue;
    applyOrganisationValidationForRow_(row);
    prefillReturningGrantClassificationForRow_(row);
  }
}

function handleTrackerReviewEdit_(e) {
 const range = e.range;
 if (range.getRow() < APFP.INTAKE.START_ROW || range.getNumRows() !== 1 || range.getNumColumns() !== 1)
   return;
 const col = APFP.INTAKE.REVIEW_STATUS_COLUMN;
 if (col < range.getColumn() || col > range.getLastColumn())
   return;
 const status = clean_(range.getSheet().getRange(range.getRow(), col).getDisplayValue());
 if (!Object.values(APFP.REVIEW_STATUS).includes(status) || e.oldValue != null && key_(e.oldValue) === key_(status))
   return;
 const map = headerMap_(range.getSheet(), APFP.INTAKE.HEADER_ROW),
   grantId = clean_(range.getSheet().getRange(range.getRow(), map[key_('Grant ID')] + 1).getDisplayValue());
 if (!grantId) return;
 const grant = grantById_(grantId);
 if (grant && isTransactionalGrantType_(grant.record['Grant Type'])) {
   range.getSheet().getRange(range.getRow(), col).clearContent();
   return;
 }
 const lock = LockService.getScriptLock();
 if (!lock.tryLock(30000)) {
   const cell = range.getSheet().getRange(range.getRow(), col);
   e.oldValue != null ? cell.setValue(e.oldValue) : cell.clearContent();
   throw new Error('Another APFP automation run is active. The Setup Review Status change was reverted; try again after the current run finishes.');
 }
 try {
   try {
     applyReviewStatus_(grantId, status, actorEmail_());
   } catch (error) {
     const cell = range.getSheet().getRange(range.getRow(), col);
     e.oldValue != null ? cell.setValue(e.oldValue) : cell.clearContent();
     throw error;
   }
   refreshWorkspaceCreatorRow_(grantId);
 } finally {
   lock.releaseLock();
 }
}
function applyReviewStatus_(grantId, status, actor) {
 const grant = grantById_(grantId);
 if (grant && isTransactionalGrantType_(grant.record['Grant Type']))
   throw new Error('Setup review does not apply to Transactional grants.');
 const sync = masterSyncByGrantId_(grantId);
 if (!sync)
   throw new Error(`No Setup sync record exists for Grant ID ${grantId}.`);
 const current = key_(sync.record['Data Update Status']),
   p = {
     'Setup Review Status': status,
     'Reviewed At': now_(),
     'Reviewed By': actor || actorEmail_(),
     'Last Error Code': '',
     'Last Error Message': '',
     'Last Updated At': now_()
   };
 if (status === APFP.REVIEW_STATUS.APPROVED) {
   p['Data Sync Status'] = current === 'updated' ? 'Completed' : 'Ready for Sync';
   p['Data Update Status'] = current === 'updated'
     ? APFP.DATA_UPDATE_STATUS.UPDATED
     : APFP.DATA_UPDATE_STATUS.READY;
 } else if (status === APFP.REVIEW_STATUS.CHANGES && current === 'updated') {
   p['Data Sync Status'] = 'Not Eligible';
   p['Data Update Status'] = APFP.DATA_UPDATE_STATUS.REOPEN_REQUIRED;
 } else {
   p['Data Sync Status'] = 'Not Eligible';
   p['Data Update Status'] = APFP.DATA_UPDATE_STATUS.NOT_READY;
 }
 setByHeaders_(APFP.SHEETS.TECHNICAL, 2, sync.rowNumber, p);
 if (grant)
   setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, {
     'Master Data Sync Status': status === APFP.REVIEW_STATUS.APPROVED
       ? (current === 'updated' ? 'Completed' : 'Ready for Sync')
       : 'Awaiting Review',
     'Last Updated At': now_()
   });
}
function reopenSelectedSetup() {
 const sheet = ss_().getActiveSheet();
 if (!sheet || sheet.getName() !== APFP.SHEETS.INTAKE || sheet.getActiveCell().getRow() < APFP.INTAKE.START_ROW) {
   SpreadsheetApp.getUi().alert(
     'Select the grant row in 1. Workspace Creator, then run APFP Grant Workspace → Reopen setup for changes.'
   );
   return;
 }
 const row = sheet.getActiveCell().getRow(),
   map = headerMap_(sheet, APFP.INTAKE.HEADER_ROW),
   grantId = clean_(sheet.getRange(row, map[key_('Grant ID')] + 1).getDisplayValue());
 if (!grantId) {
   SpreadsheetApp.getUi().alert('The selected Workspace Creator row has no Grant ID.');
   return;
 }
 try {
   reopenSetup_(grantId);
   refreshWorkspaceCreatorRow_(grantId);
   SpreadsheetApp.getUi().alert(
     'Setup reopened. The grantee can edit it again through the organisation workspace.'
   );
 } catch (e) {
   SpreadsheetApp.getUi().alert(friendlyErrorMessage_('REOPEN_FAILED', e));
 }
}
function handleGrantStatusEdit_(e) {
 const range = e.range;
 if (range.getRow() < APFP.INTAKE.START_ROW || range.getNumRows() !== 1 || range.getNumColumns() !== 1)
   return;
 const map = headerMap_(range.getSheet(), APFP.INTAKE.HEADER_ROW),
   idx = map[key_('Grant Status')];
 if (idx == null || range.getColumn() !== idx + 1)
   return;
 const status = clean_(range.getDisplayValue());
 if (!status)
   return;
 if (!validGrantStatus_(status)) {
   e.oldValue != null ? range.setValue(e.oldValue) : range.clearContent();
   return;
 }
 const reqIdx = map[key_('Request ID')],
   requestId = reqIdx == null ? '' : clean_(range.getSheet().getRange(range.getRow(), reqIdx + 1).getDisplayValue());
 if (!requestId)
   return;
 const tech = techByRequest_(requestId);
 if (!tech || !clean_(tech.record['Grant ID']))
   return;
 try {
   updateGrantStatus_(tech.record['Grant ID'], status);
 } catch (error) {
   e.oldValue != null ? range.setValue(e.oldValue) : range.clearContent();
   throw error;
 }
 refreshWorkspaceCreatorRow_(tech.record['Grant ID']);
}
function completedWorkspaceIntakeContext_(sheet, map, rowNumber) {
  const requestId = clean_(
    sheet.getRange(rowNumber, map[key_('Request ID')] + 1).getDisplayValue()
  );
  if (!requestId) return null;
  const tech = techByRequest_(requestId);
  if (!tech ||
      !['workspace created', 'registry only'].includes(key_(tech.record['Workspace Status'])))
    return null;
  const grantId = clean_(tech.record['Grant ID']);
  const grant = grantId ? grantById_(grantId) : null;
  if (!grant)
    throw new Error(`Grant Registry row is missing for completed workspace ${requestId}.`);
  return { requestId: requestId, tech: tech, grant: grant };
}

function guardCompletedIntakeIdentityEdit_(e) {
  const range = e.range;
  if (range.getRow() < APFP.INTAKE.START_ROW) return;
  const immutableHeaders = [
    'Financial Year', 'Grant Start Date', 'Grant End Date',
    'Organisation Type', 'Organisation Name', 'Grant Type', 'Primary Contact Email'
  ];
  const sheet = range.getSheet();
  const map = headerMap_(sheet, APFP.INTAKE.HEADER_ROW);
  const touchesImmutable = immutableHeaders.some(header => {
    const column = map[key_(header)] + 1;
    return column >= range.getColumn() && column <= range.getLastColumn();
  });
  if (!touchesImmutable) return;

  for (let row = range.getRow(); row <= range.getLastRow(); row++) {
    const context = completedWorkspaceIntakeContext_(sheet, map, row);
    if (!context) continue;
    const tech = context.tech.record;
    const grant = context.grant.record;
    setByHeaders_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, row, {
      'Financial Year': tech['Financial Year'],
      'Grant Start Date': tech['Grant Start Date'],
      'Grant End Date': tech['Grant End Date'],
      'Organisation Type': tech['Organisation Type'],
      'Organisation Name': tech['Organisation Name'],
      'Grant Type': tech['Grant Type'] || grant['Grant Type'],
      'Primary Contact Email': tech['Primary Contact Email']
    });
  }
}