// IntakeValidation.gs — Workspace Creator input, duplicate, and request validation.
function validDateValue_(value) {
 return value instanceof Date && !isNaN(value.getTime());
}
function grantQuarterFromDate_(value) {
 if (!validDateValue_(value)) return '';
 const m = value.getMonth();
 if (m >= 3 && m <= 5) return 'Q1 (Apr-Jun)';
 if (m >= 6 && m <= 8) return 'Q2 (Jul-Sep)';
 if (m >= 9 && m <= 11) return 'Q3 (Oct-Dec)';
 return 'Q4 (Jan-Mar)';
}
function intakeRowsWithActions_() {
 const sheet = sheet_(APFP.SHEETS.INTAKE),
   lastRow = Math.min(APFP.INTAKE.MAX_ROW, Math.max(APFP.INTAKE.HEADER_ROW, sheet.getLastRow()));
 if (lastRow < APFP.INTAKE.START_ROW) return [];
 const headers = sheet.getRange(APFP.INTAKE.HEADER_ROW, 1, 1, APFP.INTAKE.HEADERS.length).getDisplayValues()[0],
   rows = sheet.getRange(APFP.INTAKE.START_ROW, 1, lastRow - APFP.INTAKE.HEADER_ROW, APFP.INTAKE.HEADERS.length).getValues();
 return rows.map((values, i) => {
   const object = rowObjectFromArrays_(headers, values), startDate = object['Grant Start Date'];
   return {
     rowNumber: i + APFP.INTAKE.START_ROW,
     financialYear: clean_(object['Financial Year']), grantStartDate: startDate,
     grantEndDate: object['Grant End Date'], grantStartQuarter: grantQuarterFromDate_(startDate),
     organisationType: clean_(object['Organisation Type']), organisationName: clean_(object['Organisation Name']),
     thematicArea: clean_(object['Thematic Area']), thematicSubarea: clean_(object['Thematic Sub-area']),
     proximity: clean_(object['Proximity to Children / Beneficiary']), projectTitle: clean_(object['Grant Title']), grantType: clean_(object['Grant Type']),
     amountApproved: object['Amount Approved'], granteeEmail: clean_(object['Primary Contact Email']),
     grantStatus: clean_(object['Grant Status']), action: clean_(object['Action']),
     workspaceStatus: clean_(object['Workspace Status']), requestId: clean_(object['Request ID']),
     organisationId: clean_(object['Organisation ID']), grantId: clean_(object['Grant ID']),
     workspaceId: clean_(object['Workspace ID'])
   };
 }).filter(row => APFP.INTAKE.PROCESS_ACTIONS.includes(row.action));
}
function runtimeGuard_() {
 [APFP.SHEETS.INTAKE, APFP.SHEETS.ORGANISATIONS, APFP.SHEETS.GRANTS, APFP.SHEETS.TECHNICAL, APFP.SHEETS.LEADERSHIP].forEach(name => {
   if (!ss_().getSheetByName(name)) throw new Error(`Required sheet is missing: ${name}`);
 });
 const config = config_();
 requireConfig_(config, ['ROOT_FOLDER_ID']);
 return config;
}
function setIntake_(rowNumber, patch) {
 setByHeaders_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, rowNumber, patch);
}
function setWorkspaceStatusNote_(rowNumber, message) {
 try {
   sheet_(APFP.SHEETS.INTAKE).getRange(rowNumber, APFP.INTAKE.WORKSPACE_STATUS_COLUMN).clearNote();
 } catch (error) {
   console.warn(`Could not clear Workspace Status note for row ${rowNumber}: ${error.message}`);
 }
}
function ensureRequestIdForRow_(row) {
 if (clean_(row.requestId)) return row.requestId;
 const requestId = id_('REQ');
 row.requestId = requestId;
 setIntake_(row.rowNumber, { 'Request ID': requestId, 'Last Updated': now_() });
 return requestId;
}
function intakeDuplicateState_() {
 const sheet = sheet_(APFP.SHEETS.INTAKE), last = Math.min(APFP.INTAKE.MAX_ROW, sheet.getLastRow()), counts = {};
 if (last < APFP.INTAKE.START_ROW) return { last, counts };
 const values = sheet.getRange(APFP.INTAKE.START_ROW, 1, last - APFP.INTAKE.START_ROW + 1, 5).getDisplayValues();
 values.forEach(row => {
   const fy = key_(row[0]), org = key_(row[4]);
   if (fy && org) counts[`${org}|${fy}`] = (counts[`${org}|${fy}`] || 0) + 1;
 });
 return { last, counts };
}
function refreshDuplicateFlagsForRows_(rowNumbers) {
 const uniqueRows = [...new Set((rowNumbers || []).filter(r => r >= APFP.INTAKE.START_ROW && r <= APFP.INTAKE.MAX_ROW))];
 if (!uniqueRows.length) return;
 const sheet = sheet_(APFP.SHEETS.INTAKE), state = intakeDuplicateState_();
 uniqueRows.forEach(rowNumber => {
   if (rowNumber > state.last) return;
   const values = sheet.getRange(rowNumber, 1, 1, 5).getDisplayValues()[0], fy = key_(values[0]), org = key_(values[4]),
     next = fy && org && state.counts[`${org}|${fy}`] > 1 ? 'Duplicate' : '';
   setByHeaders_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, rowNumber, { 'Duplicate?': next });
 });
}
// Runs every row that has a pending Action, or only options.rowNumber when a button was clicked for one row
// (other queued rows, for example earlier failures that kept their Action, are then left untouched).
function processRequestedActions(options) {
 const onlyRow = options && Number(options.rowNumber) || 0;
 const config = runtimeGuard_(), queued = intakeRowsWithActions_(),
   rows = onlyRow ? queued.filter(row => row.rowNumber === onlyRow) : queued,
   otherQueued = queued.length - rows.length;
 if (!rows.length) {
   SpreadsheetApp.getUi().alert('No workspaces are waiting to be created or retried.');
   return;
 }
 const maxBatch = Math.max(1, Number(config.MAX_BATCH_SIZE || 35)), batch = rows.slice(0, maxBatch),
   lock = LockService.getScriptLock();
 if (!lock.tryLock(30000)) {
   SpreadsheetApp.getUi().alert('Another APFP automation run is already active. Run this action again after it finishes.');
   return;
 }
 let success = 0, needsAttention = 0, processed = 0, stoppedForRuntime = false;
 const failures = [];
 const startedAt = Date.now();
 try {
   refreshDuplicateFlagsForRows_(batch.map(row => row.rowNumber));
   for (const row of batch) {
     if (processed > 0 && Date.now() - startedAt >= APFP.EXECUTION_GUARD_MS) { stoppedForRuntime = true; break; }
     try {
       ensureRequestIdForRow_(row);
       if (key_(row.action) === 'retry sharing') {
         if (retrySharingForIntakeRow_(row, config)) success++;
         else { needsAttention++; failures.push(runFailure_(row, row.failureReason)); }
         processed++;
         continue;
       }
       const validation = validateIntakeRequest_(row);
       if (!validation.ok) {
         needsAttention++;
         recordValidationFailure_(row, validation.errors);
         failures.push(runFailure_(row, validation.errors.join(' ')));
         processed++;
         continue;
       }
       if (processWorkspaceRequest_(row, config)) success++;
       else { needsAttention++; failures.push(runFailure_(row, row.failureReason)); }
     } catch (e) {
       needsAttention++;
       markUnexpectedRowError_(row, e);
       failures.push(runFailure_(row, friendlyErrorMessage_('PROCESSING_FAILED', e)));
     }
     processed++;
   }
 } finally {
   lock.releaseLock();
 }
 const note = (otherQueued ? ` ${otherQueued} other row(s) still have a pending Action and were not touched; select each row and click its button, or clear their Action.` : '') + (stoppedForRuntime
   ? ' The run stopped safely before the Apps Script time limit; remaining rows were left untouched. Run the workspace action again to continue.' : '');
 recordAutomationStatus_('Workspace Creation', needsAttention || stoppedForRuntime ? 'Needs attention' : 'Success',
   `${processed} processed; ${success} completed; ${needsAttention} need attention${stoppedForRuntime ? '; safely paused' : ''}`);
 SpreadsheetApp.getUi().alert(runSummaryMessage_(processed, success, needsAttention, failures, note));
}
function validateIntakeRequest_(row) {
 const errors = [], tech = row.requestId ? techByRequest_(row.requestId) : null,
   existingGrant = !!(tech && clean_(tech.record['Grant ID']));
 if (!APFP.INTAKE.PROCESS_ACTIONS.includes(row.action))
   errors.push('Choose Create Workspace or use the system-generated retry action.');
 if (!validDateValue_(row.grantStartDate)) errors.push('Grant Start Date is required and must be a valid date.');
 if (!validDateValue_(row.grantEndDate)) errors.push('Grant End Date is required and must be a valid date.');
 if (validDateValue_(row.grantStartDate) && validDateValue_(row.grantEndDate) && row.grantEndDate < row.grantStartDate)
   errors.push('Grant End Date cannot be before Grant Start Date.');
 const derivedFy = financialYearFromDate_(row.grantStartDate);
 if (!validFinancialYear_(row.financialYear)) errors.push('Enter a valid Financial Year, e.g. 2026-27.');
 else if (derivedFy && key_(derivedFy) !== key_(row.financialYear))
   errors.push(`Financial Year should be ${derivedFy} based on the Grant Start Date.`);
 if (!['New Organisation', 'Returning Organisation'].includes(row.organisationType))
   errors.push('Choose New Organisation or Returning Organisation.');
 if (!row.organisationName) errors.push('Organisation Name is required.');
 if (!row.projectTitle) errors.push('Grant Title is required.');
 if (!existingGrant && !validGrantType_(row.grantType))
   errors.push('Grant Type must be Restricted, Unrestricted, Transactional, or Discretionary.');
 const amountApproved = parseAdminTableNumber_(row.amountApproved);
 if (!existingGrant && (amountApproved === '' || amountApproved == null || amountApproved < 0))
   errors.push('Amount Approved is required and must be a non-negative amount.');
 else if (!existingGrant) row.amountApproved = amountApproved;
 const discretionary = isDiscretionaryGrantType_(row.grantType);
 if ((!discretionary || row.granteeEmail) && !validEmail_(row.granteeEmail))
   errors.push(discretionary ? 'Primary Contact Email is optional for Discretionary grants, but must be valid when entered.' : 'Enter a valid Primary Contact Email.');
 if (row.grantStatus && !validGrantStatus_(row.grantStatus))
   errors.push('Grant Status must be Active, Discontinued, or Complete.');
 const ownOrgId = tech ? clean_(tech.record['Organisation ID']) : '', ownGrantId = tech ? clean_(tech.record['Grant ID']) : '';
 let resolvedOrgId = ownOrgId;
 if (row.organisationName && row.organisationType === 'Returning Organisation') {
   const matches = activeOrganisationRecordsByName_(row.organisationName);
   if (matches.length === 1) resolvedOrgId = clean_(matches[0].record['Organisation ID']);
   if (!resolvedOrgId)
     errors.push('Returning Organisation must exactly match one active Organisation Name with an Organisation ID in 9. Organisation Registry.');
 }
 if (row.organisationName && row.organisationType === 'New Organisation') {
   const exact = organisationRecordsByName_(row.organisationName),
     owns = exact.some(x => ownOrgId && key_(x.record['Organisation ID']) === key_(ownOrgId));
   if (exact.length && !owns)
     errors.push('This organisation already exists. Choose Returning Organisation and enter the exact Organisation Name shown in 9. Organisation Registry.');
 }
 if (row.organisationName && row.financialYear &&
     findDuplicateGrant_(row.requestId, ownGrantId, row.organisationName, row.financialYear, resolvedOrgId))
   errors.push('A grant already exists for this organisation and grant-start financial year. A grant that crosses March remains the same annual grant.');
 if (key_(row.action) === 'retry workspace' && !tech)
   errors.push('This row has no existing workspace state to retry. Choose Create Workspace instead.');
 return { ok: !errors.length, errors, tech };
}
function techPatchFromIntake_(row) {
 return {
   'Financial Year': row.financialYear,
   'Grant Start Quarter': row.grantStartQuarter || grantQuarterFromDate_(row.grantStartDate),
   'Grant Start Date': row.grantStartDate, 'Grant End Date': row.grantEndDate,
   'Grant Type': row.grantType || '', 'Amount Approved': row.amountApproved == null ? '' : row.amountApproved,
   'Organisation Type': row.organisationType, 'Organisation Name': row.organisationName,
   'Project Title': row.projectTitle, 'Primary Contact Email': row.granteeEmail
 };
}
function recordValidationFailure_(row, errors) {
 const requestId = ensureRequestIdForRow_(row), message = errors.join('\n'), existing = techByRequest_(requestId);
 setIntake_(row.rowNumber, { 'Request ID': requestId, 'Workspace Status': APFP.STATUS.NEEDS_ATTENTION, 'Last Updated': now_() });
 setWorkspaceStatusNote_(row.rowNumber, message);
 saveTech_(requestId, Object.assign(techPatchFromIntake_(row), {
   'Validation Status': APFP.STATUS.VALIDATION_FAILED,
   'Workspace Status': existing ? existing.record['Workspace Status'] : APFP.STATUS.NEEDS_ATTENTION,
   'Sharing Status': existing ? existing.record['Sharing Status'] : APFP.STATUS.PENDING,
   'Last Error Code': 'VALIDATION_FAILED', 'Last Error Message': message
 }));
}
function markUnexpectedRowError_(row, error) {
 const requestId = ensureRequestIdForRow_(row), existing = techByRequest_(requestId),
   retryCount = Number((existing && existing.record['Retry Count']) || 0) + 1,
   friendly = friendlyErrorMessage_('PROCESSING_FAILED', error);
 setIntake_(row.rowNumber, {
   'Request ID': requestId, 'Action': 'Retry Workspace',
   'Workspace Status': APFP.STATUS.NEEDS_ATTENTION, 'Last Updated': now_()
 });
 setWorkspaceStatusNote_(row.rowNumber, friendly);
 saveTech_(requestId, Object.assign(techPatchFromIntake_(row), {
   'Workspace Status': APFP.STATUS.NEEDS_ATTENTION, 'Last Error Code': 'PROCESSING_FAILED',
   'Last Error Message': error.message, 'Retry Count': retryCount
 }));
 writeException_({
   type: 'Workspace Processing Failure', severity: 'High', location: APFP.SHEETS.INTAKE,
   field: `Request ${requestId}`, message: error.message, recommendedAction: friendly,
   runId: existing ? existing.record['Run ID'] : ''
 });
}
function runFailure_(row, reason) {
  return {
    rowNumber: row.rowNumber, organisation: clean_(row.organisationName),
    reason: clean_(reason) || 'See Last Error Message in the Technical Registry.'
  };
}
// The end-of-run message names each row that needs attention and why (failure reasons are otherwise only in hidden sheets).
function runSummaryMessage_(processed, success, needsAttention, failures, note) {
  const lines = [`Processed ${processed} requested action(s). ${success} completed; ${needsAttention} need attention.${note || ''}`];
  if (failures.length) {
    lines.push('', 'Needs attention:');
    failures.slice(0, 8).forEach(f => lines.push(`• Row ${f.rowNumber}${f.organisation ? ` (${f.organisation})` : ''}: ${f.reason}`));
    if (failures.length > 8) lines.push(`• …and ${failures.length - 8} more (see the Technical Registry).`);
  }
  return lines.join('\n');
}
