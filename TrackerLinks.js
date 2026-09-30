// TrackerLinks.gs — Workspace Creator links and derived display fields.
function isTransactionalGrantType_(value) {
 return key_(value) === 'transactional';
}

function isDiscretionaryGrantType_(value) {
 return key_(value) === 'discretionary';
}
function masterSyncFailureSummary_(sync) {
 const record = sync && sync.record ? sync.record : sync;
 if (!record || key_(record['Data Update Status']) !== 'failed') return '';
 const message = key_(record['Last Error Message']);
 if (message.indexOf('approved setup is incomplete') >= 0)
   return 'System failed — required Setup fields are incomplete.';
 if (message.indexOf('read-only') >= 0 || message.indexOf('archive') >= 0 || message.indexOf('lock') >= 0)
   return 'System failed — approved Setup could not be locked.';
 return 'System failed — approved Setup could not be updated.';
}
function workspaceCreatorRowNumberForGrant_(grantId, tech) {
 grantId = clean_(grantId);
 if (!grantId) return 0;
 const found = findRows_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, 'Grant ID', grantId);
 if (found.length > 1) throw new Error(`Duplicate Grant ID in Workspace Creator: ${grantId}`);
 if (found.length === 1) return found[0];
 const context = tech || techByGrantId_(grantId), requestId = clean_(context && context.record['Request ID']);
 if (!requestId) return 0;
 const requestRows = findRows_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, 'Request ID', requestId);
 return requestRows.length === 1 ? requestRows[0] : 0;
}
function workspaceCreatorSystemPatch_(grantId, tech) {
 const context = tech || techByGrantId_(grantId);
 if (!context) return null;
 const r = context.record;
 const grant = grantById_(grantId),
   grantType = r['Grant Type'] || (grant && grant.record['Grant Type']),
   transactional = isTransactionalGrantType_(grantType), discretionary = isDiscretionaryGrantType_(grantType);
 const link = (label, url) => clean_(url) ? hyperlinkFormula_(label, clean_(url)) : '';
 return {
   'Grant Status': grant ? grantStatusOrDefault_(grant.record['Grant Status']) : 'Active',
   // Display only: the Technical Registry keeps 'Workspace Created' for Transactional, so every rule that reads it is unchanged.
   'Workspace Status': transactional && key_(r['Workspace Status']) === key_(APFP.STATUS.WORKSPACE_CREATED)
     ? APFP.STATUS.DISBURSEMENT_ONLY : (clean_(r['Workspace Status']) || APFP.STATUS.IN_PROGRESS),
   'Organisation Workspace': link('Open organisation workspace', r['Organisation Folder URL'] || r['Grant Workspace URL']),
   'Setup Workbook': transactional ? '' : link('Open Grant Setup', r['Setup Workbook URL']),
   'Outcome, Support and Disbursement Tracker': transactional ? '' : link('Open Outcome, Support and Disbursement Tracker', r['Outcome Progress Workbook URL']),
   'Supporting & Compliance': link('Open supporting & compliance', r['Supporting Documents Folder URL']),
   'Budget Allocation & Fund Utilisation': transactional ? '' : link('Open budget & fund utilisation', r['Budget Allocation & Fund Utilisation Folder URL']),
   'Setup Review Status': transactional || discretionary ? APFP.STATUS.NOT_APPLICABLE
     : (clean_(r['Setup Review Status']) || APFP.REVIEW_STATUS.AWAITING),

   'Progress Report Q1': transactional ? '' : link('Open Q1 folder', r['Q1 Folder URL']),
   'Progress Report Q2': transactional ? '' : link('Open Q2 folder', r['Q2 Folder URL']),
   'Progress Report Q3': transactional ? '' : link('Open Q3 folder', r['Q3 Folder URL']),
   'Progress Report Q4': transactional ? '' : link('Open Q4 folder', r['Q4 Folder URL']),
   'Disbursement Documents': link('Open disbursement documents', r['Disbursement Workbook URL'] || r['Disbursement Folder URL']),
   'Last Updated': r['Last Updated At'] || now_(),
   'Request ID': clean_(r['Request ID']),
   'Organisation ID': clean_(r['Organisation ID']),
   'Grant ID': grantId,
   'Workspace ID': clean_(r['Workspace ID'])
 };
}
function refreshWorkspaceCreatorRow_(...args) { return timed_('Refresh Workspace Creator row', () => refreshWorkspaceCreatorRowUntimed_(...args)); }
function refreshWorkspaceCreatorRowUntimed_(grantId) {
 grantId = clean_(grantId);
 if (!grantId) return;
 const tech = techByGrantId_(grantId),
   rowNumber = workspaceCreatorRowNumberForGrant_(grantId, tech),
   patch = workspaceCreatorSystemPatch_(grantId, tech);
 if (!rowNumber || !patch) return;
 setIntake_(rowNumber, patch);
 const note = tech && !isTransactionalGrantType_(tech.record['Grant Type']) ? masterSyncFailureSummary_(tech.record) : '';
 setWorkspaceStatusNote_(rowNumber, note);
}