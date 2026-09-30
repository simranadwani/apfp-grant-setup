// SharingAndEmail.gs — access control, archive access, and workspace email.
function ensureWorkspaceSharingSafe_(requestId, workspaceFolderId, email, config) {
 const permissionSnapshot = permissionForUser_(workspaceFolderId, email);
 assertWorkspaceFilesSafeToShare_(requestId, config);
 try {
   ensureUserRole_(workspaceFolderId, email, 'writer', config);
   removeWorkspaceGranteeProtectionAccess_(requestId, config, email);
   assertWorkspaceFilesSafeToShare_(requestId, config, email);
   return true;
 } catch (error) {
   try {
     restoreUserPermission_(workspaceFolderId, email, permissionSnapshot, config);
   } catch (rollbackError) {
     throw new Error(`Workspace sharing safety verification failed: ${error.message}. Permission rollback also failed: ${rollbackError.message}`);
   }
   throw error;
 }
}
const WORKSPACE_EMAIL_TEMPLATE_CACHE_ = {};

function workspaceEmailTemplateText_(docId) {
  const id = clean_(docId);
  if (!WORKSPACE_EMAIL_TEMPLATE_CACHE_[id]) {
    WORKSPACE_EMAIL_TEMPLATE_CACHE_[id] = DocumentApp.openById(id).getBody().getText();
  }
  return WORKSPACE_EMAIL_TEMPLATE_CACHE_[id];
}

function workspaceEmailTemplateBlock_(config, blockName) {
  const docId = clean_(config.WORKSPACE_EMAIL_TEMPLATE_DOC_ID);
  if (!docId) throw new Error('WORKSPACE_EMAIL_TEMPLATE_DOC_ID is not configured.');

  const text = workspaceEmailTemplateText_(docId);
  const openMarker = `[[${blockName}]]`;
  const closeMarker = `[[/${blockName}]]`;
  const start = text.indexOf(openMarker);
  const end = text.indexOf(closeMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Workspace email template block ${blockName} was not found in the configured Google Doc.`);
  }

  const block = text.slice(start + openMarker.length, end).trim();
  const subjectMatch = block.match(/^SUBJECT:\s*(.+)$/mi);
  const bodyMatch = block.match(/(?:^|\n)BODY:\s*\n([\s\S]*)$/i);
  if (!subjectMatch || !bodyMatch) {
    throw new Error(`Workspace email template block ${blockName} must contain SUBJECT: and BODY: sections.`);
  }
  return { subject: clean_(subjectMatch[1]), body: bodyMatch[1].trim() };
}

function mergeWorkspaceEmailTemplate_(text, values) {
 const rendered = String(text || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (match, key) =>
   Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] == null ? '' : values[key]) : match
 );
 const unresolved = rendered.match(/\{\{[^}]+\}\}/g);
 if (unresolved && unresolved.length)
   throw new Error(`Unresolved workspace email placeholder(s): ${[...new Set(unresolved)].join(', ')}`);
 return rendered;
}
function sendWorkspaceNotificationOnce_(requestId, config) {
 const tech = techByRequest_(requestId);
 if (!tech) throw new Error(`No technical record exists for Request ID ${requestId}.`);
 const r = tech.record,
   recipient = clean_(r['Primary Contact Email']);
 if (key_(r['Workspace Notification Status']) === 'sent') return true;
 if (key_(config.SEND_WORKSPACE_NOTIFICATION) !== 'yes') {
   saveTech_(requestId, { 'Workspace Notification Status': 'Disabled', 'Workspace Notification Recipient': recipient });
   return true;
 }
 if (!validEmail_(recipient)) throw new Error('A valid Primary Contact Email is required for the workspace notification.');
 const transactional = isTransactionalGrantType_(r['Grant Type']),
   workspace = clean_(r['Grant Workspace URL'] || r['Organisation Folder URL']),
   setup = clean_(r['Setup Workbook URL']);
 if (!workspace) throw new Error('Workspace URL is missing from the technical record.');
 if (!transactional && !setup) throw new Error('Grant Setup Workbook URL is missing from the technical record.');
 const template = workspaceEmailTemplateBlock_(config, transactional ? 'TRANSACTIONAL' : 'RESTRICTED_UNRESTRICTED'),
   values = {
     organisation_name: clean_(r['Organisation Name']),
     grant_title: clean_(r['Project Title']),
     financial_year: clean_(r['Financial Year']),
     workspace_url: workspace,
     setup_url: setup
   },
   subject = mergeWorkspaceEmailTemplate_(template.subject, values),
   body = mergeWorkspaceEmailTemplate_(template.body, values);
 try {
   MailApp.sendEmail({ to: recipient, subject, body });
   saveTech_(requestId, {
     'Workspace Notification Status': 'Sent',
     'Workspace Notification Sent At': now_(),
     'Workspace Notification Recipient': recipient
   });
   return true;
 } catch (e) {
   saveTech_(requestId, {
     'Workspace Notification Status': 'Failed',
     'Workspace Notification Recipient': recipient,
     'Last Error Code': 'NOTIFICATION_FAILED',
     'Last Error Message': e.message
   });
   throw e;
 }
}
function retrySharingForIntakeRow_(row, config, options) {
 if (!row.requestId)
   throw new Error('Retry Sharing requires an existing Request ID.');
 const tech = techByRequest_(row.requestId);
 if (!tech)
   throw new Error('No technical record exists for this row. Use Create Workspace first.');
 const workspace = clean_(tech.record['Organisation Folder URL'] || tech.record['Grant Workspace URL']),
   email = clean_((options && options.email) || tech.record['Primary Contact Email']);
 if (!workspace)
   throw new Error(
       'The workspace is not fully created yet. Run APFP Grant Workspace → Create or retry workspace.'
     );
 try {
   repairWorkspaceFilesBeforeRetrySharing_(row.requestId, config);
   ensureWorkspaceSharingSafe_(row.requestId, urlId_(workspace), email, config);

   saveTech_(
     row.requestId,
     {
       'Primary Contact Email': email,
       'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
       'Sharing Status': APFP.STATUS.COMPLETED,
       'Current Step': APFP.STEP.NOTIFICATION,
       'Last Completed Step': APFP.STEP.SHARING,
       'Last Error Code': '',
       'Last Error Message': ''
     }
   );
   sendWorkspaceNotificationOnce_(row.requestId, config);
   saveTech_(
     row.requestId,
     { 'Current Step': APFP.STEP.COMPLETED, 'Last Completed Step': APFP.STEP.COMPLETED }
   );
   const grant = grantById_(tech.record['Grant ID']);
   if (grant)
     setByHeaders_(
       APFP.SHEETS.GRANTS,
       1,
       grant.rowNumber,
       { 'Primary Contact Email': email, 'Last Updated At': now_() }
     );
   setIntake_(
     row.rowNumber,
     {
       'Action': APFP.STATUS.COMPLETED,
       'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
       'Last Updated': now_()
     }
   );
   refreshWorkspaceCreatorRow_(tech.record['Grant ID']);
   return true;
 } catch (e) {
   const notification = key_(techByRequest_(row.requestId).record['Sharing Status']) === 'completed',
     code = notification ? 'NOTIFICATION_FAILED' : 'SHARING_FAILED',
     friendly = friendlyErrorMessage_(code, e);
   saveTech_(
     row.requestId,
     {
       'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
       'Sharing Status': notification ? APFP.STATUS.COMPLETED : APFP.STATUS.FAILED,
       'Current Step': notification ? APFP.STEP.NOTIFICATION : APFP.STEP.SHARING,
       'Last Error Code': code,
       'Last Error Message': e.message
     }
   );
   setIntake_(
     row.rowNumber,
     {
       'Action': 'Retry Sharing',
       'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
       'Last Updated': now_()
     }
   );
   row.failureReason = friendly;
   return false;
 }
}

function transferGrantFyPrimaryEmail_(row, newEmail, config) {
 if (!row.requestId || !row.grantId)
   throw new Error('The selected row must have both Request ID and Grant ID.');
 if (!validEmail_(newEmail)) throw new Error('Enter a valid new Primary Contact Email.');
 const tech = techByRequest_(row.requestId);
 if (!tech || key_(tech.record['Grant ID']) !== key_(row.grantId))
   throw new Error('The selected row is not linked to one unambiguous Grant-FY record.');
 const record = tech.record,
   oldEmail = clean_(record['Primary Contact Email']),
   workspaceId = urlId_(record['Organisation Folder URL'] || record['Grant Workspace URL']);
 if (!workspaceId) throw new Error('The selected Grant-FY workspace has not been created yet.');
 if (key_(oldEmail) === key_(newEmail))
   return retrySharingForIntakeRow_(row, config, { email: oldEmail });

 const resources = [{ id: workspaceId, role: 'writer', label: 'Grant-FY workspace' }];
 const setupId = clean_(record['Setup Workbook URL']) ? urlId_(record['Setup Workbook URL']) : '';
 if (setupId && clean_(record['Approved Setup Archive URL']))
   resources.push({ id: setupId, role: 'reader', label: 'approved Setup workbook' });
 const snapshots = resources.map(resource => Object.assign({}, resource, {
   newPermission: permissionForUser_(resource.id, newEmail)
 }));
 let committed = false;
 try {
   repairWorkspaceFilesBeforeRetrySharing_(row.requestId, config);
   resources.forEach(resource => ensureUserRole_(resource.id, newEmail, resource.role, config));
   removeWorkspaceGranteeProtectionAccess_(row.requestId, config, newEmail);
   assertWorkspaceFilesSafeToShare_(row.requestId, config, newEmail);
   resources.forEach(resource => {
     const permission = permissionForUser_(resource.id, newEmail);
     if (!permission) throw new Error(`New access could not be verified on ${resource.label}.`);
   });

   saveTech_(row.requestId, {
     'Primary Contact Email': newEmail,
     'Workspace Notification Status': '',
     'Workspace Notification Sent At': '',
     'Workspace Notification Recipient': '',
     'Sharing Status': APFP.STATUS.COMPLETED,
     'Current Step': APFP.STEP.NOTIFICATION,
     'Last Completed Step': APFP.STEP.SHARING,
     'Last Error Code': '',
     'Last Error Message': ''
   });
   const grant = grantById_(row.grantId);
   if (!grant) throw new Error(`Grant Registry record was not found for ${row.grantId}.`);
   setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, {
     'Primary Contact Email': newEmail, 'Last Updated At': now_()
   });
   setIntake_(row.rowNumber, { 'Primary Contact Email': newEmail, 'Last Updated': now_() });
   committed = true;

   if (validEmail_(oldEmail)) resources.forEach(resource =>
     removeDirectUserPermission_(resource.id, oldEmail));
   sendWorkspaceNotificationOnce_(row.requestId, config);
   saveTech_(row.requestId, {
     'Current Step': APFP.STEP.COMPLETED,
     'Last Completed Step': APFP.STEP.COMPLETED,
     'Last Error Code': '',
     'Last Error Message': ''
   });
   setIntake_(row.rowNumber, {
     'Action': APFP.STATUS.COMPLETED,
     'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
     'Last Updated': now_()
   });
   setWorkspaceStatusNote_(row.rowNumber, '');
   refreshWorkspaceCreatorRow_(row.grantId);
   recordAutomationStatus_('Workspace Creation', 'Success',
     `Grant-FY ${row.grantId} primary email changed from ${oldEmail} to ${newEmail}`);
   return true;
 } catch (error) {
   if (!committed) snapshots.forEach(snapshot => {
     try { restoreUserPermission_(snapshot.id, newEmail, snapshot.newPermission, config); }
     catch (rollbackError) { console.warn(`New-email permission rollback failed: ${rollbackError.message}`); }
   });
   saveTech_(row.requestId, {
     'Last Error Code': committed ? 'EMAIL_TRANSFER_CLEANUP_FAILED' : 'EMAIL_TRANSFER_FAILED',
     'Last Error Message': error.message
   });
   setIntake_(row.rowNumber, { 'Action': 'Retry Sharing', 'Last Updated': now_() });
   throw error;
 }
}
function archiveApprovedSetup_(grantId) {
 const grant = grantById_(grantId);
 if (grant && isTransactionalGrantType_(grant.record['Grant Type']))
   throw new Error('Setup approval and archiving do not apply to Transactional grants.');
 const sync = masterSyncByGrantId_(grantId);
 if (!sync)
   throw new Error(`No Setup sync record exists for Grant ID ${grantId}.`);
 const tech = sync.record,
   sourceId = clean_(tech['Setup Workbook URL']) ? urlId_(tech['Setup Workbook URL']) : '',
   email = clean_(tech['Primary Contact Email']),
   workspaceId = urlId_(tech['Organisation Folder URL'] || tech['Grant Workspace URL']),
   fyId = urlId_(tech['FY Folder URL']);
 if (!sourceId || !email || !workspaceId || !fyId)
   throw new Error(
       'Setup workbook, Primary Contact Email, workspace or FY folder is missing from the technical record.'
     );
 const effectiveConfig = config_(),
   archive = getOrCreateUniqueChildFolder_(DriveApp.getFolderById(fyId), APFP.FOLDERS.APPROVED_SETUPS),
   file = DriveApp.getFileById(sourceId);
 reassertSetupProtections_(sourceId, effectiveConfig);
 moveFileToFolder_(sourceId, archive.getId());
 ensureUserRole_(sourceId, email, 'reader', effectiveConfig);
 const shortcut = ensureShortcutToTarget_(workspaceId, sourceId, `${file.getName()} — Read only`);
 setByHeaders_(
   APFP.SHEETS.TECHNICAL,
   2,
   sync.rowNumber,
   {
     'Setup Folder URL': '',
     'Approved Setup Archive URL': archive.getUrl(),
     'Setup Shortcut URL': shortcut.webViewLink || `https://drive.google.com/open?id=${shortcut.id}`,
     'Last Updated At': now_()
   }
 );
}
function reopenSetup_(grantId) {
 const grant = grantById_(grantId);
 if (grant && isTransactionalGrantType_(grant.record['Grant Type']))
   throw new Error('Setup reopening does not apply to Transactional grants.');
 const sync = masterSyncByGrantId_(grantId);
 if (!sync)
   throw new Error(`No Setup sync record exists for Grant ID ${grantId}.`);
 const tech = sync.record,
   sourceId = clean_(tech['Setup Workbook URL']) ? urlId_(tech['Setup Workbook URL']) : '',
   workspaceId = urlId_(tech['Organisation Folder URL'] || tech['Grant Workspace URL']);
 if (!sourceId || !workspaceId)
   throw new Error('Setup workbook or organisation workspace is missing from Technical Registry.');
 moveFileToFolder_(sourceId, workspaceId);
 deleteShortcutToTarget_(workspaceId, sourceId);
 const effectiveConfig = config_(), granteeEmail = clean_(tech['Primary Contact Email']),
   permissionSnapshot = permissionForUser_(sourceId, granteeEmail),
   fieldConfig = templateFieldConfigRows_(clean_(effectiveConfig.SETUP_TEMPLATE_ID)),
   setupSpreadsheet = openSpreadsheetCached_(sourceId),
   protectionSpecs = setupWorkbookProtectionSpecs_(fieldConfig);
 reassertSetupProtections_(sourceId, effectiveConfig);
 try {
   ensureUserRole_(sourceId, granteeEmail, 'writer', effectiveConfig);
   removeGranteeProtectionAccess_(setupSpreadsheet, protectionSpecs, granteeEmail);
   verifyGranteeProtectionAccess_(setupSpreadsheet, protectionSpecs, granteeEmail);
 } catch (error) {
   try {
     restoreUserPermission_(sourceId, granteeEmail, permissionSnapshot, effectiveConfig);
   } catch (rollbackError) {
     throw new Error(`Setup reopen safety verification failed: ${error.message}. Permission rollback also failed: ${rollbackError.message}`);
   }
   throw error;
 }
 setByHeaders_(APFP.SHEETS.TECHNICAL, 2, sync.rowNumber, {
   'Approved Setup Archive URL': '',
   'Setup Shortcut URL': '',
   'Setup Review Status': APFP.REVIEW_STATUS.CHANGES,
   'Data Update Status': APFP.DATA_UPDATE_STATUS.NOT_READY,
   'Data Sync Status': 'Not Eligible',
   'Reviewed At': now_(),
   'Reviewed By': actorEmail_(),
   'Last Error Code': '',
   'Last Error Message': '',
   'Last Updated At': now_()
 });
 const g = grantById_(grantId);
 if (g)
   setByHeaders_(APFP.SHEETS.GRANTS, 1, g.rowNumber, {
     'Master Data Sync Status': 'Awaiting Review',
     'Last Updated At': now_()
   });
}