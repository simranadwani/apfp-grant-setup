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
    // The registered name is kept exactly as it is (a Returning Organisation only has to match it); only the status is refreshed.
    const row = matches[0], patch = { 'Record Status': APFP.ACTIVE };
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
// An organisation's registered name is never changed by saving a grant or changing a Grant Status (an older grant's stored name
// must not overwrite it). Only a blank Record Status is filled in.
function refreshOrganisationRegistryEntry_(organisationId) {
  const existing = organisationById_(organisationId);
  if (!existing) return;
  if (!clean_(existing.record['Record Status']))
    setByHeaders_(APFP.SHEETS.ORGANISATIONS, 1, existing.rowNumber, { 'Record Status': APFP.ACTIVE });
}
function organisationNameOptions_() {
 return [...new Set(organisationRegistryRows_()
   .filter(item => key_(item.record['Record Status']) !== 'inactive')
   .map(item => clean_(item.record['Organisation Name']))
   .filter(Boolean))]
   .sort((a, b) => key_(a).localeCompare(key_(b)));
}
// Keeps the Organisation Name dropdown live on sheet open. The registry list (warning only) is applied to rows that are Returning
// Organisation or have no type yet; New Organisation rows get NO rule, because a new name is by definition not in the registry
// and would show a red "Input must fall within specified range" flag.
function applyWorkspaceOrganisationDropdown_() {
  const intake = sheet_(APFP.SHEETS.INTAKE), organisations = sheet_(APFP.SHEETS.ORGANISATIONS),
    first = APFP.INTAKE.START_ROW, count = APFP.INTAKE.MAX_ROW - APFP.INTAKE.START_ROW + 1,
    nameColumn = intakeColumn_('Organisation Name'),
    source = organisations.getRange(2, 2, Math.max(1, organisations.getMaxRows() - 1), 1),
    types = intake.getRange(first, intakeColumn_('Organisation Type'), count, 1).getDisplayValues().map(row => key_(row[0])),
    rule = SpreadsheetApp.newDataValidation().requireValueInRange(source, true).setAllowInvalid(true).build();
  const withRule = [], withoutRule = [];
  types.forEach((type, i) => (type === 'new organisation' ? withoutRule : withRule).push(first + i));
  groupConsecutive_(withRule).forEach(run => intake.getRange(run[0], nameColumn, run.length, 1).setDataValidation(rule));
  groupConsecutive_(withoutRule).forEach(run => intake.getRange(run[0], nameColumn, run.length, 1).clearDataValidations());
  return count;
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
    targets.push({ label: 'Setup workbook', range: setupSheet.getRange(configValueRange_(titleField)) });
  }

  const outcomeId = clean_(techRecord['Outcome Progress Workbook URL'])
    ? urlId_(techRecord['Outcome Progress Workbook URL']) : '';
  if (outcomeId) {
    const outcome = openSpreadsheetCached_(outcomeId);
    const outcomeSheet = outcome.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES);
    if (!outcomeSheet) throw new Error('Generated Outcome workbook is missing Outcome Progress.');
    targets.push({ label: 'Outcome workbook', range: outcomeSheet.getRange(APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE.GRANT_TITLE_CELL) });
  }
  return targets;
}

// Applies ONLY the fields in `changes` (title, startDate, endDate, amount, thematicArea, subArea, proximity,
// organisationType) to one created grant: Grant Registry, Technical Registry, central references and the Workspace Creator row.
// Values already equal to the stored ones write nothing. Returns { grantId, projectTitle, applied: [labels], warning }.
function applyGrantCorrections_(grantId, requestId, rowNumber, changes, options) {
  if (!grantId || !requestId) throw new Error('The selected row has no Grant ID or Request ID.');
  const grant = grantById_(grantId), tech = techByRequest_(requestId);
  if (!grant || !tech || key_(tech.record['Grant ID']) !== key_(grantId))
    throw new Error('The selected row is not linked to one unambiguous created grant.');
  if (!['workspace created', 'registry only'].includes(key_(tech.record['Workspace Status'])))
    throw new Error('A grant can be corrected only after its workspace or registry entry was created.');
  const has = name => Object.prototype.hasOwnProperty.call(changes || {}, name);
  const g = grant.record, t = tech.record;
  const sameDate = (a, b) => { const x = dateValue_(a), y = dateValue_(b); return !!x && !!y && x.getTime() === y.getTime(); };
  const grantPatch = {}, techPatch = {}, rowPatch = {}, applied = [];
  let titleChanged = false;
  // Grant Type is validated first, applied last (it can rebuild the workspace), so a bad value stops everything before any write.
  let newGrantType = '';
  if (has('grantType')) {
    newGrantType = canonicalGrantType_(changes.grantType);
    if (!newGrantType) throw new Error('Grant Type must be Restricted, Unrestricted, Transactional, or Discretionary.');
    if (key_(newGrantType) === key_(g['Grant Type'])) newGrantType = '';
  }
  const typeStep = () => changeGrantType_(grantId, requestId, rowNumber, newGrantType, options);

  if (has('title')) {
    const title = clean_(changes.title);
    if (!title) throw new Error('Grant Title cannot be blank.');
    if (title !== clean_(g['Project Title'])) {
      grantPatch['Project Title'] = title; techPatch['Project Title'] = title; rowPatch['Grant Title'] = title;
      titleChanged = true; applied.push('Grant Title');
    }
  }
  if (has('amount')) {
    const amount = parseAdminTableNumber_(changes.amount);
    if (amount === '' || amount == null || amount < 0) throw new Error('Amount Approved must be a non-negative amount.');
    if (Number(g['Amount Approved']) !== amount) {
      grantPatch['Amount Approved'] = amount; techPatch['Amount Approved'] = amount; rowPatch['Amount Approved'] = amount;
      applied.push('Amount Approved');
    }
  }
  [['thematicArea', 'Thematic Area', 'Thematic Area'], ['subArea', 'Thematic Sub-area', 'Thematic Sub-area'],
   ['proximity', 'Proximity to Children / Beneficiary', 'Proximity']].forEach(([key, header, label]) => {
    if (!has(key)) return;
    const value = clean_(changes[key]);
    if (value !== clean_(g[header])) { grantPatch[header] = value; rowPatch[header] = value; applied.push(label); }
  });
  if (has('organisationType')) {
    const type = clean_(changes.organisationType);
    if (!['New Organisation', 'Returning Organisation'].includes(type))
      throw new Error('Organisation Type must be New Organisation or Returning Organisation.');
    if (type !== clean_(t['Organisation Type'])) { techPatch['Organisation Type'] = type; rowPatch['Organisation Type'] = type; applied.push('Organisation Type'); }
  }
  if (has('startDate') || has('endDate')) {
    const start = has('startDate') ? dateValue_(changes.startDate) : dateValue_(t['Grant Start Date'] || g['Grant Start Date']),
      end = has('endDate') ? dateValue_(changes.endDate) : dateValue_(t['Grant End Date'] || g['Grant End Date']);
    if (!validDateValue_(start)) throw new Error('Grant Start Date is required and must be a valid date.');
    if (!validDateValue_(end)) throw new Error('Grant End Date is required and must be a valid date.');
    if (end < start) throw new Error('Grant End Date cannot be before Grant Start Date.');
    const grantFy = clean_(t['Financial Year'] || g['Financial Year']);
    if (key_(financialYearFromDate_(start)) !== key_(grantFy))
      throw new Error(`The Grant Start Date must stay inside financial year ${grantFy}. A date in another financial year needs a new workspace.`);
    const startChanged = !sameDate(start, t['Grant Start Date']) || !sameDate(start, g['Grant Start Date']),
      endChanged = !sameDate(end, t['Grant End Date']) || !sameDate(end, g['Grant End Date']);
    if (startChanged || endChanged) {
      const quarter = grantQuarterFromDate_(start);
      [grantPatch, techPatch].forEach(patch => { patch['Grant Start Date'] = start; patch['Grant End Date'] = end; patch['Grant Start Quarter'] = quarter; });
      rowPatch['Grant Start Date'] = start; rowPatch['Grant End Date'] = end;
      if (startChanged) applied.push('Grant Start Date');
      if (endChanged) applied.push('Grant End Date');
    }
  }
  if (!applied.length) {
    if (!newGrantType) return { grantId, projectTitle: clean_(g['Project Title']), applied, warning: '' };
    const only = typeStep();
    return { grantId, projectTitle: clean_(g['Project Title']), applied: only.applied, warning: only.warning };
  }

  const workbookTargets = titleChanged ? correctedWorkspaceWorkbookTargets_(t) : [];
  const projectTitle = titleChanged ? grantPatch['Project Title'] : clean_(g['Project Title']);
  setByHeaders_(APFP.SHEETS.GRANTS, 1, grant.rowNumber, Object.assign({}, grantPatch, { 'Last Updated At': now_() }));
  saveTech_(requestId, Object.assign({ 'Last Error Code': '', 'Last Error Message': '' }, techPatch));
  if (titleChanged) {
    updateGrantTitleReferences_(grantId, projectTitle);
    ensureOrganisationMaturityRowsForGrant_(grantId);
  }
  if (rowNumber) setIntake_(rowNumber, Object.assign({}, rowPatch, { 'Last Updated': now_() }));

  // Workbook title cells are written LAST and only when they differ: they are protected (owner only), and a correction that
  // does not change the title must not touch the grantee workbooks. A protected cell becomes a warning, never a half-finished correction.
  const warnings = [];
  workbookTargets.forEach(target => {
    try {
      if (clean_(target.range.getDisplayValue()) !== projectTitle) target.range.setValue(projectTitle);
    } catch (error) {
      warnings.push(`The Grant Title in the ${target.label} could not be updated because the cell is protected (${error.message}). ` +
        'Ask the workbook owner to update it, then correct the title again.');
    }
  });
  SpreadsheetApp.flush();
  if (newGrantType) {
    const typed = typeStep();
    return { grantId, projectTitle, applied: applied.concat(typed.applied), warning: warnings.concat(typed.warning ? [typed.warning] : []).join(' ') };
  }
  return { grantId, projectTitle, applied, warning: warnings.join(' ') };
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
 refreshOrganisationRegistryEntry_(organisationId);
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
   required = APFP.MATURITY.HEADERS, width = sheet.getLastColumn(),
   headers = sheet.getRange(headerRow, 1, 1, width).getDisplayValues()[0].map(clean_),
   catalogue = maturityCatalogue_(), existing = {}, lastRow = sheet.getLastRow();
 // Columns are found by header name, so an added or moved column never garbles rows.
 required.forEach(header => {
   if (!headers.some(name => key_(name) === key_(header)))
     throw new Error(`${APFP.SHEETS.MATURITY} is missing the column "${header}".`);
 });
 if (lastRow >= APFP.MATURITY.START_ROW) {
   const values = sheet.getRange(APFP.MATURITY.START_ROW, 1,
     lastRow - APFP.MATURITY.START_ROW + 1, width).getValues();
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
   header && Object.prototype.hasOwnProperty.call(record, header) ? record[header] : ''));
 sheet.getRange(startRow, 1, output.length, width)
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
 refreshOrganisationRegistryEntry_(grant.record['Organisation ID']);
}