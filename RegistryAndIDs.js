// RegistryAndIDs.gs — stable organisation, grant, workspace, request, and outcome IDs.
const REGISTRY_CACHE_ = {
 organisations: null,
 grants: null,
 technical: null
};
function registryCacheKeyForSheet_(sheetName) {
 if (sheetName === APFP.SHEETS.ORGANISATIONS) return 'organisations';
 if (sheetName === APFP.SHEETS.GRANTS) return 'grants';
 if (sheetName === APFP.SHEETS.TECHNICAL) return 'technical';
 return '';
}
function invalidateRegistryCacheForSheet_(sheetName) {
 const cacheKey = registryCacheKeyForSheet_(sheetName);
 if (cacheKey) REGISTRY_CACHE_[cacheKey] = null;
}
function updateRegistryCacheForWrite_(sheetName, rowNumber, patch, isAppend) {
 const cacheKey = registryCacheKeyForSheet_(sheetName), cache = cacheKey ? REGISTRY_CACHE_[cacheKey] : null;
 if (!cache) return;
 const found = cache.find(item => item.rowNumber === rowNumber);
 if (found) {
   Object.assign(found.record, patch || {});
   return;
 }
 if (isAppend) {
   cache.push({ rowNumber, record: Object.assign({}, patch || {}) });
   return;
 }
 REGISTRY_CACHE_[cacheKey] = null;
}
function registryRows_(sheetName, headerRow, cacheKey) {
 if (cacheKey && REGISTRY_CACHE_[cacheKey]) return REGISTRY_CACHE_[cacheKey];
 const sheet = sheet_(sheetName), out = [];
 if (sheet.getLastRow() > headerRow) {
   const width = sheet.getLastColumn(), headers = sheet.getRange(headerRow, 1, 1, width).getDisplayValues()[0],
     // Registry values are read raw so DATE/DATE_TIME and numeric Table fields
     // retain their native types regardless of the spreadsheet locale.
     rows = sheet.getRange(headerRow + 1, 1, sheet.getLastRow() - headerRow, width).getValues();
   rows.forEach((row, i) => out.push({ rowNumber: headerRow + 1 + i, record: rowObjectFromArrays_(headers, row) }));
 }
 if (cacheKey) REGISTRY_CACHE_[cacheKey] = out;
 return out;
}
function organisationRegistryRows_() {
 return registryRows_(APFP.SHEETS.ORGANISATIONS, 1, 'organisations');
}
function grantRegistryRows_() {
 return registryRows_(APFP.SHEETS.GRANTS, 1, 'grants');
}
function technicalRegistryRows_() {
 return registryRows_(APFP.SHEETS.TECHNICAL, 2, 'technical');
}
function organisationRecordsByName_(organisationName) {
 const wanted = key_(organisationName);
 if (!wanted) return [];
 return organisationRegistryRows_().filter(x => key_(x.record['Organisation Name']) === wanted);
}
function uniqueOrganisationId_(organisationName, firstFy) {
  const existing = new Set(
    organisationRegistryRows_().map(item => key_(item.record['Organisation ID'])).filter(Boolean)
  );
  const prefix = `${prefix5_(organisationName)}_${financialYearCode_(firstFy)}_`;
  for (let i = 0; i < 1000; i++) {
    const candidate = `${prefix}${Math.floor(100 + Math.random() * 900)}`;
    if (!existing.has(key_(candidate))) return candidate;
  }
  throw new Error('Could not generate a unique Organisation ID after 1000 attempts.');
}
function uniqueGrantId_(organisationName, projectTitle, fy) {
 const existing = new Set(grantRegistryRows_().map(x => key_(x.record['Grant ID'])).filter(Boolean)),
   prefix = `${prefix5_(organisationName)}_${prefix5_(projectTitle)}_${financialYearCode_(fy)}_`;
 for (let i = 0; i < 1000; i++) {
   const candidate = `${prefix}${Math.floor(100 + Math.random() * 900)}`;
   if (!existing.has(key_(candidate))) return candidate;
 }
 throw new Error('Could not generate a unique Grant ID after 1000 attempts.');
}
function activeOrganisationRecordsByName_(organisationName) {
  const wanted = key_(organisationName);
  if (!wanted) return [];
  return organisationRegistryRows_().filter(item => {
    const record = item.record, status = key_(record['Record Status']);
    return key_(record['Organisation Name']) === wanted && status !== 'inactive';
  });
}
function organisationById_(organisationId) {
 const wanted = key_(organisationId);
 if (!wanted) return null;
 const rows = organisationRegistryRows_().filter(x => key_(x.record['Organisation ID']) === wanted);
 if (!rows.length) return null;
 if (rows.length > 1) throw new Error(`Duplicate Organisation ID found: ${organisationId}`);
 return rows[0];
}
function resolveOrganisation_(request, existingTechRecord) {
  const savedId = clean_(existingTechRecord && existingTechRecord['Organisation ID']);
  if (savedId) {
    const saved = organisationById_(savedId);
    if (saved) return saved.record;
  }
  const matches = activeOrganisationRecordsByName_(request.organisationName);
  if (request.organisationType === 'Returning Organisation') {
    if (matches.length !== 1)
      throw new Error(`Returning Organisation must exactly match one Organisation Registry row. Found ${matches.length}.`);
    const row = matches[0], patch = {
      'Organisation Name': request.organisationName,
      'Record Status': APFP.ACTIVE
    };
    setByHeaders_(APFP.SHEETS.ORGANISATIONS, 1, row.rowNumber, patch);
    return Object.assign({}, row.record, patch);
  }
  if (matches.length)
    throw new Error('This organisation already exists. Choose Returning Organisation and use the exact Organisation Registry name.');
  const patch = {
    'Organisation ID': uniqueOrganisationId_(request.organisationName, request.financialYear),
    'Organisation Name': request.organisationName,
    'Record Status': APFP.ACTIVE
  };
  appendObject_(APFP.SHEETS.ORGANISATIONS, 1, patch);
  return patch;
}
function refreshOrganisationRegistryEntry_(organisationId, organisationName) {
  const existing = organisationById_(organisationId);
  if (!existing) return;
  const patch = {};
  if (organisationName && comparable_(existing.record['Organisation Name']) !== comparable_(organisationName))
    patch['Organisation Name'] = organisationName;
  if (!clean_(existing.record['Record Status'])) patch['Record Status'] = APFP.ACTIVE;
  if (Object.keys(patch).length) setByHeaders_(APFP.SHEETS.ORGANISATIONS, 1, existing.rowNumber, patch);
}
function organisationNameOptions_() {
 return [...new Set(organisationRegistryRows_()
   .filter(item => key_(item.record['Record Status']) !== 'inactive')
   .map(item => clean_(item.record['Organisation Name']))
   .filter(Boolean))]
   .sort((a, b) => key_(a).localeCompare(key_(b)));
}
function applyWorkspaceOrganisationDropdown_() {
  const intake = sheet_(APFP.SHEETS.INTAKE), organisations = sheet_(APFP.SHEETS.ORGANISATIONS);
  const source = organisations.getRange(2, 2, Math.max(1, organisations.getMaxRows() - 1), 1);
  const target = intake.getRange(
    APFP.INTAKE.START_ROW, intakeColumn_('Organisation Name'),
    APFP.INTAKE.MAX_ROW - APFP.INTAKE.START_ROW + 1, 1
  );
  target.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(source, true).setAllowInvalid(true).build()
  ).clearNote();
  return target.getNumRows();
}
function returningOrganisationValidation_(options) {
 if (!options.length) return null;
 return SpreadsheetApp.newDataValidation()
   .requireValueInList(options, true)
   .setAllowInvalid(false)
   .build();
}
function applyOrganisationValidationForRow_(rowNumber) {
  if (rowNumber < APFP.INTAKE.START_ROW || rowNumber > APFP.INTAKE.MAX_ROW) return;
  const intake = sheet_(APFP.SHEETS.INTAKE);
  const type = clean_(intake.getRange(rowNumber, intakeColumn_('Organisation Type')).getDisplayValue());
  const cell = intake.getRange(rowNumber, intakeColumn_('Organisation Name'));
  const options = type === 'Returning Organisation' ? organisationNameOptions_() : [];
  const rule = returningOrganisationValidation_(options);
  rule ? cell.setDataValidation(rule) : cell.clearDataValidations();
  cell.clearNote();
}
function latestGrantForOrganisation_(organisationId, organisationName) {
  const id = key_(organisationId), name = key_(organisationName);
  const rows = grantRegistryRows_().filter(item => {
    const record = item.record;
    return (id ? key_(record['Organisation ID']) === id : key_(record['Organisation Name']) === name) &&
      key_(record['Record Status']) !== 'inactive';
  });
  rows.sort((a, b) => {
    const fyDifference = (financialYearStart_(b.record['Financial Year']) || 0) -
      (financialYearStart_(a.record['Financial Year']) || 0);
    if (fyDifference) return fyDifference;
    const bDate = dateValue_(b.record['Grant Start Date']), aDate = dateValue_(a.record['Grant Start Date']);
    return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0) || b.rowNumber - a.rowNumber;
  });
  return rows.find(item => {
    const record = item.record;
    return clean_(record['Thematic Area']) || clean_(record['Thematic Sub-area']) ||
      clean_(record['Proximity to Children / Beneficiary']);
  }) || rows[0] || null;
}
function prefillReturningGrantClassificationForRow_(rowNumber) {
  if (rowNumber < APFP.INTAKE.START_ROW || rowNumber > APFP.INTAKE.MAX_ROW) return false;
  const intake = sheet_(APFP.SHEETS.INTAKE);
  const type = clean_(
    intake.getRange(rowNumber, intakeColumn_('Organisation Type')).getDisplayValue()
  );
  if (type !== 'Returning Organisation') return false;

  const organisationName = clean_(
    intake.getRange(rowNumber, intakeColumn_('Organisation Name')).getDisplayValue()
  );
  const matches = activeOrganisationRecordsByName_(organisationName);
  if (matches.length !== 1) return false;

  const latest = latestGrantForOrganisation_(
    matches[0].record['Organisation ID'],
    organisationName
  );
  if (!latest) return false;

  setByHeaders_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, rowNumber, {
    'Thematic Area': clean_(latest.record['Thematic Area']),
    'Thematic Sub-area': clean_(latest.record['Thematic Sub-area']),
    'Proximity to Children / Beneficiary': clean_(latest.record['Proximity to Children / Beneficiary'])
  });
  return true;
}

function grantById_(grantId) {
 const wanted = key_(grantId);
 if (!wanted) return null;
 const rows = grantRegistryRows_().filter(x => key_(x.record['Grant ID']) === wanted);
 if (!rows.length) return null;
 if (rows.length > 1) throw new Error(`Duplicate Grant ID found: ${grantId}`);
 return rows[0];
}
function findDuplicateGrant_(ownRequestId, ownGrantId, organisationName, financialYear, organisationId) {
 const ownOrgId = key_(organisationId), ownOrgName = key_(organisationName), ownFy = key_(financialYear), ownGrant = key_(ownGrantId), ownRequest = key_(ownRequestId);
 const grantDuplicate = grantRegistryRows_().some(x => {
   const r = x.record, different = !ownGrant || key_(r['Grant ID']) !== ownGrant,
     sameOrg = ownOrgId ? key_(r['Organisation ID']) === ownOrgId : key_(r['Organisation Name']) === ownOrgName;
   return different && sameOrg && key_(r['Financial Year']) === ownFy && key_(r['Record Status']) === 'active';
 });
 if (grantDuplicate) return true;
 return technicalRegistryRows_().some(x => {
   const r = x.record, different = key_(r['Request ID']) !== ownRequest,
     sameOrg = ownOrgId ? key_(r['Organisation ID']) === ownOrgId : key_(r['Organisation Name']) === ownOrgName;
   return different && sameOrg && key_(r['Financial Year']) === ownFy && key_(r['Record Status']) === 'active' &&
     ['in progress', 'needs attention', 'workspace created', 'sharing pending', 'completed']
       .includes(key_(r['Workspace Status']));
 });
}
function updateGrantTitleReferences_(grantId, projectTitle) {
  [
    { sheetName: APFP.SHEETS.OUTCOMES, headerRow: APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.OUTCOMES },
    { sheetName: APFP.SHEETS.SUPPORT, headerRow: APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.SUPPORT },
    { sheetName: APFP.SHEETS.DECISIONS, headerRow: APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DECISIONS },
    { sheetName: APFP.SHEETS.DISBURSEMENTS, headerRow: APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DISBURSEMENTS }
  ].forEach(spec => {
    findRows_(spec.sheetName, spec.headerRow, 'Grant ID', grantId).forEach(rowNumber => {
      setByHeaders_(spec.sheetName, spec.headerRow, rowNumber, { 'Grant Title': projectTitle });
    });
  });
}

function correctedWorkspaceWorkbookTargets_(techRecord) {
  const targets = [];
  const setupId = clean_(techRecord['Setup Workbook URL'])
    ? urlId_(techRecord['Setup Workbook URL']) : '';
  if (setupId) {
    const config = config_();
    const titleField = templateFieldConfigRows_(clean_(config.SETUP_TEMPLATE_ID))
      .find(row => key_(row['Field Code']) === 'project_title');
    if (!titleField) throw new Error('Setup Field Config is missing project_title.');
    const setup = openSpreadsheetCached_(setupId);
    const setupSheet = setup.getSheetByName(clean_(titleField['Sheet Name']));
    if (!setupSheet)
      throw new Error(`Generated Setup workbook is missing ${titleField['Sheet Name']}.`);
    targets.push(setupSheet.getRange(configValueRange_(titleField)));
  }

  const outcomeId = clean_(techRecord['Outcome Progress Workbook URL'])
    ? urlId_(techRecord['Outcome Progress Workbook URL']) : '';
  if (outcomeId) {
    const outcome = openSpreadsheetCached_(outcomeId);
    const outcomeSheet = outcome.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES);
    if (!outcomeSheet) throw new Error('Generated Outcome workbook is missing Outcome Progress.');
    targets.push(outcomeSheet.getRange(APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE.GRANT_TITLE_CELL));
  }
  return targets;
}

function correctWorkspaceDetailsForRow_(rowNumber) {
  const row = rowObject_(APFP.SHEETS.INTAKE, APFP.INTAKE.HEADER_ROW, rowNumber);
  const grantId = clean_(row['Grant ID']);
  const requestId = clean_(row['Request ID']);
  if (!grantId || !requestId) throw new Error('The selected row has no Grant ID or Request ID.');

  const grant = grantById_(grantId);
  const tech = techByRequest_(requestId);
  if (!grant || !tech || key_(tech.record['Grant ID']) !== key_(grantId))
    throw new Error('The selected row is not linked to one unambiguous created grant.');
  if (!['workspace created', 'registry only'].includes(key_(tech.record['Workspace Status'])))
    throw new Error('Correct Workspace Details is available only after workspace or registry creation.');

  const projectTitle = clean_(row['Grant Title']);
  const amountApproved = parseAdminTableNumber_(row['Amount Approved']);
  if (!projectTitle) throw new Error('Grant Title cannot be blank.');
  if (amountApproved === '' || amountApproved == null || amountApproved < 0)
    throw new Error('Amount Approved must be a non-negative amount.');

  const organisationType = clean_(row['Organisation Type']);
  if (!['New Organisation', 'Returning Organisation'].includes(organisationType))
    throw new Error('Organisation Type must be New Organisation or Returning Organisation.');
  const patch = {
    'Project Title': projectTitle,
    'Thematic Area': clean_(row['Thematic Area']),
    'Thematic Sub-area': clean_(row['Thematic Sub-area']),
    'Proximity to Children / Beneficiary': clean_(row['Proximity to Children / Beneficiary']),
    'Amount Approved': amountApproved,
    'Last Updated At': now_()
  };
  const workbookTargets = correctedWorkspaceWorkbookTargets_(tech.record);

  setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, patch);
  saveTech_(requestId, {
    'Project Title': projectTitle,
    'Amount Approved': amountApproved,
    'Organisation Type': organisationType,
    'Last Error Code': '',
    'Last Error Message': ''
  });
  workbookTargets.forEach(range => range.setValue(projectTitle));
  updateGrantTitleReferences_(grantId, projectTitle);
  ensureOrganisationMaturityRowsForGrant_(grantId);
  setIntake_(rowNumber, {
    'Grant Title': projectTitle,
    'Thematic Area': patch['Thematic Area'],
    'Thematic Sub-area': patch['Thematic Sub-area'],
    'Proximity to Children / Beneficiary': patch['Proximity to Children / Beneficiary'],
    'Amount Approved': amountApproved,
    'Organisation Type': organisationType,
    'Last Updated': now_()
  });

  SpreadsheetApp.flush();
  return { grantId: grantId, projectTitle: projectTitle };
}

function upsertGrantShell_(grantId, organisationId, request, setupUrl, outcomeWorkbookUrl) {
 const existing = grantById_(grantId), timestamp = now_(), transactional = isTransactionalGrantType_(request.grantType),
   registryOnly = transactional || isDiscretionaryGrantType_(request.grantType),
   patch = {
     'Grant ID': grantId, 'Financial Year': request.financialYear,
     'Grant Start Quarter': request.grantStartQuarter || grantQuarterFromDate_(request.grantStartDate),
     'Organisation ID': organisationId, 'Organisation Name': request.organisationName,
     'Thematic Area': request.thematicArea || '',
     'Thematic Sub-area': request.thematicSubarea || '',
     'Proximity to Children / Beneficiary': request.proximity || '',
     'Project Title': request.projectTitle, 'Grant Start Date': request.grantStartDate,
     'Grant End Date': request.grantEndDate, 'Grant Type': request.grantType || '',
     'Amount Approved': request.amountApproved == null ? '' : request.amountApproved,
     'Grant Status': isDiscretionaryGrantType_(request.grantType)
       ? 'Complete'
       : (existing ? grantStatusOrDefault_(existing.record['Grant Status']) : grantStatusOrDefault_(request.grantStatus)),
     'Source Setup Workbook URL': registryOnly ? '' : (setupUrl || (existing && existing.record['Source Setup Workbook URL']) || ''),
     'Master Data Sync Status': registryOnly ? 'Not Applicable' : ((existing && existing.record['Master Data Sync Status']) || 'Awaiting Review'),
     'Setup Created At': registryOnly ? ((existing && existing.record['Setup Created At']) || '') : ((existing && existing.record['Setup Created At']) || timestamp),
     'Primary Contact Email': request.granteeEmail, 'Last Updated At': timestamp, 'Record Status': APFP.ACTIVE
   };
 const rowNumber = existing
   ? (setByHeaders_(APFP.SHEETS.GRANTS, 1, existing.rowNumber, patch), existing.rowNumber)
   : appendObject_(APFP.SHEETS.GRANTS, 1, patch);
 refreshOrganisationRegistryEntry_(organisationId, request.organisationName);
 ensureOrganisationMaturityRowsForGrant_(grantId);
 return rowNumber;
}
function maturityCatalogue_() {
 const range = ss_().getRangeByName(APFP.MATURITY.CATALOGUE_NAMED_RANGE);
 if (!range) throw new Error(`Missing named range ${APFP.MATURITY.CATALOGUE_NAMED_RANGE}.`);
 const raw = range.getDisplayValues(), rows = [], seenIndicators = new Set();
 raw.forEach((values, index) => {
   const aspect = clean_(values[0]), indicator = clean_(values[1]);
   if (!aspect && !indicator) return;
   if (!aspect || !indicator)
     throw new Error(`Maturity Catalogue row ${index + 1} must contain both Aspect and Indicator.`);
   const indicatorKey = key_(indicator);
   if (seenIndicators.has(indicatorKey))
     throw new Error(`Duplicate maturity Indicator in the catalogue: ${indicator}`);
   seenIndicators.add(indicatorKey);
   rows.push({ aspect, indicator });
 });
 if (rows.length !== APFP.MATURITY.EXPECTED_INDICATOR_COUNT)
   throw new Error(`Maturity Catalogue must contain exactly ${APFP.MATURITY.EXPECTED_INDICATOR_COUNT} indicators; found ${rows.length}.`);
 return rows;
}
function maturityStatusOptions_() {
 const range = ss_().getRangeByName(APFP.MATURITY.STATUS_NAMED_RANGE);
 if (!range) throw new Error(`Missing named range ${APFP.MATURITY.STATUS_NAMED_RANGE}.`);
 const values = range.getDisplayValues().flat().map(clean_).filter(Boolean);
 if (values.length !== APFP.MATURITY.EXPECTED_STATUS_COUNT || new Set(values.map(key_)).size !== values.length)
   throw new Error(`Maturity Status catalogue must contain exactly ${APFP.MATURITY.EXPECTED_STATUS_COUNT} unique values.`);
 return values;
}
function maturityAspectOptions_() {
 const seen = new Set();
 return maturityCatalogue_().map(item => item.aspect)
   .filter(value => !seen.has(key_(value)) && seen.add(key_(value)));
}
function maturityIndicatorOptions_() {
 return maturityCatalogue_().map(item => item.indicator);
}
function ensureOrganisationMaturityRowsForGrant_(grantId) {
 const grant = grantById_(grantId);
 if (!grant) throw new Error(`Cannot create maturity rows because Grant ID was not found: ${grantId}`);
 const sheet = sheet_(APFP.SHEETS.MATURITY), headerRow = APFP.MATURITY.HEADER_ROW,
   headers = APFP.MATURITY.HEADERS, map = headerMap_(sheet, headerRow),
   catalogue = maturityCatalogue_(), existing = {}, lastRow = sheet.getLastRow();
 if (lastRow >= APFP.MATURITY.START_ROW) {
   const values = sheet.getRange(APFP.MATURITY.START_ROW, 1,
     lastRow - APFP.MATURITY.START_ROW + 1, headers.length).getValues();
   values.forEach((row, offset) => {
     const record = rowObjectFromArrays_(headers, row);
     if (key_(record['Grant ID']) !== key_(grantId)) return;
     const indicatorKey = key_(record['Indicator']);
     if (!indicatorKey) return;
     if (existing[indicatorKey])
       throw new Error(`Duplicate maturity row for Grant ID ${grantId} and Indicator ${record['Indicator']}.`);
     existing[indicatorKey] = { rowNumber: APFP.MATURITY.START_ROW + offset, record };
   });
 }
 const base = {
   'Financial Year': grant.record['Financial Year'],
   'Grant ID': grant.record['Grant ID'],
   'Organisation Name': grant.record['Organisation Name'],
   'Grant Title': grant.record['Project Title']
 }, missing = [];
 catalogue.forEach(item => {
   const found = existing[key_(item.indicator)],
     patch = Object.assign({}, base, { 'Aspect': item.aspect, 'Indicator': item.indicator });
   if (found) { if (patchDiffersFromRecord_(found.record, patch)) setByHeaders_(APFP.SHEETS.MATURITY, headerRow, found.rowNumber, patch); }
   else missing.push(patch);
 });
 if (!missing.length) return 0;
 const startRow = Math.max(APFP.MATURITY.START_ROW, sheet.getLastRow() + 1),
   requiredLastRow = startRow + missing.length - 1;
 if (requiredLastRow > sheet.getMaxRows()) {
   sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows() + ADMIN_TABLE_GROWTH_ROWS_);
   extendAdminTableRows_(APFP.SHEETS.MATURITY);
 }
 const output = missing.map(record => headers.map(header =>
   Object.prototype.hasOwnProperty.call(record, header) ? record[header] : ''));
 sheet.getRange(startRow, 1, output.length, headers.length)
   .setValues(output).setFontFamily(APFP.FONT_FAMILY);
 return missing.length;
}
function techByRequest_(requestId) {
 const wanted = key_(requestId);
 if (!wanted) return null;
 const rows = technicalRegistryRows_().filter(x => key_(x.record['Request ID']) === wanted);
 if (!rows.length) return null;
 if (rows.length > 1) throw new Error(`Duplicate Request ID found in Technical Registry: ${requestId}`);
 return rows[0];
}
function techByGrantId_(grantId) {
 const wanted = key_(grantId);
 if (!wanted) return null;
 const rows = technicalRegistryRows_().filter(x => key_(x.record['Grant ID']) === wanted && key_(x.record['Record Status']) === 'active');
 if (!rows.length) return null;
 if (rows.length > 1) throw new Error(`Duplicate active Grant ID found in Technical Registry: ${grantId}`);
 return rows[0];
}
function patchDiffersFromRecord_(record, patch) {
 return Object.keys(patch || {}).some(header => {
   const current = record ? record[header] : '' , next = patch[header];
   if (next instanceof Date) {
     const oldDate = dateValue_(current);
     return !oldDate || oldDate.getTime() !== next.getTime();
   }
   if (typeof next === 'number') return Number(current) !== next;
   return comparable_(current) !== comparable_(next);
 });
}
function saveTech_(requestId, patch) {
 const found = techByRequest_(requestId),
   base = Object.assign({ 'Request ID': requestId, 'Record Status': APFP.ACTIVE }, patch || {});
 if (!found) {
   const timestamp = now_(), payload = Object.assign({}, base, {
     'Created At': base['Created At'] || timestamp, 'Last Updated At': timestamp
   }), rowNumber = appendObject_(APFP.SHEETS.TECHNICAL, 2, payload);
   return { rowNumber, record: Object.assign({}, payload) };
 }
 if (!patchDiffersFromRecord_(found.record, base)) return found;
 const payload = Object.assign({}, base, { 'Last Updated At': now_() }),
   record = Object.assign({}, found.record, payload);
 // The cached record is current (every write in this run updates it), so the row is not re-read from the sheet.
 setByHeaders_(APFP.SHEETS.TECHNICAL, 2, found.rowNumber, payload, found.record);
 return { rowNumber: found.rowNumber, record };
}
function updateGrantStatus_(grantId, status) {
 if (!validGrantStatus_(status)) throw new Error('Grant Status must be Active, Discontinued, or Complete.');
 const grant = grantById_(grantId);
 if (!grant) throw new Error(`Grant ID not found: ${grantId}`);
 if (key_(grant.record['Grant Status']) !== key_(status))
   setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, { 'Grant Status': status, 'Last Updated At': now_() });
 refreshOrganisationRegistryEntry_(grant.record['Organisation ID'], grant.record['Organisation Name']);
}