// ProtectionIntegrity.gs — fail-closed workbook protection and share-readiness checks.

function normaliseA1Ranges_(ranges) {
  return [...new Set((ranges || []).map(clean_).filter(Boolean))].sort();
}

function protectionEditorEmails_(protection) {
  return protection.getEditors()
    .map(user => clean_(user.getEmail()).toLowerCase())
    .filter(Boolean)
    .sort();
}

function workbookOwnerEmail_(spreadsheet) {
  try {
    const owner = DriveApp.getFileById(spreadsheet.getId()).getOwner();
    return owner ? clean_(owner.getEmail()) : '';
  } catch (error) {
    // Shared-drive files do not expose an individual owner. In that case the
    // effective user remains the protection administrator for this run.
    return '';
  }
}

function hardenProtectionEditors_(protection, spreadsheet) {
  const owner = workbookOwnerEmail_(spreadsheet);
  const actor = clean_(Session.getEffectiveUser().getEmail());
  const allowed = Array.from(new Set([owner, actor].filter(validEmail_)));
  if (!allowed.length) {
    throw new Error('The workbook owner or current user could not be identified for sheet protection.');
  }
  protection.addEditors(allowed);
  protection.getEditors().forEach(user => {
    const email = clean_(user.getEmail());
    if (email && !allowed.some(value => key_(value) === key_(email))) {
      protection.removeEditor(user);
    }
  });
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  return protection;
}



function verifyGranteeProtectionAccess_(spreadsheet, specs, granteeEmail) {
  const email = clean_(granteeEmail).toLowerCase();
  if (!email) return true;
  (specs || []).forEach(spec => {
    const sheet = spreadsheet.getSheetByName(spec.sheetName);
    if (!sheet) throw new Error(`Workbook is missing sheet during grantee protection verification: ${spec.sheetName}`);
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)
      .filter(protection => !protection.isWarningOnly())
      .forEach(protection => {
        if (protectionEditorEmails_(protection).includes(email)) {
          throw new Error(`Grantee email ${email} must not be able to override protected cells on ${spec.sheetName}.`);
        }
      });
  });
  return true;
}

function removeGranteeProtectionAccess_(spreadsheet, specs, granteeEmail) {
  const email = clean_(granteeEmail).toLowerCase();
  if (!email) return true;
  (specs || []).forEach(spec => {
    const sheet = spreadsheet.getSheetByName(spec.sheetName);
    if (!sheet) throw new Error(`Workbook is missing sheet while removing grantee protection access: ${spec.sheetName}`);
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)
      .filter(protection => !protection.isWarningOnly())
      .forEach(protection => {
        if (!protectionEditorEmails_(protection).includes(email)) return;
        if (!protection.canEdit()) {
          throw new Error(`Automation cannot remove grantee protection override access on ${spec.sheetName}.`);
        }
        protection.removeEditor(email);
      });
  });
  return verifyGranteeProtectionAccess_(spreadsheet, specs, email);
}



function protectionRangeOverlapsEditable_(protection, editableRanges) {
  const protectedRange = protection.getRange();
  const firstRow = protectedRange.getRow();
  const lastRow = protectedRange.getLastRow();
  const firstColumn = protectedRange.getColumn();
  const lastColumn = protectedRange.getLastColumn();
  return (editableRanges || []).some(editableRange =>
    firstRow <= editableRange.getLastRow() && lastRow >= editableRange.getRow() &&
    firstColumn <= editableRange.getLastColumn() && lastColumn >= editableRange.getColumn()
  );
}

function applyWorkbookProtectionSpecs_(spreadsheet, specs) {
  (specs || []).forEach(spec => {
    const sheet = spreadsheet.getSheetByName(spec.sheetName);
    if (!sheet) throw new Error(`Workbook is missing sheet: ${spec.sheetName}`);

    const sheetProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    const enforced = sheetProtections.filter(protection => !protection.isWarningOnly());
    if (enforced.length > 1) {
      throw new Error(`${spec.sheetName} has multiple enforced sheet protections; resolve them manually before migration/repair.`);
    }

    let protection = enforced[0] || sheetProtections[0] || null;
    if (protection && !protection.canEdit()) {
      throw new Error(`Automation cannot update the existing sheet protection on ${spec.sheetName}.`);
    }
    if (!protection) protection = sheet.protect();

    const editable = normaliseA1Ranges_(spec.editable);
    const editableRanges = editable.map(a1 => sheet.getRange(a1));
    const conflictingRangeProtections = sheet
      .getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .filter(rangeProtection =>
        !rangeProtection.isWarningOnly() &&
        protectionRangeOverlapsEditable_(rangeProtection, editableRanges)
      );
    if (conflictingRangeProtections.length) {
      throw new Error(
        `${spec.sheetName} has ${conflictingRangeProtections.length} range protection(s) ` +
        'overlapping approved grantee-editable cells. Remove or adjust only those protections.'
      );
    }
    protection
      .setDescription(spec.description || `APFP client protection - ${spec.sheetName}`)
      .setWarningOnly(false)
      .setUnprotectedRanges(editableRanges);
    hardenProtectionEditors_(protection, spreadsheet);

    if (spec.hidden === true && !sheet.isSheetHidden()) sheet.hideSheet();
    if (spec.hidden === false && sheet.isSheetHidden()) sheet.showSheet();
  });
}

function ensureWorkbookProtectionSpecs_(spreadsheet, specs) {
  try {
    // Generated workbooks are protected and verified before initial sharing.
    // Approval should not rewrite a valid protection merely to confirm it.
    return verifyWorkbookProtectionSpecs_(spreadsheet, specs);
  } catch (verificationError) {
    // Repair only when the existing protection structure is genuinely wrong.
    applyWorkbookProtectionSpecs_(spreadsheet, specs);
    SpreadsheetApp.flush();
    return verifyWorkbookProtectionSpecs_(spreadsheet, specs);
  }
}

function verifyWorkbookProtectionSpecs_(spreadsheet, specs) {


  (specs || []).forEach(spec => {
    const sheet = spreadsheet.getSheetByName(spec.sheetName);
    if (!sheet) throw new Error(`Workbook is missing sheet during integrity verification: ${spec.sheetName}`);

    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)
      .filter(protection => !protection.isWarningOnly());
    if (protections.length !== 1) {
      throw new Error(`${spec.sheetName} must have exactly one enforced sheet protection; found ${protections.length}.`);
    }

    const protection = protections[0];
    const actualRanges = normaliseA1Ranges_(
      protection.getUnprotectedRanges().map(range => range.getA1Notation())
    );
    const expectedRanges = normaliseA1Ranges_(spec.editable);
    if (
      actualRanges.length !== expectedRanges.length ||
      actualRanges.some((a1, index) => a1 !== expectedRanges[index])
    ) {
      throw new Error(
        `Protection mismatch on ${spec.sheetName}. Expected editable ranges: ` +
        `${expectedRanges.join(', ') || 'none'}; actual: ${actualRanges.join(', ') || 'none'}.`
      );
    }

    const expectedEditableRanges = expectedRanges.map(a1 => sheet.getRange(a1));
    const rangeProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .filter(rangeProtection =>
        !rangeProtection.isWarningOnly() &&
        protectionRangeOverlapsEditable_(rangeProtection, expectedEditableRanges)
      );
    if (rangeProtections.length) {
      throw new Error(
        `${spec.sheetName} has ${rangeProtections.length} range protection(s) ` +
        'overlapping approved grantee-editable cells.'
      );
    }


    if (spec.hidden === true && !sheet.isSheetHidden()) {
      throw new Error(`${spec.sheetName} must remain hidden.`);
    }
    if (spec.hidden === false && sheet.isSheetHidden()) {
      throw new Error(`${spec.sheetName} must remain visible.`);
    }
  });
  return true;
}

function setupWorkbookProtectionSpecs_(fieldConfig) {
  const editableBySheet = {};
  (fieldConfig || []).forEach(row => {
    if (key_(row['Grantee Editable?']) !== 'yes') return;
    const sheetName = clean_(row['Sheet Name']);
    const editableA1 = configEditableRange_(row);
    if (!sheetName || !editableA1) {
      throw new Error(`Field Config has no editable range for ${row['Field Code'] || 'an unnamed field'}.`);
    }
    (editableBySheet[sheetName] || (editableBySheet[sheetName] = [])).push(editableA1);
  });

  return APFP.GENERATED_VISIBLE_SHEETS.map(sheetName => ({
    sheetName,
    editable: normaliseA1Ranges_(editableBySheet[sheetName]),
    hidden: false
  })).concat([{
    sheetName: APFP.TEMPLATE_SHEETS.REGISTRY_EXPORT,
    editable: [],
    hidden: true
  }]);
}

function outcomeWorkbookProtectionSpecs_() {
  const outcomeSchema = APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE;
  const disbursementSchema =
    APFP.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE;

  return [
    {
      sheetName: APFP.TEMPLATE_SHEETS.LINKS,
      editable: [],
      hidden: false
    },
    {
      sheetName: APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES,
      editable: outcomeSchema.EDITABLE_RANGES,
      hidden: false
    },
    {
      sheetName: APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS,
      editable: [disbursementSchema.EDITABLE_RANGE],
      hidden: false
    },
    {
      sheetName: APFP.OUTCOME_TEMPLATE_SHEETS.YEAR_END,
      editable: outcomeSchema.YEAR_END_EDITABLE_RANGES,
      hidden: false
    },
    {
      sheetName: APFP.OUTCOME_TEMPLATE_SHEETS.TRACKER_EXPORT,
      editable: [],
      hidden: true
    }
  ];
}

function transactionalWorkbookProtectionSpecs_() {
  return [{
    sheetName: APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS,
    editable: [APFP.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE.EDITABLE_RANGE],
    hidden: false
  }];
}

function spreadsheetTimeZoneMatches_(actual) {
  const wanted = APFP.TIME_ZONE;
  const equivalents = new Set([wanted, 'Asia/Calcutta']);
  return equivalents.has(clean_(actual));
}

function ensureSpreadsheetTimeZone_(spreadsheet) {
  if (!spreadsheetTimeZoneMatches_(spreadsheet.getSpreadsheetTimeZone())) {
    spreadsheet.setSpreadsheetTimeZone(APFP.TIME_ZONE);
  }
}

function verifySpreadsheetTimeZone_(spreadsheet, label) {
  const actual = spreadsheet.getSpreadsheetTimeZone();
  if (!spreadsheetTimeZoneMatches_(actual)) {
    throw new Error(
      `${label || spreadsheet.getName()} timezone must be ${APFP.TIME_ZONE}; found ${actual}.`
    );
  }
}

function applyOutcomeWorkbookProtections_(spreadsheet) {
  applyWorkbookProtectionSpecs_(spreadsheet, outcomeWorkbookProtectionSpecs_());
}

function verifyOutcomeWorkbookProtections_(spreadsheet) {
  return verifyWorkbookProtectionSpecs_(spreadsheet, outcomeWorkbookProtectionSpecs_());
}

function applyTransactionalWorkbookProtections_(spreadsheet) {
  applyWorkbookProtectionSpecs_(spreadsheet, transactionalWorkbookProtectionSpecs_());
}

function verifyTransactionalWorkbookProtections_(spreadsheet) {
  return verifyWorkbookProtectionSpecs_(
    spreadsheet,
    transactionalWorkbookProtectionSpecs_()
  );
}

function finaliseSetupWorkbookIntegrity_(spreadsheet, fieldConfig) {
  const specs = setupWorkbookProtectionSpecs_(fieldConfig);
  removeGeneratedAdminSheets_(spreadsheet);
  ensureSpreadsheetTimeZone_(spreadsheet);
  applyWorkbookProtectionSpecs_(spreadsheet, specs);
  SpreadsheetApp.flush();
  verifyGeneratedLinks_(spreadsheet);
  verifyWorkbookProtectionSpecs_(spreadsheet, specs);
  verifySpreadsheetTimeZone_(spreadsheet, 'Generated Grant Setup workbook');
  return true;
}

function finaliseOutcomeWorkbookIntegrity_(spreadsheet) {
  removeGeneratedAdminSheet_(spreadsheet, APFP.OUTCOME_TEMPLATE_SHEETS.FIELD_CONFIG);
  ensureSpreadsheetTimeZone_(spreadsheet);
  applyOutcomeWorkbookProtections_(spreadsheet);
  SpreadsheetApp.flush();
  verifyOutcomeWorkbookLinks_(spreadsheet);
  verifyOutcomeWorkbookProtections_(spreadsheet);
  verifySpreadsheetTimeZone_(spreadsheet, 'Generated Outcome Progress workbook');
  return true;
}

function finaliseTransactionalWorkbookIntegrity_(spreadsheet) {
  ensureSpreadsheetTimeZone_(spreadsheet);
  applyTransactionalWorkbookProtections_(spreadsheet);
  SpreadsheetApp.flush();
  verifyTransactionalWorkbookProtections_(spreadsheet);
  verifySpreadsheetTimeZone_(spreadsheet, 'Generated Transactional Disbursement workbook');
  return true;
}

function removeWorkspaceGranteeProtectionAccess_(requestId, config, emailOverride) {
  const tech = techByRequest_(requestId);
  if (!tech) throw new Error(`No Technical Registry record exists for Request ID ${requestId}.`);

  const effectiveConfig = config || config_();
  const record = tech.record;
  const email = clean_(emailOverride || record['Primary Contact Email']);
  if (!email) return true;

  if (isTransactionalGrantType_(record['Grant Type'])) {
    const workbookUrl = clean_(record['Disbursement Workbook URL']);
    if (!workbookUrl) throw new Error('Transactional Disbursement workbook is missing during grantee protection check.');
    return removeGranteeProtectionAccess_(
      openSpreadsheetCached_(urlId_(workbookUrl)),
      transactionalWorkbookProtectionSpecs_(),
      email
    );
  }

  const setupUrl = clean_(record['Setup Workbook URL']);
  const outcomeUrl = clean_(record['Outcome Progress Workbook URL']);
  if (!setupUrl || !outcomeUrl) {
    throw new Error('Grant Setup or Outcome Progress workbook is missing during grantee protection check.');
  }

  const fieldConfig = templateFieldConfigRows_(clean_(effectiveConfig.SETUP_TEMPLATE_ID));
  removeGranteeProtectionAccess_(
    openSpreadsheetCached_(urlId_(setupUrl)),
    setupWorkbookProtectionSpecs_(fieldConfig),
    email
  );
  removeGranteeProtectionAccess_(
    openSpreadsheetCached_(urlId_(outcomeUrl)),
    outcomeWorkbookProtectionSpecs_(),
    email
  );
  return true;
}

function assertWorkspaceFilesSafeToShare_(requestId, config, emailOverride) {
  const tech = techByRequest_(requestId);
  if (!tech) throw new Error(`No Technical Registry record exists for Request ID ${requestId}.`);

  const effectiveConfig = config || config_();
  const record = tech.record;
  if (isTransactionalGrantType_(record['Grant Type'])) {
    const workbookUrl = clean_(record['Disbursement Workbook URL']);
    if (!workbookUrl) throw new Error('Transactional Disbursement workbook is missing before sharing.');
    const workbook = openSpreadsheetCached_(urlId_(workbookUrl));
    verifyTransactionalWorkbookProtections_(workbook);
    verifyGranteeProtectionAccess_(workbook, transactionalWorkbookProtectionSpecs_(), clean_(emailOverride || record['Primary Contact Email']));
    verifySpreadsheetTimeZone_(workbook, 'Transactional Disbursement workbook');
    return true;
  }

  const setupUrl = clean_(record['Setup Workbook URL']);
  const outcomeUrl = clean_(record['Outcome Progress Workbook URL']);
  if (!setupUrl || !outcomeUrl) {
    throw new Error('Grant Setup or Outcome Progress workbook is missing before sharing.');
  }

  const fieldConfig = templateFieldConfigRows_(clean_(effectiveConfig.SETUP_TEMPLATE_ID));
  const setup = openSpreadsheetCached_(urlId_(setupUrl));
  verifyGeneratedLinks_(setup);
  verifyTemplateProtections_(setup, fieldConfig);
  verifyGranteeProtectionAccess_(setup, setupWorkbookProtectionSpecs_(fieldConfig), clean_(emailOverride || record['Primary Contact Email']));
  verifySpreadsheetTimeZone_(setup, 'Grant Setup workbook');

  const outcome = openSpreadsheetCached_(urlId_(outcomeUrl));
  verifyOutcomeWorkbookLinks_(outcome);
  verifyOutcomeWorkbookProtections_(outcome);
  verifyGranteeProtectionAccess_(outcome, outcomeWorkbookProtectionSpecs_(), clean_(emailOverride || record['Primary Contact Email']));
  verifySpreadsheetTimeZone_(outcome, 'Outcome Progress workbook');
  return true;
}

function repairWorkspaceFilesBeforeRetrySharing_(requestId, config) {
  const tech = techByRequest_(requestId);
  if (!tech) throw new Error(`No Technical Registry record exists for Request ID ${requestId}.`);

  const effectiveConfig = config || config_();
  const record = tech.record;
  if (isTransactionalGrantType_(record['Grant Type'])) {
    const workbookUrl = clean_(record['Disbursement Workbook URL']);
    if (!workbookUrl) throw new Error('Transactional Disbursement workbook is missing before sharing.');
    const workbook = openSpreadsheetCached_(urlId_(workbookUrl));
    finaliseTransactionalWorkbookIntegrity_(workbook);
    removeGranteeProtectionAccess_(workbook, transactionalWorkbookProtectionSpecs_(), record['Primary Contact Email']);
    return assertWorkspaceFilesSafeToShare_(requestId, effectiveConfig);
  }

  const setupUrl = clean_(record['Setup Workbook URL']);
  const outcomeUrl = clean_(record['Outcome Progress Workbook URL']);
  if (!setupUrl || !outcomeUrl) {
    throw new Error('Grant Setup or Outcome Progress workbook is missing before sharing.');
  }

  const fieldConfig = templateFieldConfigRows_(clean_(effectiveConfig.SETUP_TEMPLATE_ID));
  const setup = openSpreadsheetCached_(urlId_(setupUrl));
  const outcome = openSpreadsheetCached_(urlId_(outcomeUrl));
  finaliseSetupWorkbookIntegrity_(setup, fieldConfig);
  finaliseOutcomeWorkbookIntegrity_(outcome);
  removeGranteeProtectionAccess_(setup, setupWorkbookProtectionSpecs_(fieldConfig), record['Primary Contact Email']);
  removeGranteeProtectionAccess_(outcome, outcomeWorkbookProtectionSpecs_(), record['Primary Contact Email']);
  return assertWorkspaceFilesSafeToShare_(requestId, effectiveConfig);
}



function verifyCentralAdminSystemSheetState_() {
  (APFP.HIDDEN_SYSTEM_SHEETS || []).forEach(sheetName => {
    const sheet = ss_().getSheetByName(sheetName);
    if (!sheet) throw new Error(`Required system sheet is missing: ${sheetName}`);
    if (!sheet.isSheetHidden()) throw new Error(`${sheetName} must remain hidden.`);
  });
  return true;
}