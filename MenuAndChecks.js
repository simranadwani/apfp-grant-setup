// MenuAndChecks.gs — Central Administration open handler, admin notices, sheet checks, and preflight.
function handleCentralAdminOpen() {
  // No custom menu is added: actions run from assigned sheet buttons. Keep the Organisation Name dropdown live.
  applyWorkspaceOrganisationDropdown_();
}

function notifyAdmin_(message) {
  const text = clean_(message);
  try {
    SpreadsheetApp.getUi().alert(text);
    return;
  } catch (e) { /* UI is unavailable during trigger/headless execution. */ }
  try {
    ss_().toast(text, 'APFP Grant Workspace', 10);
    return;
  } catch (e) { /* Toast can also be unavailable during headless execution. */ }
  console.log(text);
}
function requiredConfigKeys_() {
  return APFP.PREFLIGHT_SCHEMA.REQUIRED_CONFIG_KEYS.slice();
}
function checkOutcomeProgressTemplate_(config) {
  requireConfig_(config, ['OUTCOME_PROGRESS_TEMPLATE_ID']);
  const spreadsheet = openSpreadsheetCached_(config.OUTCOME_PROGRESS_TEMPLATE_ID);
  const requiredSheets = Object.values(APFP.OUTCOME_TEMPLATE_SHEETS);
  requiredSheets.forEach(name => {
    if (!spreadsheet.getSheetByName(name))
      throw new Error(`Outcome Progress template is missing sheet: ${name}`);
  });
  const schema = APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE;
  const outcome = spreadsheet.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES);
  const fieldConfig = spreadsheet.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.FIELD_CONFIG);
  if (clean_(outcome.getRange(schema.GRANT_TITLE_CELL).getDisplayValue()) !== schema.GRANT_TITLE_LABEL)
    throw new Error(`Outcome Progress template ${schema.GRANT_TITLE_CELL} must be labelled ${schema.GRANT_TITLE_LABEL}.`);
  verifyTemplateLinkSchema_(spreadsheet, outcomeTemplateLinkResources_(), 'Outcome Progress template');
  return { spreadsheet, fieldConfigSheet: fieldConfig };
}
function checkTransactionalDisbursementTemplate_(config) {
  requireConfig_(config, ['DISBURSEMENT_DOCUMENT_TEMPLATE_ID']);
  const schema = APFP.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE;
  const spreadsheet = openSpreadsheetCached_(config.DISBURSEMENT_DOCUMENT_TEMPLATE_ID);
  const sheet = spreadsheet.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS);
  if (!sheet)
    throw new Error(`Transactional template is missing sheet: ${APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS}`);
  const requiredLastRow = schema.DATA_START_ROW + schema.DATA_ROWS - 1;
  if (sheet.getMaxRows() < requiredLastRow || sheet.getMaxColumns() < schema.HEADERS.length)
    throw new Error(`Transactional template must provide ${schema.DATA_ROWS} data rows across ${schema.HEADERS.length} columns.`);
  const gaps = headerGaps_(sheet.getRange(schema.HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0], schema.HEADERS);
  if (gaps.missing.length) throw new Error(`Transactional template is missing required header(s): ${gaps.missing.join(', ')}.`);
  return spreadsheet;
}
function checkExportFormulaCoverage_(sheet, section) {
  if (!section.DATA_START_ROW || !section.DATA_ROWS || !section.MIN_FORMULAS) return;
  const width = section.HEADERS_SOURCE === 'ORGANISATION_HEADERS' ? APFP.ORGANISATION_HEADERS.length :
    section.HEADERS_SOURCE === 'GRANT_HEADERS' ? APFP.GRANT_HEADERS.length :
    section.HEADERS_SOURCE === 'OUTCOME_EXPORT_HEADERS' ? APFP.OUTCOME_EXPORT_HEADERS.length :
    section.HEADERS_SOURCE === 'DISBURSEMENT_HEADERS' ? APFP.DISBURSEMENT_HEADERS.length :
    APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS[section.HEADERS_SOURCE].length;
  const formulas = sheet.getRange(section.DATA_START_ROW, 1, section.DATA_ROWS, width).getFormulas();
  const hasFormulaRow = formulas.some(row => row.filter(Boolean).length >= section.MIN_FORMULAS);
  if (!hasFormulaRow) throw new Error(
    `${section.LABEL} export has no valid formula row (minimum ${section.MIN_FORMULAS} formulas).`);
}

function checkSetupRegistryExport_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(APFP.TEMPLATE_SHEETS.REGISTRY_EXPORT);
  if (!sheet || !sheet.isSheetHidden())
    throw new Error('Setup template Registry Export must exist and remain hidden.');
  APFP.PREFLIGHT_SCHEMA.SETUP_EXPORT_SECTIONS.forEach(section => {
    const headers = APFP[section.HEADERS_SOURCE];
    if (!headers) throw new Error(`Unknown Setup export header source: ${section.HEADERS_SOURCE}.`);
    const gaps = headerGaps_(sheet.getRange(section.HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0], headers);
    if (gaps.missing.length) throw new Error(`Setup Registry Export ${section.LABEL} is missing required header(s): ${gaps.missing.join(', ')}.`);
    checkExportFormulaCoverage_(sheet, section);
  });
}
function checkOutcomeTrackerExport_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.TRACKER_EXPORT);
  if (!sheet || !sheet.isSheetHidden())
    throw new Error('Outcome template Tracker Export must exist and remain hidden.');
  APFP.PREFLIGHT_SCHEMA.OUTCOME_EXPORT_SECTIONS.forEach(section => {
    const headers = section.HEADERS_SOURCE === 'OUTCOME_EXPORT_HEADERS' ? APFP.OUTCOME_EXPORT_HEADERS :
      section.HEADERS_SOURCE === 'DISBURSEMENT_HEADERS' ? APFP.DISBURSEMENT_HEADERS :
      APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS[section.HEADERS_SOURCE];
    if (!headers) throw new Error(`Unknown Outcome export header source: ${section.HEADERS_SOURCE}.`);
    const gaps = headerGaps_(sheet.getRange(section.HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0], headers);
    if (gaps.missing.length) throw new Error(`Outcome, Support and Disbursement Tracker Export ${section.LABEL} is missing required header(s): ${gaps.missing.join(', ')}.`);
    checkExportFormulaCoverage_(sheet, section);
  });
}
// The grant identity block of a Workspace Creator row: from "Financial Year" through "Grant Title".
function intakeIdentityColumns_() {
  const start = intakeColumn_('Financial Year');
  return { start, count: intakeColumn_('Grant Title') - start + 1 };
}
function protectCompletedIntakeRow_(...args) { return timed_('Protect intake row', () => protectCompletedIntakeRowUntimed_(...args)); }
function protectCompletedIntakeRowUntimed_(rowNumber) {
  const s = sheet_(APFP.SHEETS.INTAKE),
    identity = intakeIdentityColumns_(),
    range = s.getRange(rowNumber, identity.start, 1, identity.count);
  s.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(p => p.canEdit() && completedIntakeProtection_(p, rowNumber)).forEach(p => p.remove());
  range.clearNote();
}
function completedIntakeProtection_(protection, rowNumber) {
  try {
    const range = protection.getRange(), description = clean_(protection.getDescription());
    return protection.isWarningOnly() && range.getSheet().getName() === APFP.SHEETS.INTAKE &&
      range.getRow() === rowNumber && range.getNumRows() === 1 &&
      range.getColumn() === intakeIdentityColumns_().start &&
      range.getNumColumns() === intakeIdentityColumns_().count &&
      /completed grant identity row/i.test(description);
  } catch (e) {
    return false;
  }
}
// Required headers must exist by name; their order and extra columns are allowed (extras are reported as warnings).
function checkHeaders_(errors, sheetName, headerRow, expected, warnings) {
  const s = ss_().getSheetByName(sheetName);
  if (!s) { errors.push(`Missing sheet: ${sheetName}`); return; }
  const gaps = headerGaps_(s.getRange(headerRow, 1, 1, s.getLastColumn()).getDisplayValues()[0], expected);
  if (gaps.missing.length) errors.push(`${sheetName} is missing required header(s): ${gaps.missing.join(', ')}.`);
  if (gaps.extra.length && warnings) warnings.push(`${sheetName} has extra column(s) the code leaves alone: ${gaps.extra.join(', ')}.`);
}
function preflightCentralHeaderSpecs_() {
  const rows = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS;
  const headers = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS;
  return [
    { sheetName: APFP.SHEETS.INTAKE, headerRow: rows.INTAKE, expected: APFP.INTAKE.HEADERS },
    { sheetName: APFP.SHEETS.ORGANISATIONS, headerRow: rows.ORGANISATIONS, expected: APFP.ORGANISATION_HEADERS },
    { sheetName: APFP.SHEETS.GRANTS, headerRow: rows.GRANTS, expected: APFP.GRANT_HEADERS },
    { sheetName: APFP.SHEETS.OUTCOMES, headerRow: rows.OUTCOMES, expected: headers.OUTCOMES },
    { sheetName: APFP.SHEETS.SUPPORT, headerRow: rows.SUPPORT, expected: headers.SUPPORT },
    { sheetName: APFP.SHEETS.DECISIONS, headerRow: rows.DECISIONS, expected: headers.DECISIONS },
    { sheetName: APFP.SHEETS.DIVIDENDS, headerRow: rows.DIVIDENDS, expected: headers.DIVIDENDS },
    { sheetName: APFP.SHEETS.DISBURSEMENTS, headerRow: rows.DISBURSEMENTS, expected: APFP.DISBURSEMENT_HEADERS },
    { sheetName: APFP.SHEETS.MATURITY, headerRow: rows.MATURITY, expected: APFP.MATURITY.HEADERS },
    { sheetName: APFP.SHEETS.TECHNICAL, headerRow: rows.TECHNICAL, expected: APFP.TECH_HEADERS },
    { sheetName: APFP.SHEETS.LEADERSHIP, headerRow: rows.LEADERSHIP, expected: APFP.LEADERSHIP_HEADERS }
  ];
}
function runPreflightChecks() {
  const errors = [], warnings = [];
  const capture = (label, fn) => {
    try {
      return fn();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
      return null;
    }
  };
  const config = capture('Configuration', () => {
    const loaded = config_();
    requireConfig_(loaded, requiredConfigKeys_());
    return loaded;
  });
  if (config) {
    capture('Central Administration system-sheet state', () => verifyCentralAdminSystemSheetState_());
    capture('Central Administration timezone', () => verifySpreadsheetTimeZone_(ss_(), 'Central Administration'));
    capture('Central Administration required sheets', () => {
      [...new Set(Object.values(APFP.SHEETS))].forEach(name => {
        if (!ss_().getSheetByName(name)) errors.push(`Missing sheet: ${name}`);
      });
    });
    preflightCentralHeaderSpecs_().forEach(spec => {
      capture(`Header check — ${spec.sheetName}`, () =>
        checkHeaders_(errors, spec.sheetName, spec.headerRow, spec.expected, warnings)
      );
    });
    capture('Central Administration tables', () => checkAdminTables_(errors, warnings));
    capture('Phase 2 tracker tables', () => checkPhase2TrackerTables_(errors));
    capture('Disbursement tracker table', () => checkDisbursementTrackerTable_(errors));
    const setupContext = capture('Grant Setup template open/config', () => ({
      spreadsheet: openSpreadsheetCached_(config.SETUP_TEMPLATE_ID),
      fields: templateFieldConfigRows_(config.SETUP_TEMPLATE_ID)
    }));
    if (setupContext) {
      capture('Grant Setup Field Config', () => validateTemplateFieldConfig_(setupContext.spreadsheet, setupContext.fields));
      capture('Grant Setup Links schema', () => verifyTemplateLinkSchema_(setupContext.spreadsheet, setupTemplateLinkResources_(), 'Setup template'));
      capture('Grant Setup Registry Export', () => checkSetupRegistryExport_(setupContext.spreadsheet));
      capture('Grant Setup protections', () => verifyTemplateProtections_(setupContext.spreadsheet, setupContext.fields));
      capture('Grant Setup timezone', () => verifySpreadsheetTimeZone_(setupContext.spreadsheet, 'Grant Setup template'));
    }
    const outcome = capture('Outcome Progress template schema', () =>
      checkOutcomeProgressTemplate_(config).spreadsheet
    );
    if (outcome) {
      capture('Outcome Progress Tracker Export', () => checkOutcomeTrackerExport_(outcome));
      capture('Outcome Progress protections', () => verifyOutcomeWorkbookProtections_(outcome));
      capture('Outcome Progress timezone', () => verifySpreadsheetTimeZone_(outcome, 'Outcome Progress template'));
    }
    const transactional = capture('Transactional Disbursement template schema', () =>
      checkTransactionalDisbursementTemplate_(config)
    );
    if (transactional) {
      capture('Transactional Disbursement protections', () => verifyTransactionalWorkbookProtections_(transactional));
      capture('Transactional Disbursement timezone', () => verifySpreadsheetTimeZone_(transactional, 'Transactional Disbursement template'));
    }
    capture('Restricted/Unrestricted email template', () => workspaceEmailTemplateBlock_(config, 'RESTRICTED_UNRESTRICTED'));
    capture('Transactional email template', () => workspaceEmailTemplateBlock_(config, 'TRANSACTIONAL'));
    if (key_(config.SEND_WORKSPACE_NOTIFICATION) !== 'yes')
      warnings.push('Workspace email notification is disabled.');
  }
  const lines = [errors.length
    ? `FAIL — ${errors.length} blocking APFP issue(s).`
    : 'PASS — APFP preflight checks passed.'];
  errors.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  if (warnings.length) {
    lines.push('', `Warnings (${warnings.length}):`);
    warnings.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  }
  notifyAdmin_(lines.join('\n'));
  return { ok: !errors.length, errors, warnings };
}

// Copies the whole Central Administration workbook into <CENTRAL_ADMIN_FOLDER_ID>/Backups with a timestamp.
// Central sheets mirror the grantee workbooks (including blanks), so take a copy before any bulk operation.
function backupCentralAdministration_() {
  const config = config_();
  requireConfig_(config, ['CENTRAL_ADMIN_FOLDER_ID']);
  const folder = getOrCreateUniqueChildFolder_(DriveApp.getFolderById(clean_(config.CENTRAL_ADMIN_FOLDER_ID)), 'Backups'),
    stamp = Utilities.formatDate(now_(), APFP.TIME_ZONE, 'yyyy-MM-dd HHmm'),
    copy = DriveApp.getFileById(ss_().getId()).makeCopy(`${ss_().getName()} — backup ${stamp}`, folder);
  return copy.getUrl();
}
