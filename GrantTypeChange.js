// GrantTypeChange.gs — Correct Workspace Details: change a grant's Grant Type.
// The four types form three workspace kinds. A change inside a kind (Restricted <-> Unrestricted) is a label change.
// A change of kind adds what the new kind needs and ARCHIVES (never deletes) what it no longer needs:
//   full (Restricted, Unrestricted): Setup + Outcome Progress workbooks, Q1-Q4 and Budget folders
//   transactional: Disbursement Documents workbook          registry (Discretionary): records only, no grantee access

function workspaceKindOf_(type) {
  if (isDiscretionaryGrantType_(type)) return 'registry';
  if (isTransactionalGrantType_(type)) return 'transactional';
  return 'full';
}
function canonicalGrantType_(value) {
  return APFP.GRANT_TYPES.find(type => key_(type) === key_(value)) || '';
}
// Moves a workbook out of the grantee's folder into the FY-level archive folder and renames it. With a grantee address it stays
// readable for them (direct reader access plus a "— Read only" shortcut in the organisation folder); without one all direct access is removed.
function archiveWorkbookForTypeChange_(url, oldType, tech, readerEmail, config) {
  const fileId = urlId_(url), file = DriveApp.getFileById(fileId), fyUrl = clean_(tech['FY Folder URL']);
  if (!fyUrl) throw new Error('FY Folder URL is missing from the technical record, so the old workbook cannot be archived.');
  const name = /^ARCHIVED /.test(file.getName()) ? file.getName() : `ARCHIVED (was ${oldType}) — ${file.getName()}`;
  if (name !== file.getName()) file.setName(name);
  const archive = getOrCreateUniqueChildFolder_(DriveApp.getFolderById(urlId_(fyUrl)), APFP.FOLDERS.ARCHIVED);
  moveFileToFolder_(fileId, archive.getId());
  if (readerEmail) {
    ensureUserRole_(fileId, readerEmail, 'reader', config);
    const workspaceUrl = clean_(tech['Organisation Folder URL'] || tech['Grant Workspace URL']);
    if (workspaceUrl) ensureShortcutToTarget_(urlId_(workspaceUrl), fileId, `${name} — Read only`);
  } else {
    const email = clean_(tech['Primary Contact Email']);
    if (validEmail_(email)) removeDirectUserPermission_(fileId, email);
  }
  return { url, name };
}
// Disbursed rows of the grant are pushed again to the new workbook (Push is an upsert by Disbursement ID). Document links already
// synced into the central tracker are kept: Document Sync Status is only reset for rows that were "Not applicable" (never synced).
function resetDisbursementPushForGrant_(grantId) {
  const central = centralDisbursementRows_(), map = central.map, status = central.status, names = APFP.DISBURSEMENT_STATUS;
  if (status.push == null) return 0;
  const pushUpdates = {}, syncUpdates = {};
  central.rows.forEach((row, i) => {
    if (key_(row[map[key_('Grant ID')]]) !== key_(grantId) || key_(row[map[key_('Status')]]) !== 'disbursed') return;
    const rowNumber = central.firstRow + i;
    if (clean_(row[status.push])) pushUpdates[rowNumber] = '';
    if (status.sync != null && key_(row[status.sync]) === key_(names.NOT_APPLICABLE)) syncUpdates[rowNumber] = names.WAITING;
  });
  writeColumnValues_(central.sheet, status.push, pushUpdates);
  if (status.sync != null) writeColumnValues_(central.sheet, status.sync, syncUpdates);
  return Object.keys(pushUpdates).length;
}
// Runs under the caller's script lock. The caller already verified the row, the grant and the owner.
function changeGrantType_(grantId, requestId, rowNumber, requestedType, options) {
  const notify = !(options && options.notify === false), newType = canonicalGrantType_(requestedType);
  if (!newType) throw new Error('Grant Type must be Restricted, Unrestricted, Transactional, or Discretionary.');
  const grant = grantById_(grantId), tech = techByRequest_(requestId);
  if (!grant || !tech || key_(tech.record['Grant ID']) !== key_(grantId))
    throw new Error('The selected row is not linked to one unambiguous created grant.');
  const oldType = clean_(grant.record['Grant Type']);
  if (key_(oldType) === key_(newType)) return { applied: [], warning: '' };
  const t = tech.record, oldKind = workspaceKindOf_(oldType), newKind = workspaceKindOf_(newType), email = clean_(t['Primary Contact Email']);

  if (oldKind === newKind) {
    setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, { 'Grant Type': newType, 'Last Updated At': now_() });
    saveTech_(requestId, { 'Grant Type': newType });
    if (rowNumber) setIntake_(rowNumber, { 'Grant Type': newType, 'Last Updated': now_() });
    refreshWorkspaceCreatorRow_(grantId);
    return { applied: ['Grant Type'], warning: '' };
  }

  // Everything that could refuse the change is checked before anything is touched.
  if (newKind !== 'registry' && !validEmail_(email))
    throw new Error('A valid Primary Contact Email is needed to create and share the workspace. Correct the email first (Retry/Reshare), then change the Grant Type.');
  if (newKind === 'registry' && ['approved', 'retry approval'].includes(key_(t['Setup Review Status'])) && key_(t['Data Update Status']) !== 'updated')
    throw new Error('This Setup is Approved but not yet locked and migrated. Run Lock & Migrate (or reopen the Setup) first, then change the Grant Type.');
  if (!rowNumber) throw new Error('The Grant Type can only be changed from a Workspace Creator row.');
  const config = config_(), warnings = [], archived = [], oldWorkspaceUrl = clean_(t['Organisation Folder URL'] || t['Grant Workspace URL']);

  // 1. Archive what the new kind does not use (read-only for the grantee, or no access at all for Discretionary).
  const toArchive = [];
  if (oldKind === 'full') toArchive.push(t['Setup Workbook URL'], t['Outcome Progress Workbook URL']);
  if (oldKind === 'transactional') toArchive.push(t['Disbursement Workbook URL']);
  toArchive.filter(url => clean_(url)).forEach(url =>
    archived.push(archiveWorkbookForTypeChange_(url, oldType, t, newKind === 'registry' ? '' : email, config)));

  // 2. Records: Grant Registry, Technical Registry and the row carry the new type and the new kind's statuses.
  const full = newKind === 'full', notApplicable = APFP.STATUS.NOT_APPLICABLE, grantPatch = {
    'Grant Type': newType, 'Master Data Sync Status': full ? 'Awaiting Review' : notApplicable, 'Last Updated At': now_()
  }, techPatch = {
    'Grant Type': newType,
    'Setup Review Status': full ? '' : notApplicable, 'Data Update Status': full ? '' : notApplicable, 'Data Sync Status': full ? '' : notApplicable,
    'Last Error Code': '', 'Last Error Message': ''
  }, rowPatch = { 'Grant Type': newType, 'Action': 'Retry Workspace', 'Last Updated': now_() };
  if (oldKind === 'full') grantPatch['Source Setup Workbook URL'] = '';
  if (newKind === 'registry') { grantPatch['Grant Status'] = 'Complete'; rowPatch['Grant Status'] = 'Complete'; }
  if (oldKind === 'registry') { grantPatch['Grant Status'] = 'Active'; rowPatch['Grant Status'] = 'Active'; techPatch['Workspace ID'] = ''; }
  if (newKind !== 'registry') Object.assign(techPatch, {
    'Sharing Status': APFP.STATUS.PENDING,
    'Workspace Notification Status': notify ? '' : 'Skipped', 'Workspace Notification Sent At': '',
    'Workspace Notification Recipient': notify ? '' : email
  });
  setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, grantPatch);
  saveTech_(requestId, techPatch);
  setIntake_(rowNumber, rowPatch);

  // 3. Build what the new kind needs with the normal workspace engine (find-or-create, checkpointed, shares and protects).
  //    If it stops, the row stays on Retry Workspace and the Create Workspace button finishes it.
  const row = intakeRowsWithActions_().find(item => item.rowNumber === rowNumber);
  if (!row) throw new Error('The row could not be read back to build the new workspace. Click Create Workspace to finish.');
  const unfinished = reason => new Error(`The records now say ${newType}, but the workspace for it is not finished: ${reason} Click Create Workspace to finish.`);
  let built;
  try {
    const validation = validateIntakeRequest_(row);
    if (!validation.ok) throw new Error(validation.errors.join(' '));
    built = processWorkspaceRequest_(row, config);
  } catch (error) {
    markUnexpectedRowError_(row, error);
    throw unfinished(friendlyErrorMessage_('PROCESSING_FAILED', error));
  }
  if (!built) throw unfinished(row.failureReason || 'It needs attention.');

  // 4. Follow-ups: grantee access for Discretionary, disbursements, audit.
  if (newKind === 'registry' && oldWorkspaceUrl && validEmail_(email)) {
    try {
      if (!removeDirectUserPermission_(urlId_(oldWorkspaceUrl), email) && permissionForUser_(urlId_(oldWorkspaceUrl), email))
        warnings.push(`${email} still has access to the old workspace folder through a shared parent; remove it by hand in Drive.`);
    } catch (error) {
      warnings.push(`${email} could not be removed from the old workspace folder (${error.message}). Remove that access by hand in Drive.`);
    }
  }
  if (newKind !== 'registry') {
    try { resetDisbursementPushForGrant_(grantId); }
    catch (error) { warnings.push(`Disbursement rows could not be reset for pushing (${error.message}); use Push Disbursements after checking the tracker.`); }
  }
  try {
    writeException_({
      type: 'Grant Type Changed', severity: 'Low', status: 'Resolved', organisationId: clean_(t['Organisation ID']), grantId,
      workspaceId: clean_(t['Workspace ID']), location: APFP.SHEETS.GRANTS, field: 'Grant Type',
      message: `Grant Type changed ${oldType} -> ${newType} by ${actorEmail_() || 'unknown'}.` +
        (archived.length ? ` Archived: ${archived.map(item => `${item.name} (${item.url})`).join('; ')}.` : ''),
      recommendedAction: 'None. The archived files were not deleted.'
    });
  } catch (error) { warnings.push(`The audit line could not be written (${error.message}).`); }
  return { applied: ['Grant Type'], warning: warnings.join(' ') };
}
