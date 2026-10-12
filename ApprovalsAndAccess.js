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
  const typeColumn = intakeColumn_('Organisation Type'), nameColumn = intakeColumn_('Organisation Name');
  const touchesType = first <= typeColumn && last >= typeColumn;
  const touchesName = first <= nameColumn && last >= nameColumn;
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
 const col = intakeColumn_('Setup Review Status');
 if (col < range.getColumn() || col > range.getLastColumn())
   return;
 const rawStatus = clean_(range.getSheet().getRange(range.getRow(), col).getDisplayValue());
 if (!Object.values(APFP.REVIEW_STATUS).includes(rawStatus) || e.oldValue != null && key_(e.oldValue) === key_(rawStatus))
   return;
 const map = headerMap_(range.getSheet(), APFP.INTAKE.HEADER_ROW),
   grantId = clean_(range.getSheet().getRange(range.getRow(), map[key_('Grant ID')] + 1).getDisplayValue());
 if (!grantId) return;
 const grant = grantById_(grantId);
 if (grant && isTransactionalGrantType_(grant.record['Grant Type'])) {
   range.getSheet().getRange(range.getRow(), col).clearContent();
   return;
 }
 // Changes Required on a locked Setup means "reopen it": the cell becomes Reopen Setup and the Reopen button does the work.
 let status = rawStatus;
 const syncNow = masterSyncByGrantId_(grantId);
 if (key_(status) === key_(APFP.REVIEW_STATUS.CHANGES) && syncNow && key_(syncNow.record['Setup Review Status']) === key_(APFP.REVIEW_STATUS.LOCKED)) {
   status = APFP.REVIEW_STATUS.REOPEN;
   range.getSheet().getRange(range.getRow(), col).setValue(status);
   showToast_('This Setup is locked, so Changes Required was changed to Reopen Setup. Click Reopen Setup for Changes to reopen it.');
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
 } else if (status === APFP.REVIEW_STATUS.REOPEN) {
   // Only marks the row; the Reopen Setup for Changes button does the work and keeps the locked data until then.
   delete p['Last Error Code'];
   delete p['Last Error Message'];
 } else if (status === APFP.REVIEW_STATUS.CHANGES && current === 'updated') {
   p['Data Sync Status'] = 'Not Eligible';
   p['Data Update Status'] = APFP.DATA_UPDATE_STATUS.REOPEN_REQUIRED;
 } else {
   p['Data Sync Status'] = 'Not Eligible';
   p['Data Update Status'] = APFP.DATA_UPDATE_STATUS.NOT_READY;
 }
 setByHeaders_(APFP.SHEETS.TECHNICAL, 2, sync.rowNumber, p);
 if (grant && status !== APFP.REVIEW_STATUS.REOPEN)
   setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, {
     'Master Data Sync Status': status === APFP.REVIEW_STATUS.APPROVED
       ? (current === 'updated' ? 'Completed' : 'Ready for Sync')
       : 'Awaiting Review',
     'Last Updated At': now_()
   });
}
// The Reopen Setup for Changes button: reopens EVERY row whose Setup Review Status is Reopen Setup (no row selection needed).
// Each reopened Setup becomes "Reopened - Changes Required"; a row that fails stays on Reopen Setup with the reason.
function reopenSelectedSetup() {
 runtimeGuard_();
 const lock = LockService.getScriptLock();
 if (!lock.tryLock(30000)) {
   SpreadsheetApp.getUi().alert('Another APFP automation run is active. Run this action again after it finishes.');
   return;
 }
 let reopened = 0, processed = 0, stopped = false;
 const failures = [], startedAt = Date.now();
 try {
   const marked = technicalRegistryRows_().filter(item => {
     const record = item.record;
     return key_(record['Record Status']) === 'active' && !isTransactionalGrantType_(record['Grant Type']) &&
       key_(record['Setup Review Status']) === key_(APFP.REVIEW_STATUS.REOPEN) && clean_(record['Grant ID']);
   });
   if (!marked.length) {
     SpreadsheetApp.getUi().alert('Set Setup Review Status to "Reopen Setup" on the rows to reopen, then click Reopen Setup for Changes again.');
     return;
   }
   for (const item of marked) {
     if (processed && Date.now() - startedAt >= APFP.EXECUTION_GUARD_MS) { stopped = true; break; }
     const record = item.record, grantId = clean_(record['Grant ID']), name = clean_(record['Organisation Name']) || grantId;
     try {
       reopenSetup_(grantId);
       reopened++;
     } catch (error) {
       const reason = clean_(error && error.message);
       failures.push(`• ${name}: ${reason.length > 200 ? `${reason.slice(0, 197)}…` : reason}`);
       try { saveTech_(clean_(record['Request ID']), { 'Last Error Code': 'REOPEN_FAILED', 'Last Error Message': reason }); } catch (ignored) { /* the alert still names the row */ }
     }
     try { refreshWorkspaceCreatorRow_(grantId); } catch (ignored) { /* display only */ }
     processed++;
   }
 } finally {
   lock.releaseLock();
 }
 const more = stopped ? ' Remaining rows were left untouched; click the button again to continue.' : '';
 const detail = failures.length ? `\n\nNeeds attention (still on Reopen Setup):\n${failures.slice(0, 5).join('\n')}` : '';
 SpreadsheetApp.getUi().alert(`Reopened ${reopened} Setup(s) for changes; ${failures.length} need attention.${more}${detail}`);
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
    'Financial Year', 'Organisation Name', 'Grant Type', 'Primary Contact Email',
    // Correctable only through Action = Correct Workspace (the dialog), never by typing in a completed row.
    'Grant Title', 'Grant Start Date', 'Grant End Date', 'Amount Approved', 'Thematic Area', 'Thematic Sub-area',
    'Proximity to Children / Beneficiary', 'Organisation Type'
  ];
  const sheet = range.getSheet();
  const map = headerMap_(sheet, APFP.INTAKE.HEADER_ROW);
  const touchesImmutable = immutableHeaders.some(header => {
    const column = map[key_(header)] + 1;
    return column >= range.getColumn() && column <= range.getLastColumn();
  });
  if (!touchesImmutable) return;

  let reverted = false;
  for (let row = range.getRow(); row <= range.getLastRow(); row++) {
    const context = completedWorkspaceIntakeContext_(sheet, map, row);
    if (!context) continue;
    reverted = true;
    const tech = context.tech.record;
    const grant = context.grant.record;
    const first = (...values) => { const v = values.find(value => value !== '' && value != null); return v === undefined ? '' : v; };
    setByHeaders_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, row, {
      'Financial Year': tech['Financial Year'],
      'Organisation Name': tech['Organisation Name'],
      'Grant Type': tech['Grant Type'] || grant['Grant Type'],
      'Primary Contact Email': tech['Primary Contact Email'],
      'Grant Title': first(grant['Project Title'], tech['Project Title']),
      'Grant Start Date': first(tech['Grant Start Date'], grant['Grant Start Date']),
      'Grant End Date': first(tech['Grant End Date'], grant['Grant End Date']),
      'Amount Approved': first(grant['Amount Approved'], tech['Amount Approved']),
      'Thematic Area': grant['Thematic Area'] || '',
      'Thematic Sub-area': grant['Thematic Sub-area'] || '',
      'Proximity to Children / Beneficiary': grant['Proximity to Children / Beneficiary'] || '',
      'Organisation Type': tech['Organisation Type'] || ''
    });
  }
  if (reverted) {
    try { ss_().toast('Locked on a completed grant. To correct it, set Action to "Correct Workspace" and click Correct Workspace Details (email changes: Retry/Reshare).', 'APFP', 8); }
    catch (error) { /* a toast is only a hint */ }
  }
}