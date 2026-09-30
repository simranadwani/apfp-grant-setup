// WorkspaceCreation.gs — resumable folder and workbook creation.
function stepRank_(step) {
 const order = [
   APFP.STEP.VALIDATED, APFP.STEP.ORGANISATION_RESOLVED, APFP.STEP.FY_FOLDER_READY,
   APFP.STEP.ORGANISATION_FOLDER_READY, APFP.STEP.SUBFOLDERS_READY,
   APFP.STEP.WORKBOOK_READY, APFP.STEP.OUTCOME_WORKBOOK_READY,
   APFP.STEP.WORKBOOK_CONFIGURED, APFP.STEP.REGISTRIES_UPDATED,
   APFP.STEP.SHARING, APFP.STEP.NOTIFICATION, APFP.STEP.COMPLETED
 ];
 return order.map(key_).indexOf(key_(step));
}
function stepAtOrAfter_(current, target) {
 const a = stepRank_(current), b = stepRank_(target);
 return a >= 0 && b >= 0 && a >= b;
}
function openOrCopySpreadsheet_(...args) { return timed_('Copy template workbook', () => openOrCopySpreadsheetUntimed_(...args)); }
function openOrCopySpreadsheetUntimed_(folder, savedUrl, name, templateId) {
 let file = null;
 if (clean_(savedUrl)) {
   try {
     file = DriveApp.getFileById(urlId_(savedUrl));
   } catch (error) {
     console.warn(`Saved workbook URL could not be reopened; resolving by name instead: ${error.message}`);
   }
 }
 if (!file) file = findChildSpreadsheetByName_(folder, name);
 if (!file) {
   file = DriveApp.getFileById(clean_(templateId)).makeCopy(name, folder);
   DRIVE_CHILD_FILE_CACHE_[`${folder.getId()}|${clean_(name)}`] = file;
 }
 return file;
}
function configureOutcomeProgressWorkbookBase_(...args) { return timed_('Configure Outcome workbook', () => configureOutcomeProgressWorkbookBaseUntimed_(...args)); }
function configureOutcomeProgressWorkbookBaseUntimed_(workbookId, request, grantId, links) {
  const ss = openSpreadsheetCached_(workbookId);
  const schema = APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE;
  const outcome = ss.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES);
  const yearEnd = ss.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.YEAR_END);
  if (!outcome || !yearEnd) {
    throw new Error('Outcome Progress template structure is incomplete.');
  }

  const baseRows = Array.from({ length: schema.DATA_ROWS }, () => [grantId, request.projectTitle]);
  const baseRange = outcome.getRange(schema.DATA_START_ROW, 1, schema.DATA_ROWS, 2);
  const current = baseRange.getDisplayValues();
  if (
    current.some((row, index) =>
      comparable_(row[0]) !== comparable_(baseRows[index][0]) ||
      comparable_(row[1]) !== comparable_(baseRows[index][1])
    )
  ) {
    baseRange.setValues(baseRows);
  }

  const grantCell = yearEnd.getRange(schema.YEAR_END_GRANT_ID_CELL);
  if (comparable_(grantCell.getDisplayValue()) !== comparable_(grantId)) {
    grantCell.setValue(grantId);
  }

  writeGeneratedLinks_(ss, links || {});
  finaliseOutcomeWorkbookIntegrity_(ss);
}

function processWorkspaceRequest_(row, config) {
 const requestId = ensureRequestIdForRow_(row), runId = id_('RUN'),
   tech = techByRequest_(requestId), prior = tech ? tech.record : {},
   request = Object.assign({}, row, { requestId });
 request.grantStartQuarter = request.grantStartQuarter || grantQuarterFromDate_(request.grantStartDate);
 const organisationRecord = resolveOrganisation_(request, prior),
   organisationId = clean_(organisationRecord['Organisation ID']),
   grantId = clean_(prior['Grant ID']) || clean_(row.grantId) ||
     uniqueGrantId_(request.organisationName, request.projectTitle, request.financialYear),
   discretionary = isDiscretionaryGrantType_(request.grantType),
   workspaceId = discretionary ? '' : (clean_(prior['Workspace ID']) || clean_(row.workspaceId) || id_('WSP')),
   transactional = isTransactionalGrantType_(request.grantType);
 if (findDuplicateGrant_(requestId, grantId, request.organisationName, request.financialYear, organisationId))
   throw new Error('A grant already exists for this organisation and grant-start financial year.');
 setIntake_(row.rowNumber, {
   'Request ID': requestId, 'Organisation ID': organisationId, 'Grant ID': grantId,
   'Workspace ID': workspaceId, 'Workspace Status': APFP.STATUS.IN_PROGRESS, 'Last Updated': now_()
 });
 setWorkspaceStatusNote_(row.rowNumber, '');
 let record = saveTech_(requestId, Object.assign(techPatchFromIntake_(request), {
   'Organisation ID': organisationId, 'Grant ID': grantId, 'Workspace ID': workspaceId,
   'Run ID': runId, 'Validation Status': 'Passed', 'Workspace Status': APFP.STATUS.IN_PROGRESS,
   'Sharing Status': prior['Sharing Status'] || APFP.STATUS.PENDING,
   'Current Step': APFP.STEP.ORGANISATION_RESOLVED,
   'Last Completed Step': APFP.STEP.ORGANISATION_RESOLVED,
   'Last Error Code': '', 'Last Error Message': ''
 })).record;
 if (discretionary) {
   upsertGrantShell_(grantId, organisationId, Object.assign({}, request, { grantStatus: 'Complete' }), '', '');
   saveTech_(requestId, {
     'FY Folder URL': '', 'Organisation Folder URL': '', 'Grant Workspace URL': '',
     'Setup Folder URL': '', 'Setup Workbook URL': '', 'Outcome Progress Workbook URL': '',
     'Q1 Folder URL': '', 'Q2 Folder URL': '', 'Q3 Folder URL': '', 'Q4 Folder URL': '',
     'Supporting Documents Folder URL': '', 'Budget Allocation & Fund Utilisation Folder URL': '',
     'Disbursement Folder URL': '', 'Disbursement Workbook URL': '',
     'Workspace Status': APFP.STATUS.REGISTRY_ONLY, 'Sharing Status': 'Not Applicable',
     'Setup Review Status': 'Not Applicable', 'Data Update Status': 'Not Applicable',
     'Data Sync Status': 'Not Applicable', 'Current Step': APFP.STEP.COMPLETED,
     'Last Completed Step': APFP.STEP.COMPLETED, 'Last Error Code': '', 'Last Error Message': ''
   });
   setIntake_(row.rowNumber, {
     'Grant Status': 'Complete', 'Action': APFP.STATUS.COMPLETED,
     'Workspace Status': APFP.STATUS.REGISTRY_ONLY, 'Organisation Workspace': '',
     'Setup Workbook': '', 'Outcome, Support and Disbursement Tracker': '',
     'Supporting & Compliance': '', 'Budget Allocation & Fund Utilisation': '',
     'Progress Report Q1': '', 'Progress Report Q2': '', 'Progress Report Q3': '',
     'Progress Report Q4': '', 'Disbursement Documents': '',
     'Setup Review Status': APFP.STATUS.NOT_APPLICABLE, 'Last Updated': now_(), 'Request ID': requestId,
     'Organisation ID': organisationId, 'Grant ID': grantId, 'Workspace ID': ''
   });
   setWorkspaceStatusNote_(row.rowNumber, '');
   protectCompletedIntakeRow_(row.rowNumber);
   refreshWorkspaceCreatorRow_(grantId);
   return true;
 }
 requireConfig_(config, [
   'ROOT_FOLDER_ID', 'FINANCIAL_YEAR_FOLDER_PATTERN', 'ORGANISATION_FOLDER_PATTERN',
   'SUPPORTING_DOCUMENTS_FOLDER_NAME'
 ]);
 const root = DriveApp.getFolderById(config.ROOT_FOLDER_ID),
   fy = folderFromSavedOrCreate_(root, record['FY Folder URL'],
     patternName_(config.FINANCIAL_YEAR_FOLDER_PATTERN, request));
 record = saveTech_(requestId, {
   'FY Folder URL': fy.getUrl(), 'Current Step': APFP.STEP.FY_FOLDER_READY,
   'Last Completed Step': APFP.STEP.FY_FOLDER_READY
 }).record;
 const orgFolder = folderFromSavedOrCreate_(fy, record['Organisation Folder URL'],
   patternName_(config.ORGANISATION_FOLDER_PATTERN, request));
 record = saveTech_(requestId, {
   'Organisation Folder URL': orgFolder.getUrl(), 'Grant Workspace URL': orgFolder.getUrl(),
   'Current Step': APFP.STEP.ORGANISATION_FOLDER_READY,
   'Last Completed Step': APFP.STEP.ORGANISATION_FOLDER_READY
 }).record;
 const supporting = folderFromSavedOrCreate_(
     orgFolder, record['Supporting Documents Folder URL'], config.SUPPORTING_DOCUMENTS_FOLDER_NAME),
   disbursement = folderFromSavedOrCreate_(
     orgFolder, record['Disbursement Folder URL'], APFP.FOLDERS.DISBURSEMENT);
 if (transactional) {
   requireConfig_(config, ['DISBURSEMENT_DOCUMENT_TEMPLATE_ID', 'DISBURSEMENT_WORKBOOK_PATTERN']);
   const disbursementWorkbook = openOrCopySpreadsheet_(
     disbursement,
     record['Disbursement Workbook URL'],
     patternName_(config.DISBURSEMENT_WORKBOOK_PATTERN, request),
     config.DISBURSEMENT_DOCUMENT_TEMPLATE_ID
   );
   finaliseTransactionalWorkbookIntegrity_(openSpreadsheetCached_(disbursementWorkbook.getId()));

   record = saveTech_(requestId, {
     'Setup Folder URL': '', 'Setup Workbook URL': '', 'Outcome Progress Workbook URL': '',
     'Q1 Folder URL': '', 'Q2 Folder URL': '', 'Q3 Folder URL': '', 'Q4 Folder URL': '',
     'Supporting Documents Folder URL': supporting.getUrl(),
     'Budget Allocation & Fund Utilisation Folder URL': '',
     'Disbursement Folder URL': disbursement.getUrl(),
     'Disbursement Workbook URL': disbursementWorkbook.getUrl(),
     'Current Step': APFP.STEP.SUBFOLDERS_READY,
     'Last Completed Step': APFP.STEP.SUBFOLDERS_READY
   }).record;
   upsertGrantShell_(grantId, organisationId, request, '', '');
   saveTech_(requestId, {
     'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
     'Current Step': APFP.STEP.REGISTRIES_UPDATED,
     'Last Completed Step': APFP.STEP.REGISTRIES_UPDATED,
     // Created At is set on first Technical Registry insert and is not overwritten here.
   });
   return finishWorkspaceCreation_(row, request, requestId, grantId, orgFolder, config);
 }
 requireConfig_(config, [
   'SETUP_TEMPLATE_ID', 'OUTCOME_PROGRESS_TEMPLATE_ID', 'SETUP_WORKBOOK_PATTERN',
   'OUTCOME_PROGRESS_WORKBOOK_PATTERN', 'BUDGET_UTILISATION_FOLDER_NAME'
 ]);
 const q1 = folderFromSavedOrCreate_(orgFolder, record['Q1 Folder URL'], APFP.FOLDERS.Q1),
   q2 = folderFromSavedOrCreate_(orgFolder, record['Q2 Folder URL'], APFP.FOLDERS.Q2),
   q3 = folderFromSavedOrCreate_(orgFolder, record['Q3 Folder URL'], APFP.FOLDERS.Q3),
   q4 = folderFromSavedOrCreate_(orgFolder, record['Q4 Folder URL'], APFP.FOLDERS.Q4),
   budget = folderFromSavedOrCreate_(orgFolder,
     record['Budget Allocation & Fund Utilisation Folder URL'], config.BUDGET_UTILISATION_FOLDER_NAME);
 record = saveTech_(requestId, {
   'Setup Folder URL': '',
   'Q1 Folder URL': q1.getUrl(), 'Q2 Folder URL': q2.getUrl(),
   'Q3 Folder URL': q3.getUrl(), 'Q4 Folder URL': q4.getUrl(),
   'Supporting Documents Folder URL': supporting.getUrl(),
   'Budget Allocation & Fund Utilisation Folder URL': budget.getUrl(),
   'Disbursement Folder URL': disbursement.getUrl(),
   'Disbursement Workbook URL': '',
   'Current Step': APFP.STEP.SUBFOLDERS_READY,
   'Last Completed Step': APFP.STEP.SUBFOLDERS_READY
 }).record;
 const setup = openOrCopySpreadsheet_(orgFolder, record['Setup Workbook URL'],
   patternName_(config.SETUP_WORKBOOK_PATTERN, request), config.SETUP_TEMPLATE_ID);
 record = saveTech_(requestId, {
   'Setup Workbook URL': setup.getUrl(), 'Current Step': APFP.STEP.WORKBOOK_READY,
   'Last Completed Step': APFP.STEP.WORKBOOK_READY
 }).record;
 const outcomeWorkbook = openOrCopySpreadsheet_(orgFolder, record['Outcome Progress Workbook URL'],
   patternName_(config.OUTCOME_PROGRESS_WORKBOOK_PATTERN, request), config.OUTCOME_PROGRESS_TEMPLATE_ID),
   generatedLinks = {
     workspaceUrl: orgFolder.getUrl(), q1Url: q1.getUrl(), q2Url: q2.getUrl(),
     q3Url: q3.getUrl(), q4Url: q4.getUrl(), supportingUrl: supporting.getUrl(),
     budgetUtilisationUrl: budget.getUrl(), disbursementUrl: disbursement.getUrl(),
     outcomeProgressWorkbookUrl: outcomeWorkbook.getUrl()
   };
 configureOutcomeProgressWorkbookBase_(outcomeWorkbook.getId(), request, grantId, generatedLinks);
 record = saveTech_(requestId, {
   'Outcome Progress Workbook URL': outcomeWorkbook.getUrl(),
   'Current Step': APFP.STEP.OUTCOME_WORKBOOK_READY,
   'Last Completed Step': APFP.STEP.OUTCOME_WORKBOOK_READY
 }).record;
 if (!stepAtOrAfter_(record['Last Completed Step'], APFP.STEP.WORKBOOK_CONFIGURED)) {
   configureGeneratedWorkbook_(openSpreadsheetCached_(setup.getId()), request, organisationRecord, generatedLinks, config);
   record = saveTech_(requestId, {
     'Current Step': APFP.STEP.WORKBOOK_CONFIGURED,
     'Last Completed Step': APFP.STEP.WORKBOOK_CONFIGURED
   }).record;
 }
 upsertGrantShell_(grantId, organisationId, request, setup.getUrl(), outcomeWorkbook.getUrl());
 registerCreatedWorkbookForSync_(request, organisationId, grantId, setup.getUrl());
 saveTech_(requestId, {
   'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
   'Current Step': APFP.STEP.REGISTRIES_UPDATED,
   'Last Completed Step': APFP.STEP.REGISTRIES_UPDATED,
   // Created At is set on first Technical Registry insert and is not overwritten here.
 });
 return finishWorkspaceCreation_(row, request, requestId, grantId, orgFolder, config);
}
function finishWorkspaceCreation_(row, request, requestId, grantId, orgFolder, config) {
 try {
   ensureWorkspaceSharingSafe_(requestId, orgFolder.getId(), request.granteeEmail, config);
   saveTech_(requestId, {
     'Sharing Status': APFP.STATUS.COMPLETED,
     'Current Step': APFP.STEP.NOTIFICATION,
     'Last Completed Step': APFP.STEP.SHARING
   });
   sendWorkspaceNotificationOnce_(requestId, config);
   saveTech_(requestId, {
     'Current Step': APFP.STEP.COMPLETED, 'Last Completed Step': APFP.STEP.COMPLETED,
     'Last Error Code': '', 'Last Error Message': ''
   });
   setIntake_(row.rowNumber, {
     'Grant Status': grantStatusOrDefault_(request.grantStatus),
     'Action': APFP.STATUS.COMPLETED,
     'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
     'Last Updated': now_(), 'Request ID': requestId, 'Grant ID': grantId
   });
   setWorkspaceStatusNote_(row.rowNumber, '');
   protectCompletedIntakeRow_(row.rowNumber);
   refreshWorkspaceCreatorRow_(grantId);
   return true;
 } catch (e) {
   const current = techByRequest_(requestId).record,
     sharingDone = key_(current['Sharing Status']) === 'completed',
     code = sharingDone ? 'NOTIFICATION_FAILED' : 'SHARING_FAILED',
     friendly = friendlyErrorMessage_(code, e);
   saveTech_(requestId, {
     'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
     'Sharing Status': sharingDone ? APFP.STATUS.COMPLETED : APFP.STATUS.FAILED,
     'Current Step': sharingDone ? APFP.STEP.NOTIFICATION : APFP.STEP.SHARING,
     'Last Error Code': code, 'Last Error Message': e.message
   });
   setIntake_(row.rowNumber, {
     'Action': 'Retry Sharing', 'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
     'Last Updated': now_(), 'Request ID': requestId, 'Grant ID': grantId
   });
   setWorkspaceStatusNote_(row.rowNumber, friendly);
   row.failureReason = friendly;
   refreshWorkspaceCreatorRow_(grantId);
   return false;
 }
}