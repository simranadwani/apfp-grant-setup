// CorrectWorkspace.gs — the "Correct Workspace" Action: one dialog for every marked grant, one grant at a time.
// Only the owner of a grant's workbook may correct that grant; the dialog shows other grants locked and the
// server refuses them again on save.

const CORRECT_DIALOG_FIELDS_ = ['grantType', 'title', 'startDate', 'endDate', 'amount', 'thematicArea', 'subArea', 'proximity', 'organisationType'];

function isoDate_(value) {
  const d = dateValue_(value);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateFromIso_(text) {
  const m = clean_(text).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}
// Drive owner of the file or folder that represents the grant: Setup workbook, else Disbursement workbook (Transactional),
// else the organisation folder (Registry Only). '' when Drive exposes no individual owner (shared drive).
function grantOwnerEmail_(techRecord) {
  const setup = clean_(techRecord['Setup Workbook URL']), disbursement = clean_(techRecord['Disbursement Workbook URL']),
    folder = clean_(techRecord['Organisation Folder URL'] || techRecord['Grant Workspace URL']);
  try {
    if (setup || disbursement) {
      const owner = DriveApp.getFileById(urlId_(setup || disbursement)).getOwner();
      return owner ? clean_(owner.getEmail()) : '';
    }
    if (folder) {
      const owner = DriveApp.getFolderById(urlId_(folder)).getOwner();
      return owner ? clean_(owner.getEmail()) : '';
    }
  } catch (error) {
    throw new Error(`Could not read who owns this grant's workbook (${error.message}).`);
  }
  return '';
}
// { allowed, owner, reason }: only the owner of the grant's workbook may correct it.
function grantCorrectionAccess_(techRecord) {
  const me = actorEmail_();
  if (!me) return { allowed: false, owner: '', reason: 'Your account could not be identified, so ownership cannot be checked.' };
  let owner;
  try { owner = grantOwnerEmail_(techRecord); } catch (error) { return { allowed: false, owner: '', reason: error.message }; }
  if (!owner) return { allowed: true, owner: '', reason: '' };
  if (key_(owner) !== key_(me)) return { allowed: false, owner, reason: `Only ${owner} can correct this grant.` };
  return { allowed: true, owner, reason: '' };
}
function tableDropdownOptions_(snapshot, sheetName, columnName) {
  const sheet = (snapshot.sheets || []).find(item => item.properties && item.properties.title === sheetName);
  const table = sheet && (sheet.tables || [])[0];
  const column = table && (table.columnProperties || []).find(c => key_(c.columnName) === key_(columnName));
  return dropdownValuesFromTableColumn_(column).filter(Boolean);
}
function correctWorkspaceOptions_() {
  let snapshot = { sheets: [] };
  try { snapshot = adminTablesSnapshot_(); } catch (error) { console.warn(`Dropdown options could not be read: ${error.message}`); }
  const pick = (sheetName, columnName) => tableDropdownOptions_(snapshot, sheetName, columnName);
  const orgType = pick(APFP.SHEETS.INTAKE, 'Organisation Type');
  const grantTypes = pick(APFP.SHEETS.INTAKE, 'Grant Type');
  return {
    grantType: grantTypes.length ? grantTypes : APFP.GRANT_TYPES.slice(),
    thematicArea: pick(APFP.SHEETS.INTAKE, 'Thematic Area'),
    subArea: pick(APFP.SHEETS.INTAKE, 'Thematic Sub-area'),
    proximity: pick(APFP.SHEETS.INTAKE, 'Proximity to Children / Beneficiary'),
    organisationType: orgType.length ? orgType : ['New Organisation', 'Returning Organisation']
  };
}
// One card of the dialog: the CURRENT values come from the registries (the truth), never from the editable row.
function correctWorkspaceCard_(marked) {
  const row = marked.object, requestId = clean_(row['Request ID']), grantId = clean_(row['Grant ID']),
    card = { rowNumber: marked.rowNumber, requestId, grantId, organisationName: clean_(row['Organisation Name']),
      financialYear: clean_(row['Financial Year']), grantTitle: clean_(row['Grant Title']), locked: true, lockReason: '', owner: '', values: {} };
  try {
    const grant = grantId ? grantById_(grantId) : null, tech = requestId ? techByRequest_(requestId) : null;
    if (!grant || !tech || key_(tech.record['Grant ID']) !== key_(grantId)) { card.lockReason = 'This row is not linked to one created grant yet.'; return card; }
    if (!['workspace created', 'registry only'].includes(key_(tech.record['Workspace Status']))) {
      card.lockReason = 'The workspace has not been created yet. Use Create Workspace first.'; return card;
    }
    const access = grantCorrectionAccess_(tech.record);
    card.owner = access.owner;
    card.locked = !access.allowed;
    card.lockReason = access.reason;
    const g = grant.record, t = tech.record;
    card.grantTitle = clean_(g['Project Title']);
    card.email = clean_(t['Primary Contact Email']);
    card.values = {
      grantType: clean_(g['Grant Type']),
      title: clean_(g['Project Title']),
      startDate: isoDate_(t['Grant Start Date'] || g['Grant Start Date']),
      endDate: isoDate_(t['Grant End Date'] || g['Grant End Date']),
      amount: g['Amount Approved'] === '' || g['Amount Approved'] == null ? '' : Number(g['Amount Approved']),
      thematicArea: clean_(g['Thematic Area']),
      subArea: clean_(g['Thematic Sub-area']),
      proximity: clean_(g['Proximity to Children / Beneficiary']),
      organisationType: clean_(t['Organisation Type'])
    };
  } catch (error) {
    card.locked = true;
    card.lockReason = error.message;
  }
  return card;
}
function correctWorkspaceContext_() {
  const marked = intakeRowsMarked_(APFP.INTAKE.CORRECT_ACTION);
  const kinds = {};
  APFP.GRANT_TYPES.forEach(type => { kinds[type] = workspaceKindOf_(type); });
  return { grants: marked.map(correctWorkspaceCard_), options: correctWorkspaceOptions_(), kinds };
}
// Called by the dialog for ONE card. Re-checks everything on the server: the row is still marked, the IDs match, the caller owns the grant.
function submitCorrectWorkspaceGrant(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another APFP automation run is active. Try again shortly.');
  try {
    const rowNumber = Number(payload && payload.rowNumber), changes = {}, input = (payload && payload.changes) || {};
    const row = rowObject_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, rowNumber);
    if (clean_(row['Request ID']) !== clean_(payload.requestId) || clean_(row['Grant ID']) !== clean_(payload.grantId))
      throw new Error('The row changed while the dialog was open. Close it and open Correct Workspace Details again.');
    if (key_(row['Action']) !== key_(APFP.INTAKE.CORRECT_ACTION))
      throw new Error('This row is no longer marked Correct Workspace.');
    const tech = techByRequest_(clean_(payload.requestId));
    if (!tech || key_(tech.record['Grant ID']) !== key_(payload.grantId)) throw new Error('The Grant-FY record could not be verified.');
    const access = grantCorrectionAccess_(tech.record);
    if (!access.allowed) throw new Error(access.reason);
    CORRECT_DIALOG_FIELDS_.forEach(name => {
      if (!Object.prototype.hasOwnProperty.call(input, name)) return;
      if (name === 'startDate' || name === 'endDate') {
        const date = dateFromIso_(input[name]);
        if (!date) throw new Error(`${name === 'startDate' ? 'Grant Start Date' : 'Grant End Date'} must be a valid date.`);
        changes[name] = date;
      } else changes[name] = input[name];
    });
    if (!Object.keys(changes).length) throw new Error('Switch on "Change" for at least one field first.');
    const result = applyGrantCorrections_(clean_(payload.grantId), clean_(payload.requestId), rowNumber, changes, { notify: !(payload && payload.notify === false) });
    setIntake_(rowNumber, { 'Action': APFP.STATUS.COMPLETED, 'Last Updated': now_() });
    const grant = grantById_(payload.grantId), t = techByRequest_(payload.requestId).record, g = grant.record;
    return {
      message: result.applied.length ? `Updated: ${result.applied.join(', ')}.` : 'Nothing needed changing.',
      warning: result.warning,
      values: {
        grantType: clean_(g['Grant Type']), title: clean_(g['Project Title']), startDate: isoDate_(t['Grant Start Date'] || g['Grant Start Date']),
        endDate: isoDate_(t['Grant End Date'] || g['Grant End Date']), amount: g['Amount Approved'] === '' ? '' : Number(g['Amount Approved']),
        thematicArea: clean_(g['Thematic Area']), subArea: clean_(g['Thematic Sub-area']),
        proximity: clean_(g['Proximity to Children / Beneficiary']), organisationType: clean_(t['Organisation Type'])
      }
    };
  } finally {
    lock.releaseLock();
  }
}
