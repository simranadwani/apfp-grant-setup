// TemplatePrefill.gs — generated links, returning-organisation prefill, and template exports.
const FIELD_CONFIG_CACHE_ = {};
function configValueRange_(row) {
 return clean_(row && row['Value Cell(s)']);
}
function configEditableRange_(row) {
 return clean_(row && (row['Editable / Target Range'] || row['Value Cell(s)']));
}
function configPrefillStable_(row) {
 return key_(row && row['Prefill Rule']) === 'returning_latest_approved';
}
function templateFieldConfigRows_(templateId) {
 const id = clean_(templateId);
 if (FIELD_CONFIG_CACHE_[id])
   return FIELD_CONFIG_CACHE_[id];
 const sheet = openSpreadsheetCached_(id).getSheetByName(APFP.TEMPLATE_SHEETS.FIELD_CONFIG);
 if (!sheet)
   throw new Error('Field Config is missing from the Setup Template.');
 const values = sheet.getDataRange().getDisplayValues();
 if (values.length < 2)
   return [];
 const headers = values[0];
 const rows = values.slice(1).map(r => {
   const o = {};
   headers.forEach((h, i) => o[h] = r[i]);
   return o;
}).filter(
     r => clean_(r['Sheet Name']) && configValueRange_(r) && clean_(r['Field Code'])
   );
 FIELD_CONFIG_CACHE_[id] = rows;
 return rows;
}
function configureGeneratedWorkbook_(...args) { return timed_('Configure Setup workbook', () => configureGeneratedWorkbookUntimed_(...args)); }
function configureGeneratedWorkbookUntimed_(setupSpreadsheet, request, organisationRecord, links, config) {
  const fieldConfig = templateFieldConfigRows_(clean_(config.SETUP_TEMPLATE_ID));
  APFP.GENERATED_VISIBLE_SHEETS.forEach(sheetName => {
    if (!setupSpreadsheet.getSheetByName(sheetName)) {
      throw new Error(`Generated workbook sheet missing: ${sheetName}`);
    }
  });

  timed_('Setup: write links and prefill', () => {
    writeGeneratedLinks_(setupSpreadsheet, links);
    prefillGeneratedWorkbook_(setupSpreadsheet, request, organisationRecord, fieldConfig);
    SpreadsheetApp.flush();
  });
  timed_('Setup: protect and verify', () => finaliseSetupWorkbookIntegrity_(setupSpreadsheet, fieldConfig));
  timed_('Setup: placeholder check', () => verifyConfiguredWorkbook_(setupSpreadsheet, fieldConfig));
}

function prefillGeneratedWorkbook_(spreadsheet, request, organisationRecord, fieldConfig) {
 const byCode = {};
 fieldConfig.forEach(r => byCode[clean_(r['Field Code'])] = r);
 const writes = [
   { row: byCode.org_name, value: request.organisationName },
   { row: byCode.project_title, value: request.projectTitle }
 ];
 if (request.organisationType === 'Returning Organisation') {
   fieldConfig.forEach(row => {
     if (!configPrefillStable_(row) || key_(row['Destination Table']) !== key_('Organisation Registry')) return;
     const destinationField = clean_(row['Destination Field']);
     if (!destinationField || destinationField === '—') return;
     const value = organisationRecord[destinationField];
     if (value !== '' && value != null) writes.push({ row, value });
   });
 }
 setConfiguredFields_(spreadsheet, writes);
 if (request.organisationType !== 'Returning Organisation') return;
 const organisationId = clean_(organisationRecord['Organisation ID']);
 const historical = latestApprovedPriorSyncRecord_(organisationId, request.financialYear);
 if (historical) {
   const sourceUrl = clean_(historical.record['Setup Workbook URL']);
   if (sourceUrl) {
     try {
       prefillStableFieldsFromSourceWorkbook_(spreadsheet, openSpreadsheetCached_(sourceUrl), fieldConfig);
     } catch (error) {
       console.warn(`Optional prior Setup prefill skipped for ${organisationId}: ${error.message}`);
     }
   }
 }
 prefillLeadership_(spreadsheet, organisationRecord, fieldConfig);
}
function quotedSheetA1_(sheetName, a1) {
 return `'${String(sheetName).replace(/'/g, "''")}'!${a1}`;
}
function configuredPhoneField_(row) {
 const inputType = key_(row && row['Input Type']), validationRule = key_(row && row['Validation Rule']);
 return inputType === 'phone' || inputType === 'phone number' ||
   validationRule === 'phone' || validationRule === 'valid phone number';
}
function setConfiguredFields_(spreadsheet, writes) {
 const data = [], rawTextData = [];
 (writes || []).forEach(item => {
   if (!item || !item.row) return;
   const sheetName = clean_(item.row['Sheet Name']), a1 = configValueRange_(item.row);
   if (!sheetName || !a1) return;
   if (!spreadsheet.getSheetByName(sheetName)) throw new Error(`Generated workbook sheet missing: ${sheetName}`);
   const value = item.value == null ? '' : item.value,
     phoneField = configuredPhoneField_(item.row),
     target = phoneField ? rawTextData : data;
   target.push({ range: quotedSheetA1_(sheetName, a1), values: [[phoneField ? clean_(value) : value]] });
 });
 if (!data.length && !rawTextData.length) return;
 requireAdvancedSheetsService_();
 if (data.length)
   Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'USER_ENTERED', data }, spreadsheet.getId());
 if (rawTextData.length)
   Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: rawTextData }, spreadsheet.getId());
}
function prefillStableFieldsFromSourceWorkbook_(target, source, fieldConfig) {
 fieldConfig.forEach(
   row => {
     if (!configPrefillStable_(row))
       return;
     const code = key_(row['Field Code']);
     if (code === 'org_name' || code.indexOf('leadership_') === 0)
       return;
     const name = clean_(row['Sheet Name']),
       src = source.getSheetByName(name),
       dst = target.getSheetByName(name);
     if (!src || !dst)
       return;
     const a1 = configValueRange_(row),
       currentValues = dst.getRange(a1).getValues();
     if (currentValues.flat().some(value => value !== '' && value != null))
       return;
     const values = src.getRange(a1).getValues().map(valuesRow =>
         configuredPhoneField_(row)
           ? valuesRow.map(value => value == null ? '' : clean_(value))
           : valuesRow);
     if (values.flat().some(v => v !== '' && v != null))
       dst.getRange(a1).setValues(values);
   }
 );
}
function prefillLeadership_(spreadsheet, organisationRecord, fieldConfig) {
 const organisationId = clean_(organisationRecord['Organisation ID']);
 if (!organisationId) return;
 const byCode = {};
 (fieldConfig || []).forEach(row => byCode[clean_(row['Field Code'])] = row);
 const fieldMap = {
   leadership_name: 'Name',
   leadership_designation: 'Designation',
   leadership_email: 'Email',
   leadership_contact: 'Contact',
   leadership_linkedin: 'LinkedIn Profile'
 }, source = sheet_(APFP.SHEETS.LEADERSHIP), sourceMap = headerMap_(source, 2), records = [];
 if (source.getLastRow() >= 3) {
   const map = sourceMap;
   source.getRange(3, 1, source.getLastRow() - 2, source.getLastColumn()).getDisplayValues().forEach(row => {
     if (key_(row[map[key_('Organisation ID')]]) === key_(organisationId) &&
         key_(row[map[key_('Record Status')]]) === 'active') records.push(row);
   });
 }
 Object.keys(fieldMap).forEach(code => {
   const configRow = byCode[code];
   if (!configRow) throw new Error(`Setup Field Config is missing ${code}.`);
   const targetSheet = spreadsheet.getSheetByName(clean_(configRow['Sheet Name']));
   if (!targetSheet) throw new Error(`Generated workbook is missing leadership sheet ${configRow['Sheet Name']}.`);
   const targetRange = targetSheet.getRange(configValueRange_(configRow)), headerIndex = sourceMap[key_(fieldMap[code])];
   if (headerIndex == null) throw new Error(`Organisation Leadership is missing column ${fieldMap[code]}.`);
   const values = Array.from({ length: targetRange.getNumRows() }, (_, i) => [records[i] ? records[i][headerIndex] || '' : '']);
   targetRange.setValues(values);
 });
}

function setupTemplateLinkResources_() {
 return APFP.PREFLIGHT_SCHEMA.SETUP_LINK_RESOURCES.slice();
}
function outcomeTemplateLinkResources_() {
 return APFP.PREFLIGHT_SCHEMA.OUTCOME_LINK_RESOURCES.slice();
}
function verifyTemplateLinkSchema_(spreadsheet, expectedResources, label) {
 const sheet = spreadsheet.getSheetByName(APFP.TEMPLATE_SHEETS.LINKS);
 if (!sheet) throw new Error(`${label || 'Template'} is missing the Links sheet.`);
 const schema = APFP.PREFLIGHT_SCHEMA.LINKS,
   count = Math.max(0, sheet.getLastRow() - schema.HEADER_ROW),
   actual = count ? sheet.getRange(schema.DATA_START_ROW, schema.RESOURCE_COLUMN, count, 1).getDisplayValues().flat().map(clean_).filter(Boolean) : [],
   expected = (expectedResources || []).map(clean_);
 if (actual.length !== expected.length || actual.some((value, i) => value !== expected[i]))
   throw new Error(`${label || 'Template'} Links resources must be exactly: ${expected.join(' | ')}.`);
}
function generatedLinkDefinitions_(links) {
 links = links || {};
 return {
   'organisation workspace': ['Open organisation workspace', links.workspaceUrl],
   'progress report q1': ['Open Q1 folder', links.q1Url],
   'progress report q2': ['Open Q2 folder', links.q2Url],
   'progress report q3': ['Open Q3 folder', links.q3Url],
   'progress report q4': ['Open Q4 folder', links.q4Url],
   'supporting & compliance documents': ['Open supporting documents', links.supportingUrl],
   'budget allocation & fund utilisation': ['Open budget & utilisation', links.budgetUtilisationUrl],
   'disbursement documents': ['Open disbursement documents', links.disbursementUrl],
   'outcome progress & supporting documents workbook': ['Open outcome/disbursement workbook', links.outcomeProgressWorkbookUrl],
   'outcome progress, disbursement & supporting documents workbook': ['Open outcome/disbursement workbook', links.outcomeProgressWorkbookUrl],
 };
}
function writeGeneratedLinks_(spreadsheet, links) {
 const sheet = spreadsheet.getSheetByName(APFP.TEMPLATE_SHEETS.LINKS);
 if (!sheet) throw new Error('Links sheet is missing from generated workbook.');
 const schema = APFP.PREFLIGHT_SCHEMA.LINKS,
   count = Math.max(0, sheet.getLastRow() - schema.HEADER_ROW);
 if (!count) throw new Error('Links sheet has no resource rows.');
 const resources = sheet.getRange(schema.DATA_START_ROW, schema.RESOURCE_COLUMN, count, 1).getDisplayValues().flat(),
   target = sheet.getRange(schema.DATA_START_ROW, schema.LINK_COLUMN, count, 1),
   currentValues = target.getDisplayValues().flat(),
   currentFormulas = target.getFormulas().flat(),
   definitions = generatedLinkDefinitions_(links),
   values = resources.map((resource, i) => {
     const definition = definitions[key_(resource)];
     if (!definition) return [currentFormulas[i] || currentValues[i]];
     const label = definition[0], url = definition[1];
     return [clean_(url) ? hyperlinkFormula_(label, url) : 'Not configured'];
   });
 target.setValues(values);
}
// Structure, links and protections were just verified by finaliseSetupWorkbookIntegrity_ (nothing has been written since),
// so this only checks that the sheets exist and that no invisible placeholder is left in a configured value range.
// One Sheets API call reads every range (it used to be one call per Field Config row).
function columnNumber_(letters) {
 return String(letters).split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
function columnLetters_(number) {
 let out = '';
 for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out;
 return out;
}
// The Sheets API rejects ranges outside the sheet grid (SpreadsheetApp tolerated them). Shortens a simple A1 range to the grid,
// returns '' when it lies wholly outside, and passes anything it cannot parse (whole columns, named ranges) through unchanged.
function clipA1ToGrid_(a1, maxRows, maxCols) {
 const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(clean_(a1).toUpperCase());
 if (!m) return a1;
 const c1 = columnNumber_(m[1]), r1 = Number(m[2]), c2 = m[3] ? columnNumber_(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
 if (r1 > maxRows || c1 > maxCols) return '';
 const lastRow = Math.min(r2, maxRows), lastCol = Math.min(c2, maxCols);
 const first = `${columnLetters_(c1)}${r1}`, last = `${columnLetters_(lastCol)}${lastRow}`;
 return first === last ? first : `${first}:${last}`;
}
function verifyConfiguredWorkbook_(spreadsheet, fieldConfig) {
 APFP.GENERATED_VISIBLE_SHEETS.forEach(
   name => {
     if (!spreadsheet.getSheetByName(name))
       throw new Error(`Generated workbook sheet missing after configuration: ${name}`);
   }
 );
 const checked = [];
 fieldConfig.forEach(row => {
   const sheetName = clean_(row['Sheet Name']);
   const sheet = spreadsheet.getSheetByName(sheetName);
   if (!sheet)
     throw new Error(`Field Config references missing generated sheet: ${row['Sheet Name']}`);
   const a1 = clipA1ToGrid_(configValueRange_(row), sheet.getMaxRows(), sheet.getMaxColumns());
   if (a1) checked.push({ row, range: quotedSheetA1_(sheetName, a1) });
 });
 if (!checked.length) return;
 requireAdvancedSheetsService_();
 const result = Sheets.Spreadsheets.Values.batchGet(spreadsheet.getId(), {
   ranges: checked.map(item => item.range), valueRenderOption: 'FORMATTED_VALUE'
 });
 (result.valueRanges || []).forEach((valueRange, i) => {
   [].concat(...(valueRange.values || [])).forEach(v => {
     if (String(v).indexOf('\u00A0') >= 0)
       throw new Error(`Invisible placeholder remained in ${checked[i].row['Field Code']}.`);
   });
 });
}
function verifyResourceLinks_(sheet, requiredResources, optionalResources) {
 const schema = APFP.PREFLIGHT_SCHEMA.LINKS,
   count = Math.max(0, sheet.getLastRow() - schema.HEADER_ROW);
 if (!count) throw new Error(`${sheet.getName()} has no link resource rows.`);
 const resources = sheet.getRange(schema.DATA_START_ROW, schema.RESOURCE_COLUMN, count, 1).getDisplayValues().flat(),
   formulas = sheet.getRange(schema.DATA_START_ROW, schema.LINK_COLUMN, count, 1).getFormulas().flat(),
   values = sheet.getRange(schema.DATA_START_ROW, schema.LINK_COLUMN, count, 1).getDisplayValues().flat(),
   byResource = {}, optional = new Set((optionalResources || []).map(key_));
 resources.forEach((resource, i) => { if (clean_(resource)) byResource[key_(resource)] = i; });
 (requiredResources || []).forEach(resource => {
   const index = byResource[key_(resource)];
   if (index == null) throw new Error(`Links resource row is missing: ${resource}`);
   if (!formulas[index] && !(optional.has(key_(resource)) && values[index] === 'Not configured'))
     throw new Error(`Required generated link is missing for: ${resource}`);
 });
}
function verifyGeneratedLinks_(spreadsheet) {
 const sheet = spreadsheet.getSheetByName(APFP.TEMPLATE_SHEETS.LINKS);
 if (!sheet) throw new Error('Links sheet is missing from generated Setup Workbook.');
 verifyResourceLinks_(sheet, setupTemplateLinkResources_());
}
function verifyOutcomeWorkbookLinks_(spreadsheet) {
 const sheet = spreadsheet.getSheetByName(APFP.TEMPLATE_SHEETS.LINKS);
 if (!sheet) throw new Error('Links sheet is missing from generated Outcome workbook.');
 verifyResourceLinks_(sheet, outcomeTemplateLinkResources_());
}
function reassertSetupProtections_(setupId, config) {
  const spreadsheet = openSpreadsheetCached_(setupId);
  const effectiveConfig = config || config_();
  const fieldConfig = templateFieldConfigRows_(clean_(effectiveConfig.SETUP_TEMPLATE_ID));
  const specs = setupWorkbookProtectionSpecs_(fieldConfig);
  removeGeneratedAdminSheets_(spreadsheet);
  ensureSpreadsheetTimeZone_(spreadsheet);
  ensureWorkbookProtectionSpecs_(spreadsheet, specs);
  SpreadsheetApp.flush();
  verifyGeneratedLinks_(spreadsheet);
  verifySpreadsheetTimeZone_(spreadsheet, 'Generated Grant Setup workbook');
  return true;
}

function removeGeneratedAdminSheet_(spreadsheet, sheetName) {
 const sheet = spreadsheet.getSheetByName(sheetName);
 if (!sheet) return false;
 [SpreadsheetApp.ProtectionType.SHEET, SpreadsheetApp.ProtectionType.RANGE].forEach(
   type => {
     sheet.getProtections(type).forEach(
       protection => {
         if (!protection.canEdit())
           throw new Error(
               `Automation cannot remove admin-sheet protection on ${sheetName}.`
             );
         protection.remove();
       }
     );
   }
 );
 if (spreadsheet.getSheets().length <= 1)
   throw new Error(`Cannot remove ${sheetName}; a spreadsheet must retain at least one sheet.`);
 spreadsheet.deleteSheet(sheet);
 return true;
}
function removeGeneratedAdminSheets_(spreadsheet) {
 [APFP.TEMPLATE_SHEETS.VALIDATION_MASTER, APFP.TEMPLATE_SHEETS.FIELD_CONFIG]
   .forEach(sheetName => removeGeneratedAdminSheet_(spreadsheet, sheetName));
}
// The Transactional template has no Links sheet, so each Upload Folder cell is written as a link to the grant's
// "Disbursement Documents" folder. Idempotent; only the Upload Folder column (outside the grantee-editable range) is touched.
function writeTransactionalUploadLinks_(spreadsheet, folderUrl) {
  const url = clean_(folderUrl);
  if (!url) throw new Error('Disbursement Folder URL is missing, so the Upload Folder links cannot be written.');
  const schema = APFP.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE, sheet = spreadsheet.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS);
  if (!sheet) throw new Error(`Transactional workbook is missing the ${APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS} sheet.`);
  const columns = columnsByHeader_(sheet, schema.HEADER_ROW, 'Transactional Disbursement workbook'),
    column = columns.col('Upload Folder') + 1,
    formula = `=HYPERLINK("${url.replace(/"/g, '""')}","Upload Folder")`,
    range = sheet.getRange(schema.DATA_START_ROW, column, schema.DATA_ROWS, 1);
  if (range.getFormulas().every(row => row[0] === formula)) return false;
  range.setFormulas(Array.from({ length: schema.DATA_ROWS }, () => [formula]));
  return true;
}
