// RegistrySync.gs — approved Setup validation and row-level registry upserts.
const SETUP_READ_CACHE_ = {};
function masterSyncByGrantId_(grantId) {
 const found = techByGrantId_(grantId);
 if (!found) return null;
 if (isTransactionalGrantType_(found.record['Grant Type'])) return null;
 if (!clean_(found.record['Setup Workbook URL'])) return null;
 return found;
}
function syncRecordIsApprovedCompleted_(record) {
 return key_(record['Record Status']) === 'active' &&
   !isTransactionalGrantType_(record['Grant Type']) &&
   key_(record['Setup Review Status']) === 'approved' &&
   key_(record['Data Update Status']) === 'updated' &&
   key_(record['Data Sync Status']) === 'completed';
}
function latestApprovedPriorSyncRecord_(organisationId, targetFinancialYear) {
 const target = financialYearStart_(targetFinancialYear);
 if (!clean_(organisationId) || target == null) return null;
 const rows = technicalRegistryRows_().filter(item => {
   const record = item.record, fy = financialYearStart_(record['Financial Year']);
   return key_(record['Organisation ID']) === key_(organisationId) && fy != null && fy < target && syncRecordIsApprovedCompleted_(record);
 });
 rows.sort((a, b) => (financialYearStart_(b.record['Financial Year']) || 0) - (financialYearStart_(a.record['Financial Year']) || 0) || b.rowNumber - a.rowNumber);
 return rows[0] || null;
}
function hasLaterApprovedCompletedSource_(organisationId, financialYear, excludedGrantId) {
 const current = financialYearStart_(financialYear);
 if (!clean_(organisationId) || current == null) return false;
 return technicalRegistryRows_().some(item => {
   const record = item.record, fy = financialYearStart_(record['Financial Year']);
   return key_(record['Organisation ID']) === key_(organisationId) &&
     key_(record['Grant ID']) !== key_(excludedGrantId) && fy != null && fy > current && syncRecordIsApprovedCompleted_(record);
 });
}
function registerCreatedWorkbookForSync_(request, organisationId, grantId, workbookUrl) {
 const tech = techByGrantId_(grantId) || (request.requestId ? techByRequest_(request.requestId) : null);
 if (!tech) throw new Error(`Technical Registry record is missing for Grant ID ${grantId}.`);
 const record = tech.record, sourceId = urlId_(workbookUrl), patch = {
   'Setup Workbook URL': workbookUrl,
   'Organisation ID': organisationId,
   'Grant ID': grantId,
   'Financial Year': request.financialYear,
   'Organisation Name': request.organisationName,
   'Project Title': request.projectTitle,
   'Setup Review Status': clean_(record['Setup Review Status']) || APFP.REVIEW_STATUS.AWAITING,
   'Data Update Status': clean_(record['Data Update Status']) || APFP.DATA_UPDATE_STATUS.NOT_READY,
   'Data Sync Status': clean_(record['Data Sync Status']) || 'Not Eligible',
   'Setup Last Modified At': DriveApp.getFileById(sourceId).getLastUpdated()
 };
 saveTech_(record['Request ID'], patch);
 return tech.rowNumber;
}
function updateApprovedSetupData() {
 runtimeGuard_();
 const lock = LockService.getScriptLock();
 if (!lock.tryLock(30000)) {
   SpreadsheetApp.getUi().alert('Another APFP automation run is active. Run this action again after it finishes.');
   return;
 }
 let completed = 0, failed = 0, processed = 0, stopped = false;
 const failures = [];
 const start = Date.now();
 try {
   const eligible = technicalRegistryRows_().filter(item => {
     const record = item.record;
     return key_(record['Record Status']) === 'active' && !isTransactionalGrantType_(record['Grant Type']) &&
       ['approved', 'retry approval'].includes(key_(record['Setup Review Status'])) &&
       !['updated', 'updating'].includes(key_(record['Data Update Status'])) && clean_(record['Setup Workbook URL']);
   }).map(item => item.rowNumber);
   if (!eligible.length) {
     SpreadsheetApp.getUi().alert('No Approved Setup is waiting to be locked and updated.');
     return;
   }
   for (const rowNumber of eligible) {
     if (processed && Date.now() - start >= APFP.EXECUTION_GUARD_MS) { stopped = true; break; }
     try {
       syncOneMasterDataRow_(rowNumber);
       completed++;
     } catch (error) {
       failed++;
       failures.push(markMasterSyncFailed_(rowNumber, error));
     }
     processed++;
   }
 } finally {
   lock.releaseLock();
 }
 const suffix = stopped ? ' Remaining approved records were left untouched; run this menu action again to continue.' : '';
 recordAutomationStatus_('Setup Approval & Registry Sync', failed || stopped ? 'Needs attention' : 'Success',
   `${completed} completed; ${failed} need attention${stopped ? '; safely paused' : ''}`);
 const failureLines = failures.filter(Boolean).slice(0, 5)
   .map(item => `• ${item.organisationName || item.grantId}: ${item.summary}`);
 const detail = failureLines.length ? `\n\nNeeds attention:\n${failureLines.join('\n')}` : '';
 SpreadsheetApp.getUi().alert(
   `Locked and updated ${completed} approved Setup(s); ${failed} need attention.${suffix}${detail}`
 );
}
function setupRangeKey_(row) {
 return `${clean_(row['Sheet Name'])}|${configValueRange_(row)}`;
}
function a1Dimensions_(a1) {
 const match = clean_(a1).toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
 if (!match) throw new Error(`Invalid configured A1 range: ${a1}`);
 const colNumber = letters => letters.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0),
   c1 = colNumber(match[1]), r1 = Number(match[2]), c2 = match[3] ? colNumber(match[3]) : c1, r2 = match[4] ? Number(match[4]) : r1;
 return { rows: Math.max(1, r2 - r1 + 1), cols: Math.max(1, c2 - c1 + 1) };
}
function padValueMatrix_(values, rows, cols) {
 return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) =>
   values && values[r] && values[r][c] != null ? values[r][c] : ''));
}
function primeSetupReadCache_(source, fieldConfig) {
 const sourceId = source.getId();
 if (SETUP_READ_CACHE_[sourceId]) return SETUP_READ_CACHE_[sourceId];
 const unique = [], seen = new Set();
 fieldConfig.forEach(row => {
   const key = setupRangeKey_(row);
   if (!key || seen.has(key)) return;
   seen.add(key);
   unique.push({ key, row, range: quotedSheetA1_(row['Sheet Name'], configValueRange_(row)), shape: a1Dimensions_(configValueRange_(row)) });
 });
 const out = { raw: {}, display: {} };
 try {
   requireAdvancedSheetsService_();
   const ranges = unique.map(item => item.range),
     raw = Sheets.Spreadsheets.Values.batchGet(sourceId, { ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }).valueRanges || [],
     display = Sheets.Spreadsheets.Values.batchGet(sourceId, { ranges, valueRenderOption: 'FORMATTED_VALUE' }).valueRanges || [];
   unique.forEach((item, i) => {
     out.raw[item.key] = padValueMatrix_(raw[i] && raw[i].values, item.shape.rows, item.shape.cols);
     out.display[item.key] = padValueMatrix_(display[i] && display[i].values, item.shape.rows, item.shape.cols);
   });
 } catch (e) {
   unique.forEach(item => {
     const sheet = source.getSheetByName(clean_(item.row['Sheet Name']));
     if (!sheet) throw new Error(`Source workbook is missing sheet ${item.row['Sheet Name']}.`);
     const range = sheet.getRange(configValueRange_(item.row));
     out.raw[item.key] = range.getValues();
     out.display[item.key] = range.getDisplayValues();
   });
 }
 SETUP_READ_CACHE_[sourceId] = out;
 return out;
}
function readSingleConfigured_(ss, row) {
 if (!row) return '';
 const cache = SETUP_READ_CACHE_[ss.getId()], key = setupRangeKey_(row);
 if (cache && cache.display[key]) return clean_(cache.display[key][0] && cache.display[key][0][0]);
 const sheet = ss.getSheetByName(clean_(row['Sheet Name']));
 if (!sheet) throw new Error(`Source workbook is missing sheet ${row['Sheet Name']}.`);
 return clean_(sheet.getRange(configValueRange_(row)).getDisplayValue());
}
function readSingleConfiguredRaw_(ss, row) {
 if (!row) return '';
 const cache = SETUP_READ_CACHE_[ss.getId()], key = setupRangeKey_(row);
 if (cache && cache.raw[key]) {
   const value = cache.raw[key][0] && cache.raw[key][0][0];
   return typeof value === 'string' ? clean_(value) : (value == null ? '' : value);
 }
 const sheet = ss.getSheetByName(clean_(row['Sheet Name']));
 if (!sheet) throw new Error(`Source workbook is missing sheet ${row['Sheet Name']}.`);
 const value = sheet.getRange(configValueRange_(row)).getValue();
 return typeof value === 'string' ? clean_(value) : value;
}
function readTableConfigured_(ss, row) {
 if (!row) return [];
 const cache = SETUP_READ_CACHE_[ss.getId()], key = setupRangeKey_(row);
 if (cache && cache.display[key]) return cache.display[key].map(r => r.slice());
 const sheet = ss.getSheetByName(clean_(row['Sheet Name']));
 if (!sheet) throw new Error(`Source workbook is missing sheet ${row['Sheet Name']}.`);
 return sheet.getRange(configValueRange_(row)).getDisplayValues();
}
function readTableConfiguredRaw_(ss, row) {
 if (!row) return [];
 const cache = SETUP_READ_CACHE_[ss.getId()], key = setupRangeKey_(row);
 if (cache && cache.raw[key]) return cache.raw[key].map(r => r.slice());
 const sheet = ss.getSheetByName(clean_(row['Sheet Name']));
 if (!sheet) throw new Error(`Source workbook is missing sheet ${row['Sheet Name']}.`);
 return sheet.getRange(configValueRange_(row)).getValues();
}
function primaryBeneficiaryFromSetup_(ss, typeRow, countRow) {
 const types = readTableConfigured_(ss, typeRow), counts = readTableConfiguredRaw_(ss, countRow);
 for (let i = 0; i < Math.max(types.length, counts.length); i++) {
   const group = clean_(types[i] && types[i][0]), rawCount = counts[i] && counts[i][0];
   if (group || (rawCount !== '' && rawCount != null)) return { group, count: rawCount == null ? '' : rawCount };
 }
 return { group: '', count: '' };
}
function pairTable_(ss, leftRow, rightRow) {
 const a = readTableConfigured_(ss, leftRow), b = readTableConfigured_(ss, rightRow), out = [];
 for (let i = 0; i < Math.max(a.length, b.length); i++) {
   const x = clean_(a[i] && a[i][0]), y = clean_(b[i] && b[i][0]);
   if (x || y) out.push([x, y]);
 }
 return out.map(r => r.join(' | ')).join('\n');
}
function tripleTable_(ss, firstRow, secondRow, thirdRow) {
 const a = readTableConfigured_(ss, firstRow), b = readTableConfigured_(ss, secondRow), c = readTableConfigured_(ss, thirdRow), out = [];
 for (let i = 0; i < Math.max(a.length, b.length, c.length); i++) {
   const x = clean_(a[i] && a[i][0]), y = clean_(b[i] && b[i][0]), z = clean_(c[i] && c[i][0]);
   if (x || y || z) out.push([x, y, z]);
 }
 return out.map(r => r.join(' | ')).join('\n');
}
function validateCompletedSetup_(source, byCode) {
 const missing = [];
 Object.keys(byCode).forEach(
   code => {
     const row = byCode[code],
       rule = key_(row['Required Rule']),
       shape = key_(row['Field Shape']);
     if (rule === 'yes' && shape === 'scalar' && !clean_(readSingleConfigured_(source, row)))
       missing.push(row['Field Label'] || code);
   }
 );
 const programme = readSingleConfigured_(source, byCode.programme_status);
 if (key_(programme) === 'currently operational' && !clean_(readSingleConfigured_(source, byCode.years_implemented)))
   missing.push('Number of Years Implemented');
 if (key_(readSingleConfigured_(source, byCode.funds_raised_other_sources)) === 'yes' && !clean_(readSingleConfigured_(source, byCode.other_funding_details)))
   missing.push('Other Funding Details');
 if (key_(readSingleConfigured_(source, byCode.other_funders_considering)) === 'yes' && !clean_(readSingleConfigured_(source, byCode.other_funders_details)))
   missing.push('Funders Considering — Names / Details');
 [
   ['fcra_link', 'fcra_expiry_date', 'FCRA Registration Expiry Date'],
   ['section_12a_link', 'section_12a_expiry_date', 'Section 12A Registration Expiry Date'],
   ['section_80g_link', 'section_80g_expiry_date', 'Section 80G Expiry Date']
 ].forEach(([linkCode, dateCode, label]) => {
   if (byCode[linkCode] && clean_(readSingleConfigured_(source, byCode[linkCode])) &&
       (!byCode[dateCode] || !readSingleConfigured_(source, byCode[dateCode])))
     missing.push(label);
 });
 const groups = [
     {
       label: 'Leadership',
       left: byCode.leadership_name,
       right: [byCode.leadership_designation, byCode.leadership_email, byCode.leadership_contact],
       atLeastOne: true
     },
     {
       label: 'Stakeholder',
       left: byCode.stakeholder_name,
       right: [byCode.stakeholder_role],
       atLeastOne: true
     },
     {
       label: 'Beneficiary',
       left: byCode.beneficiary_type,
       right: [byCode.direct_beneficiary_count, byCode.cost_per_beneficiary],
       atLeastOne: true
     },
     {
       label: 'Outcome',
       left: byCode.outcome_indicator,
       right: [byCode.outcome_target, byCode.outcome_measurement],
       atLeastOne: true
     },
     {
       label: 'Current Funder',
       left: byCode.current_funder_name,
       right: [byCode.current_funder_amount],
       atLeastOne: false
     }
   ];
 groups.forEach(
   group => {
     if (!group.left)
       return;
     const left = readTableConfigured_(source, group.left),
       rights = group.right.map(r => readTableConfigured_(source, r)),
       used = [];
     for (let i = 0; i < left.length; i++) {
       const values = [clean_(left[i] && left[i][0])].concat(rights.map(r => clean_(r[i] && r[i][0])));
       if (values.some(Boolean)) {
         used.push(i);
         if (values.some(v => !v))
           missing.push(`${group.label} row ${i + 1} is incomplete`);
       }
     }
     if (group.atLeastOne && !used.length)
       missing.push(`At least one complete ${group.label.toLowerCase()} row`);
   }
 );
 if (missing.length)
   throw new Error(`Approved Setup is incomplete. Complete: ${[...new Set(missing)].join(', ')}.`);
}
function configuredSetupValueIsValid_(value, row) {
 const rawRule = clean_(row['Validation Rule']), rule = key_(rawRule), input = key_(row['Input Type']);
 if (value === '' || value == null || !rule || ['text', 'required_text', 'text_or_number', 'none'].includes(rule)) return true;
 const text = clean_(value);
 if (rule.indexOf('list:') === 0)
   return rawRule.slice(rawRule.indexOf(':') + 1).split('|').map(clean_).includes(text);
 if (input === 'email' || input === 'email address' || rule === 'email' || rule === 'valid email')
   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
 if (input === 'phone' || input === 'phone number' || rule === 'phone' || rule === 'valid phone number')
   return /^[6-9][0-9]{9}$/.test(text);
 if (input === 'website url' || rule === 'http_url' || rule === 'valid website url')
   return /^https?:\/\//i.test(text);
 if (input === 'google drive link' || rule === 'drive_url' || rule === 'drive link only')
   return /^https:\/\/(drive\.google\.com|docs\.google\.com)\//i.test(text);
 if (input === 'yes / no' || rule === 'yes_no' || rule === 'yes/no') return ['Yes', 'No'].includes(text);
 if (input === 'date' || rule === 'date') return !!dateValue_(value);
 const number = typeof value === 'number' ? value : Number(value);
 if (rule === 'year_4_digit' || input === 'year') return Number.isInteger(number) && number >= 1000 && number <= 9999;
 if (input === 'whole number' || rule === 'nonnegative_whole_number' || rule === 'non-negative whole number')
   return Number.isInteger(number) && number >= 0;
 if (rule === 'positive_whole_number') return Number.isInteger(number) && number > 0;
 if (input === 'percentage' || rule === 'percent_0_100' || rule === '0 to 100')
   return Number.isFinite(number) && number >= 0 && number <= 100;
 if (input === 'currency' || rule === 'nonnegative_currency' || rule === 'non-negative currency')
   return Number.isFinite(number) && number >= 0;
 return true;
}
function validateConfiguredSetupValues_(source, fieldConfig) {
 const invalid = [];
 fieldConfig.forEach(row => {
   if (key_(row['Grantee Editable?']) !== 'yes') return;
   const matrix = readTableConfiguredRaw_(source, row);
   matrix.forEach((values, rowOffset) => values.forEach(value => {
     if (!configuredSetupValueIsValid_(value, row))
       invalid.push(`${row['Field Label'] || row['Field Code']}${values.length > 1 || matrix.length > 1 ? ` (row ${rowOffset + 1})` : ''}`);
   }));
 });
 if (invalid.length)
   throw new Error(`Approved Setup contains invalid values. Correct: ${[...new Set(invalid)].join(', ')}.`);
}
function setupRegistryExportRecords_(source) {
  const sheet = source.getSheetByName(APFP.TEMPLATE_SHEETS.REGISTRY_EXPORT);
  // Workbooks created before protected exports were introduced use the existing
  // validated Field Config batch-read path. New workbooks must use the export.
  if (!sheet) return { organisation: {}, grant: {}, legacyFallback: true };
  if (!sheet.isSheetHidden()) throw new Error('System - Registry Export exists but is visible. Hide and protect it before migration.');
  const read = (headerRow, dataRow, headers) => {
    const actual = sheet.getRange(headerRow, 1, 1, headers.length).getDisplayValues()[0];
    headers.forEach((header, index) => {
      if (clean_(actual[index]) !== header) throw new Error(`Registry Export column ${index + 1} should be "${header}".`);
    });
    const values = sheet.getRange(dataRow, 1, 1, headers.length).getValues()[0], out = {};
    headers.forEach((header, index) => out[header] = values[index]);
    return out;
  };
  return {
    organisation: read(2, 3, APFP.ORGANISATION_HEADERS),
    grant: read(6, 7, APFP.GRANT_HEADERS),
    legacyFallback: false
  };
}
function syncOneMasterDataRow_(rowNumber) {
 const record = rowObject_(APFP.SHEETS.TECHNICAL, 2, rowNumber);
 if (isTransactionalGrantType_(record['Grant Type'])) throw new Error('Setup data update does not apply to Transactional grants.');
 if (!['approved', 'retry approval'].includes(key_(record['Setup Review Status'])))
   throw new Error('Only Approved or Retry Approval Setup workbooks can update master data.');
 if (['updated', 'updating'].includes(key_(record['Data Update Status'])))
   throw new Error('Approved Setup is already updated or currently updating.');
 const config = config_();
 requireConfig_(config, ['SETUP_TEMPLATE_ID', 'DATA_SYNC_SCHEMA_VERSION']);
 const sourceUrl = clean_(record['Setup Workbook URL']), sourceId = sourceUrl ? urlId_(sourceUrl) : '',
   source = sourceId ? openSpreadsheetCached_(sourceId) : null;
 if (!source) throw new Error('Setup Workbook URL is missing from Technical Registry.');
 const fieldConfig = templateFieldConfigRows_(config.SETUP_TEMPLATE_ID), byCode = {};
 fieldConfig.forEach(item => byCode[clean_(item['Field Code'])] = item);
 primeSetupReadCache_(source, fieldConfig);
 validateCompletedSetup_(source, byCode);
 validateConfiguredSetupValues_(source, fieldConfig);
 const organisationName = clean_(record['Organisation Name']) || readSingleConfigured_(source, byCode.org_name),
   financialYear = clean_(record['Financial Year']),
   projectTitle = clean_(record['Project Title']) || readSingleConfigured_(source, byCode.project_title),
   organisationId = clean_(record['Organisation ID']), grantId = clean_(record['Grant ID']),
   syncedAt = now_(), schema = clean_(config.DATA_SYNC_SCHEMA_VERSION),
   older = hasLaterApprovedCompletedSource_(organisationId, financialYear, grantId),
   exported = setupRegistryExportRecords_(source);
 if (!organisationId || !grantId || !organisationName || !projectTitle) throw new Error('Sync identity is incomplete.');
 saveTech_(record['Request ID'], {
   'Data Update Status': APFP.DATA_UPDATE_STATUS.UPDATING,
   'Data Sync Status': 'In Progress', 'Data Sync Attempt At': syncedAt,
   'Last Error Code': '', 'Last Error Message': ''
 });
 if (!older) {
   syncOrganisationMaster_(source, byCode, organisationId, organisationName, sourceUrl, syncedAt, schema, exported.organisation);
   syncLeadershipMaster_(source, byCode, organisationId, sourceUrl, syncedAt, schema);
 }
 syncGrantMaster_(source, byCode, grantId, organisationId, organisationName, financialYear, projectTitle, sourceUrl, syncedAt, schema, exported.grant);
 syncApprovedOutcomesToGranteeWorkbook_(grantId, sourceId, true);
 archiveApprovedSetup_(grantId);
 saveTech_(record['Request ID'], {
   'Data Update Status': APFP.DATA_UPDATE_STATUS.UPDATED, 'Data Sync Status': 'Completed',
   'Setup Review Status': APFP.REVIEW_STATUS.LOCKED,
   'Workspace Status': APFP.STATUS.WORKSPACE_CREATED,
   'Data Synced At': syncedAt, 'Setup Last Modified At': DriveApp.getFileById(sourceId).getLastUpdated(),
   'Last Error Code': '', 'Last Error Message': ''
 });
 refreshWorkspaceCreatorRow_(grantId);
}
function configuredScalarDestinationPatch_(source, byCode, destinationTable, options) {
 options = options || {};
 const excluded = new Set((options.excludedCodes || []).map(key_)),
   rawInputs = new Set((options.rawInputTypes || []).map(key_)), out = {};
 Object.keys(byCode || {}).forEach(code => {
   const row = byCode[code];
   if (excluded.has(key_(code)) || key_(row['Field Shape']) !== 'scalar' ||
       key_(row['Destination Table']) !== key_(destinationTable)) return;
   const destinationField = clean_(row['Destination Field']);
   if (!destinationField || destinationField === '—') return;
   const useRaw = !!options.rawAll || rawInputs.has(key_(row['Input Type']));
   out[destinationField] = useRaw ? readSingleConfiguredRaw_(source, row) : readSingleConfigured_(source, row);
 });
 return out;
}
function syncOrganisationMaster_(source, byCode, organisationId, organisationName, sourceUrl, syncedAt, schema, exported) {
 const patch = Object.assign({}, exported || {}, {
   'Organisation ID': organisationId, 'Organisation Name': organisationName,
   'Source Setup Workbook URL': sourceUrl, 'Master Data Synced At': syncedAt,
   'Template Schema Version': schema, 'Record Status': APFP.ACTIVE
 }, configuredScalarDestinationPatch_(source, byCode, 'Organisation Registry', {
   excludedCodes: ['org_name'],
   rawInputTypes: ['date', 'year']
 }));
 const existing = organisationById_(organisationId);
 existing
   ? setByHeaders_(APFP.SHEETS.ORGANISATIONS, 1, existing.rowNumber, patch)
   : appendObject_(APFP.SHEETS.ORGANISATIONS, 1, patch);
}
function syncLeadershipMaster_(source, byCode, organisationId, sourceUrl, syncedAt, schema) {
 const names = readTableConfigured_(source, byCode.leadership_name),
   designations = readTableConfigured_(source, byCode.leadership_designation),
   emails = readTableConfigured_(source, byCode.leadership_email),
   contacts = readTableConfigured_(source, byCode.leadership_contact),
   linkedIns = readTableConfigured_(source, byCode.leadership_linkedin),
   rowCount = Math.max(names.length, designations.length, emails.length, contacts.length, linkedIns.length),
   sheet = sheet_(APFP.SHEETS.LEADERSHIP), existing = [];
 if (sheet.getLastRow() >= 3) {
   const map = headerMap_(sheet, 2);
   const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
   sheet.getRange(3, 1, sheet.getLastRow() - 2, sheet.getLastColumn()).getDisplayValues().forEach((row, i) => {
     if (key_(row[map[key_('Organisation ID')]]) === key_(organisationId) && key_(row[map[key_('Record Status')]]) === 'active')
       existing.push({ rowNumber: i + 3, record: rowObjectFromArrays_(headers, row) });
   });
 }
 const seen = new Set();
 for (let i = 0; i < rowCount; i++) {
   const name = clean_(names[i] && names[i][0]),
     designation = clean_(designations[i] && designations[i][0]),
     email = clean_(emails[i] && emails[i][0]),
     contact = clean_(contacts[i] && contacts[i][0]),
     linkedIn = clean_(linkedIns[i] && linkedIns[i][0]);
   if (![name, designation, email, contact, linkedIn].some(Boolean)) continue;
   const slot = `Leadership ${i + 1}`,
     slotKey = key_(slot),
     match = existing.find(x => key_(x.record['Role']) === slotKey),
     patch = {
       'Organisation ID': organisationId,
       'Role': slot,
       'Name': name,
       'Designation': designation,
       'Email': email,
       'Contact': contact,
       'LinkedIn Profile': linkedIn,
       'Source Setup Workbook URL': sourceUrl,
       'Master Data Synced At': syncedAt,
       'Template Schema Version': schema,
       'Record Status': APFP.ACTIVE
     };
   seen.add(slotKey);
   match
     ? setByHeaders_(APFP.SHEETS.LEADERSHIP, 2, match.rowNumber, patch)
     : appendObject_(APFP.SHEETS.LEADERSHIP, 2, patch);
 }
 existing.forEach(x => {
   if (!seen.has(key_(x.record['Role'])))
     setByHeaders_(APFP.SHEETS.LEADERSHIP, 2, x.rowNumber, { 'Record Status': 'Inactive', 'Master Data Synced At': syncedAt });
 });
}
function syncGrantMaster_(source, byCode, grantId, organisationId, organisationName, financialYear, projectTitle, sourceUrl, syncedAt, schema, exported) {
 const g = grantById_(grantId), base = g ? g.record : {},
   primaryBeneficiary = primaryBeneficiaryFromSetup_(source, byCode.beneficiary_type, byCode.direct_beneficiary_count),
   p = Object.assign({}, exported || {}, {
     'Grant ID': grantId, 'Financial Year': financialYear,
     'Grant Start Quarter': base['Grant Start Quarter'] || '', 'Organisation ID': organisationId,
     'Organisation Name': organisationName,
     'Thematic Area': base['Thematic Area'] || '',
     'Thematic Sub-area': base['Thematic Sub-area'] || '',
     'Proximity to Children / Beneficiary': base['Proximity to Children / Beneficiary'] || '',
     'Project Title': projectTitle,
     'Grant Start Date': base['Grant Start Date'] || '', 'Grant End Date': base['Grant End Date'] || '',
     'Grant Type': base['Grant Type'] || '',
     'Amount Approved': base['Amount Approved'] === '' ? '' : base['Amount Approved'],
     'Grant Status': base['Grant Status'] || 'Active',
     'Stakeholders': pairTable_(source, byCode.stakeholder_name, byCode.stakeholder_role),
     'Beneficiaries': tripleTable_(source, byCode.beneficiary_type, byCode.direct_beneficiary_count, byCode.cost_per_beneficiary),
     'Primary Beneficiary Group': primaryBeneficiary.group,
     'Primary Beneficiary Count': primaryBeneficiary.count,
     'Current Funders': pairTable_(source, byCode.current_funder_name, byCode.current_funder_amount),
     'Primary Contact Email': readSingleConfigured_(source, byCode.primary_contact_email),
     'Master Data Sync Status': 'Completed', 'Record Status': APFP.ACTIVE,
     'Last Updated At': syncedAt, 'Source Setup Workbook URL': sourceUrl,

     'Master Data Synced At': syncedAt, 'Template Schema Version': schema
   }, configuredScalarDestinationPatch_(source, byCode, 'Grant Registry', {
     excludedCodes: ['project_title'],
     rawAll: true
   }));
 g ? setByHeaders_(APFP.SHEETS.GRANTS, 1, g.rowNumber, p) : appendObject_(APFP.SHEETS.GRANTS, 1, p);
}
function markMasterSyncFailed_(rowNumber, error) {
 const record = rowObject_(APFP.SHEETS.TECHNICAL, 2, rowNumber), retry = Number(record['Retry Count'] || 0) + 1,
   requestId = clean_(record['Request ID']);
 if (requestId) {
   saveTech_(requestId, {
     'Data Sync Status': 'Failed', 'Data Update Status': APFP.DATA_UPDATE_STATUS.FAILED,
     'Setup Review Status': APFP.REVIEW_STATUS.RETRY,
     'Workspace Status': APFP.STATUS.NEEDS_ATTENTION,
     'Data Sync Attempt At': now_(), 'Last Error Code': 'MASTER_SYNC_FAILED',
     'Last Error Message': error.message, 'Retry Count': retry
   });
 }
 writeException_({
   type: 'Approved Setup Data Update Failure', severity: 'High', organisationId: record['Organisation ID'],
   grantId: record['Grant ID'], location: APFP.SHEETS.TECHNICAL, field: record['Setup Workbook URL'],
   message: error.message, recommendedAction: friendlyErrorMessage_('MASTER_SYNC_FAILED', error), runId: record['Run ID']
 });
 if (clean_(record['Grant ID'])) refreshWorkspaceCreatorRow_(record['Grant ID']);
 const raw = clean_(error && error.message);
 const summary = raw.length > 350 ? `${raw.slice(0, 347)}…` : raw;
 return {
   grantId: clean_(record['Grant ID']),
   organisationName: clean_(record['Organisation Name']),
   summary
 };
}