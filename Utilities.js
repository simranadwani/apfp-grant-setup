// Utilities.gs — shared caches, parsing, reads, writes, Drive helpers, and errors.
const HEADER_CACHE_ = {};
const SHEET_CACHE_ = {};
const EXTERNAL_SPREADSHEET_CACHE_ = {};
const DRIVE_FOLDER_CACHE_ = {};
const DRIVE_CHILD_FILE_CACHE_ = {};
let CONFIG_CACHE_ = null;
function ss_() {
 return SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
 const key = clean_(name);
 if (SHEET_CACHE_[key]) return SHEET_CACHE_[key];
 const sheet = ss_().getSheetByName(key);
 if (!sheet) throw new Error(`Required sheet is missing: ${key}`);
 SHEET_CACHE_[key] = sheet;
 return sheet;
}
function openSpreadsheetCached_(idOrUrl) {
 const id = urlId_(idOrUrl);
 if (!EXTERNAL_SPREADSHEET_CACHE_[id]) EXTERNAL_SPREADSHEET_CACHE_[id] = SpreadsheetApp.openById(id);
 return EXTERNAL_SPREADSHEET_CACHE_[id];
}
function clean_(value) {
 return String(value == null ? '' : value).replace(/\u00A0/g, ' ').trim();
}
function key_(value) {
 return clean_(value).toLowerCase();
}
function now_() {
 return new Date();
}
function actorEmail_() {
 try {
   return clean_(Session.getActiveUser().getEmail()) || clean_(Session.getEffectiveUser().getEmail());
 } catch (e) {
   return '';
 }
}
function id_(prefix) {
 return `${prefix}-${Utilities.formatDate(now_(), timeZone_(), 'yyyyMMddHHmmss')}-${Math.floor(1000 + Math.random() * 9000)}`;
}
function validEmail_(email) {
 return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean_(email));
}
function validFinancialYear_(fy) {
 const match = clean_(fy).match(/^(\d{4})-(\d{2})$/);
 return !!match && Number(match[2]) === ((Number(match[1]) + 1) % 100);
}
function validGrantType_(value) {
 return APFP.GRANT_TYPES.includes(clean_(value));
}
function validGrantStatus_(value) {
 return APFP.GRANT_STATUSES.includes(clean_(value));
}
function grantStatusOrDefault_(value) {
 const status = clean_(value);
 return validGrantStatus_(status) ? status : 'Active';
}
function dateValue_(value) {
 if (value instanceof Date && !isNaN(value.getTime())) return value;
 if (typeof value === 'number') {
   const d = new Date(value);
   return isNaN(d.getTime()) ? null : d;
 }
 const text = clean_(value);
 if (!text) return null;
 const indian = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
 if (indian) {
   const d = new Date(Number(indian[3]), Number(indian[2]) - 1, Number(indian[1]),
     Number(indian[4] || 0), Number(indian[5] || 0), Number(indian[6] || 0));
   if (!isNaN(d.getTime()) && d.getFullYear() === Number(indian[3]) &&
       d.getMonth() === Number(indian[2]) - 1 && d.getDate() === Number(indian[1])) return d;
 }
 const parsed = new Date(text);
 return isNaN(parsed.getTime()) ? null : parsed;
}
function financialYearFromDate_(value) {
 const d = dateValue_(value);
 if (!d) return '';
 const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
 return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
function financialYearCode_(fy) {
 if (!validFinancialYear_(fy)) throw new Error(`Invalid Financial Year: ${fy}`);
 return clean_(fy).replace('-', '');
}
function financialYearStart_(fy) {
 return validFinancialYear_(fy) ? Number(clean_(fy).slice(0, 4)) : null;
}
function prefix5_(value) {
 const x = clean_(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
 return x ? (x + 'XXXXX').slice(0, 5) : 'XXXXX';
}
function safeDriveName_(name) {
 // Google Drive permits the vertical bar used in the APFP workbook naming standard.
 return clean_(name).replace(/[\\/:*?"<>]/g, '-').replace(/\s+/g, ' ').slice(0, 180);
}
function urlId_(urlOrId) {
 const text = clean_(urlOrId);
 if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
 const match = text.match(/[-\w]{20,}/);
 if (!match) throw new Error(`Could not extract a Drive ID from: ${text}`);
 return match[0];
}
function headerMap_(sheet, headerRow) {
 const cacheKey = `${sheet.getSheetId()}|${headerRow}|${sheet.getLastColumn()}`;
 if (HEADER_CACHE_[cacheKey]) return HEADER_CACHE_[cacheKey];
 const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0], map = {};
 headers.forEach((header, index) => {
   const k = key_(header);
   if (k) map[k] = index;
 });
 HEADER_CACHE_[cacheKey] = map;
 return map;
}
// 1-based column of a Workspace Creator header, looked up in the live header row (adding or moving columns needs no code change).
function intakeColumn_(headerName) {
 const index = headerMap_(sheet_(APFP.SHEETS.INTAKE), APFP.INTAKE.HEADER_ROW)[key_(headerName)];
 if (index == null) throw new Error(`${APFP.SHEETS.INTAKE} is missing the column "${headerName}".`);
 return index + 1;
}
function invalidateDataCachesForSheet_(sheetName, rowNumber, patch, isAppend) {
 if (typeof updateRegistryCacheForWrite_ === 'function') updateRegistryCacheForWrite_(sheetName, rowNumber, patch, !!isAppend);
 else if (typeof invalidateRegistryCacheForSheet_ === 'function') invalidateRegistryCacheForSheet_(sheetName);
}
function adminTableSpecBySheet_(sheetName) {
 return APFP.ADMIN_TABLES.find(spec => spec.SHEET_NAME === sheetName) || null;
}
function isAdminTableSheet_(sheetName) {
 return !!adminTableSpecBySheet_(sheetName);
}
function adminTableColumnSpec_(sheetName, headerName) {
 const table = adminTableSpecBySheet_(sheetName);
 return table ? (table.COLUMNS.find(column => key_(column.NAME) === key_(headerName)) || null) : null;
}
function parseAdminTableNumber_(value) {
 if (value == null || value === '') return '';
 if (typeof value === 'number') return isFinite(value) ? value : null;
 const text = clean_(value);
 if (!text) return '';
 const normalised = text.replace(/^(?:Rs\.?|INR)\s*/i, '').replace(/[₹,$£€¥]/g, '')
   .replace(/,/g, '').replace(/%$/, '').trim();
 if (!normalised || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalised)) return null;
 const number = Number(normalised);
 return isFinite(number) ? number : null;
}
function coerceAdminTableValue_(sheetName, headerName, value) {
 const spec = adminTableColumnSpec_(sheetName, headerName);
 if (!spec) return value;
 if (value == null || value === '') return '';
 if (spec.FORMAT === 'INDIAN_CURRENCY') {
   const number = parseAdminTableNumber_(value);
   if (number == null) throw new Error(`Invalid currency value for ${sheetName} → ${headerName}: ${value}`);
   return number;
 }
 if (spec.TYPE === 'DOUBLE' || spec.TYPE === 'CURRENCY' || spec.TYPE === 'PERCENT') {
   const number = parseAdminTableNumber_(value);
   if (number == null) throw new Error(`Invalid numeric value for ${sheetName} → ${headerName}: ${value}`);
   return number;
 }
 if (spec.TYPE === 'DATE' || spec.TYPE === 'DATE_TIME' || spec.TYPE === 'TIME') {
   const date = dateValue_(value);
   if (!date) throw new Error(`Invalid date/time value for ${sheetName} → ${headerName}: ${value}`);
   return date;
 }
 if (spec.TYPE === 'BOOLEAN') {
   if (value === true || value === false) return value;
   const text = key_(value);
   if (text === 'true' || text === 'yes') return true;
   if (text === 'false' || text === 'no') return false;
   throw new Error(`Invalid boolean value for ${sheetName} → ${headerName}: ${value}`);
 }
 if (typeof value === 'string' && value.charAt(0) === '=') return value;
 return String(value);
}
function requireAdvancedSheetsService_() {
 if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets)
   throw new Error('Advanced Sheets service is not enabled. Deploy the appsscript.json from the current codebook, authorise the script, then run runPreflightChecks() again.');
}
function adminTablesSnapshot_() {
 requireAdvancedSheetsService_();
 return Sheets.Spreadsheets.get(ss_().getId(), {
   fields: 'sheets(properties(sheetId,title),tables(tableId,name,range,columnProperties(columnIndex,columnName,columnType,dataValidationRule)))'
 });
}
function timeZone_() {
 try {
   return clean_(config_().TIME_ZONE) || APFP.TIME_ZONE;
 } catch (error) {
   return APFP.TIME_ZONE;
 }
}
function tableColumnProperties_(spec) {
 return spec.COLUMNS.map((column, index) => {
   const out = { columnIndex: index, columnName: column.NAME, columnType: column.TYPE };
   if (column.TYPE === 'DROPDOWN') {
     const values = column.DYNAMIC === 'ORG_IDS' ? organisationNameOptions_()
       : column.DYNAMIC === 'MATURITY_ASPECTS' ? maturityAspectOptions_()
       : column.DYNAMIC === 'MATURITY_INDICATORS' ? maturityIndicatorOptions_()
       : column.DYNAMIC === 'MATURITY_STATUSES' ? maturityStatusOptions_()
       : (column.VALUES || []);
     out.dataValidationRule = {
       condition: { type: 'ONE_OF_LIST', values: [...new Set(values)].map(value => ({ userEnteredValue: String(value) })) }
     };
   }
   return out;
 });
}
function extendAdminTableRows_(sheetName) {
 const spec = adminTableSpecBySheet_(sheetName);
 if (!spec) return;
 extendTableToSheetEnd_(sheetName, spec.TABLE_NAME);
}
// Grows a native Google Sheets Table so it covers every row of its sheet (used after rows were inserted at the bottom).
// Without tableName the sheet must contain exactly one Table.
function extendTableToSheetEnd_(sheetName, tableName) {
 const sheet = sheet_(sheetName), snapshot = adminTablesSnapshot_(),
   item = (snapshot.sheets || []).find(entry => entry.properties && entry.properties.title === sheetName),
   tables = item && item.tables || [],
   table = tableName ? tables.find(entry => entry.name === tableName) : (tables.length === 1 ? tables[0] : null);
 if (!table) throw new Error(tableName
   ? `${sheetName} is missing Google Sheets Table ${tableName}.`
   : `${sheetName} must contain exactly one Google Sheets Table to grow it; found ${tables.length}.`);
 const range = Object.assign({}, table.range || {});
 if ((range.endRowIndex || 0) >= sheet.getMaxRows()) return;
 range.endRowIndex = sheet.getMaxRows();
 Sheets.Spreadsheets.batchUpdate({ requests: [{
   updateTable: { table: { tableId: table.tableId, range }, fields: 'range' }
 }] }, ss_().getId());
}
// Column positions of any sheet, found from its header row (first match wins, so repeated headers such as
// "Upload Folder" are harmless). col(name) throws a clear error only for a column the caller actually uses.
// Compares a live header row with the REQUIRED header names: order and extra columns are allowed (extras are only reported).
function headerGaps_(actualRow, requiredHeaders) {
 const actual = (actualRow || []).map(clean_).filter(Boolean), actualKeys = new Set(actual.map(key_)),
   requiredKeys = new Set(requiredHeaders.map(key_).concat([APFP.DISBURSEMENT_STATUS.PUSH_COLUMN, APFP.DISBURSEMENT_STATUS.SYNC_COLUMN].map(key_)));
 return {
   missing: requiredHeaders.filter(header => !actualKeys.has(key_(header))),
   extra: actual.filter(header => !requiredKeys.has(key_(header)))
 };
}
function columnsByHeader_(sheet, headerRow, label) {
 const width = sheet.getLastColumn(), positions = {};
 sheet.getRange(headerRow, 1, 1, width).getDisplayValues()[0].forEach((header, index) => {
   const name = key_(header);
   if (name && positions[name] == null) positions[name] = index;
 });
 return {
   width,
   has(name) { return positions[key_(name)] != null; },
   col(name) {
     if (positions[key_(name)] == null) throw new Error(`${label} is missing the column "${name}".`);
     return positions[key_(name)];
   },
   // A row as an object keyed by lower-cased header ("financial year"), so callers never depend on column order.
   record(row) {
     const out = {};
     Object.keys(positions).forEach(name => { out[name] = row[positions[name]]; });
     return out;
   }
 };
}
function dropdownValuesFromTableColumn_(column) {
 const condition = column && column.dataValidationRule && column.dataValidationRule.condition;
 if (!condition || condition.type !== 'ONE_OF_LIST') return [];
 return (condition.values || []).map(item => clean_(item.userEnteredValue));
}
function checkAdminTables_(errors, warnings, specs) {
 try {
   const snapshot = adminTablesSnapshot_(), bySheet = {};
   (snapshot.sheets || []).forEach(item => {
     const title = item.properties && item.properties.title;
     if (title) bySheet[title] = item;
   });
   (specs || APFP.ADMIN_TABLES).forEach(spec => {
     const item = bySheet[spec.SHEET_NAME];
     if (!item) { errors.push(`Missing Admin table sheet: ${spec.SHEET_NAME}`); return; }
     const table = (item.tables || []).find(t => t.name === spec.TABLE_NAME);
     if (!table) { errors.push(`${spec.SHEET_NAME} is missing Google Sheets Table ${spec.TABLE_NAME}.`); return; }
     const range = table.range || {};
     const expectedStartRow = Number(spec.HEADER_ROW ||
       (spec.SHEET_NAME === APFP.SHEETS.INTAKE ? APFP.INTAKE.HEADER_ROW : 1)) - 1;
     // The Table must start in column A and be at least as wide as the required columns; extra columns are allowed.
     if ((range.startRowIndex || 0) !== expectedStartRow || range.startColumnIndex !== 0 || range.endColumnIndex < spec.COLUMNS.length ||
         (range.endRowIndex || 0) < (spec.MIN_ROWS || 500))
       errors.push(`${spec.TABLE_NAME} range does not match the expected ${spec.SHEET_NAME} table structure.`);
     const columns = table.columnProperties || [], expectedColumns = tableColumnProperties_(spec), requiredNames = new Set(spec.COLUMNS.map(c => key_(c.NAME)).concat([APFP.DISBURSEMENT_STATUS.PUSH_COLUMN, APFP.DISBURSEMENT_STATUS.SYNC_COLUMN].map(key_)));
     const extra = columns.map(c => clean_(c.columnName)).filter(name => name && !requiredNames.has(key_(name)));
     if (extra.length && warnings) warnings.push(`${spec.TABLE_NAME} has extra column(s) the code leaves alone: ${extra.join(', ')}.`);
     spec.COLUMNS.forEach((expected, index) => {
       const actual = columns.find(c => key_(c.columnName) === key_(expected.NAME));
       if (!actual) { errors.push(`${spec.TABLE_NAME} is missing required column "${expected.NAME}".`); return; }
       if (expected.ANY_TYPE) return;
       const reportedType = clean_(actual.columnType).toUpperCase(),
         actualType = !reportedType || reportedType === 'UNSPECIFIED'
           ? 'COLUMN_TYPE_UNSPECIFIED' : reportedType;
       if (actualType !== expected.TYPE)
         errors.push(`${spec.TABLE_NAME}.${expected.NAME} should be type ${expected.TYPE}; found ${actualType}.`);
       // FREE dropdowns (thematic areas, financial year, ...) are edited freely in the sheet: only the column type is checked.
       if (expected.TYPE === 'DROPDOWN' && !expected.FREE) {
         const expectedValues = dropdownValuesFromTableColumn_(expectedColumns[index]),
           actualValues = dropdownValuesFromTableColumn_(actual);
         // Order and blanks do not matter, and extra values are allowed: every value the code relies on must be present.
         const have = new Set(actualValues.map(key_)), missingValues = expectedValues.filter(v => v && !have.has(key_(v)));
         if (missingValues.length)
           errors.push(`${spec.TABLE_NAME}.${expected.NAME} dropdown is missing option(s): ${missingValues.join(', ')}.`);
       }
     });
   });
 } catch (e) {
   errors.push(`Advanced Sheets Table check failed: ${e.message}`);
 }
}
function rowObject_(sheetName, headerRow, rowNumber) {
 const sheet = sheet_(sheetName), width = sheet.getLastColumn(),
   headers = sheet.getRange(headerRow, 1, 1, width).getDisplayValues()[0],
   // Preserve Date/number/boolean types. Display strings are locale-dependent
   // (for example, hi_IN can return a Hindi month abbreviation) and must not
   // be fed back into typed Table columns during a refresh.
   values = sheet.getRange(rowNumber, 1, 1, width).getValues()[0], out = {};
 headers.forEach((h, i) => out[h] = values[i]);
 return out;
}
function rowObjectFromArrays_(headers, values) {
 const out = {};
 headers.forEach((h, i) => out[h] = values[i]);
 return out;
}
function findRows_(sheetName, headerRow, headerName, value) {
 const sheet = sheet_(sheetName);
 if (sheet.getLastRow() <= headerRow) return [];
 const map = headerMap_(sheet, headerRow), index = map[key_(headerName)];
 if (index == null) throw new Error(`Header ${headerName} not found on ${sheetName}`);
 const text = clean_(value);
 if (!text) return [];
 return sheet.getRange(headerRow + 1, index + 1, sheet.getLastRow() - headerRow, 1)
   .createTextFinder(text).matchEntireCell(true).matchCase(false).findAll().map(r => r.getRow());
}
function comparable_(value) {
 if (value instanceof Date) return String(value.getTime());
 if (typeof value === 'number') return String(value);
 if (value === true || value === false) return String(value);
 return clean_(value);
}
// Splits an ascending list into runs of consecutive numbers (by keyFn, default identity),
// so contiguous cells/rows can be written with one setValues call.
function groupConsecutive_(items, keyFn) {
 const key = keyFn || (x => x), groups = [];
 items.forEach((item, i) => {
   if (i > 0 && key(item) === key(items[i - 1]) + 1) groups[groups.length - 1].push(item);
   else groups.push([item]);
 });
 return groups;
}
function writeChangedSegments_(sheet, rowNumber, changes) {
 if (!changes.length) return false;
 changes.sort((a, b) => a.index - b.index);
 groupConsecutive_(changes, change => change.index).forEach(items => {
   const start = items[0].index, values = items.map(item => item.value);
   sheet.getRange(rowNumber, start + 1, 1, values.length).setValues([values]);
 });
 return true;
}
// knownRecord (optional): the row's current values by header, from the registry cache. When given, the row is not re-read from the sheet.
function setByHeaders_(sheetName, headerRow, rowNumber, patch, knownRecord) {
 const headers = Object.keys(patch || {});
 if (!headers.length) return false;
 const sheet = sheet_(sheetName), map = headerMap_(sheet, headerRow);
 if (knownRecord) return setByHeadersKnown_(sheet, sheetName, map, rowNumber, patch, knownRecord);
 const width = sheet.getLastColumn(),
   range = sheet.getRange(rowNumber, 1, 1, width), current = range.getValues()[0],
   needsFormulaRead = headers.some(header => typeof patch[header] === 'string' && patch[header].charAt(0) === '='),
   formulas = needsFormulaRead ? range.getFormulas()[0] : null, changes = [];
 headers.forEach(header => {
   const index = map[key_(header)];
   if (index == null) throw new Error(`Header ${header} not found on ${sheetName}`);
   const next = isAdminTableSheet_(sheetName) ? coerceAdminTableValue_(sheetName, header, patch[header]) : patch[header],
     isFormula = typeof next === 'string' && next.charAt(0) === '=',
     old = isFormula ? (formulas ? formulas[index] : '') : current[index];
   if (comparable_(old) !== comparable_(next)) changes.push({ index, value: next });
 });
 const changed = writeChangedSegments_(sheet, rowNumber, changes);
 if (changed) invalidateDataCachesForSheet_(sheetName, rowNumber, patch, false);
 return changed;
}
const ADMIN_TABLE_GROWTH_ROWS_ = 100;
function setByHeadersKnown_(sheet, sheetName, map, rowNumber, patch, knownRecord) {
 const known = {};
 Object.keys(knownRecord).forEach(name => { known[key_(name)] = knownRecord[name]; });
 const changes = [];
 Object.keys(patch).forEach(header => {
   const index = map[key_(header)];
   if (index == null) throw new Error(`Header ${header} not found on ${sheetName}`);
   const next = isAdminTableSheet_(sheetName) ? coerceAdminTableValue_(sheetName, header, patch[header]) : patch[header];
   if (comparable_(known[key_(header)]) !== comparable_(next)) changes.push({ index, value: next });
 });
 const changed = writeChangedSegments_(sheet, rowNumber, changes);
 if (changed) invalidateDataCachesForSheet_(sheetName, rowNumber, patch, false);
 return changed;
}
function appendObject_(sheetName, headerRow, object) {
 const sheet = sheet_(sheetName), headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0],
   target = Math.max(headerRow + 1, sheet.getLastRow() + 1);
 if (target > sheet.getMaxRows()) {
   // Grow with headroom: extending a native Table is a slow API call, so do it rarely, not on every new row.
   sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(1, target - sheet.getMaxRows()) + ADMIN_TABLE_GROWTH_ROWS_);
   if (isAdminTableSheet_(sheetName)) extendAdminTableRows_(sheetName);
 }
 if (isAdminTableSheet_(sheetName)) {
   setByHeaders_(sheetName, headerRow, target, object);
   sheet.getRange(target, 1, 1, headers.length).setFontFamily(APFP.FONT_FAMILY);
 } else {
   const row = headers.map(h => Object.prototype.hasOwnProperty.call(object, h) ? object[h] : '');
   sheet.getRange(target, 1, 1, headers.length).setValues([row]).setFontFamily(APFP.FONT_FAMILY);
   invalidateDataCachesForSheet_(sheetName, target, object, true);
 }
 return target;
}
function config_() {
 if (CONFIG_CACHE_) return Object.assign({}, CONFIG_CACHE_);
 const sheet = sheet_(APFP.SHEETS.CONFIG);
 if (sheet.getLastRow() < 3) return {};
 const rows = sheet.getRange(3, 1, sheet.getLastRow() - 2, Math.min(sheet.getLastColumn(), 8)).getDisplayValues(), out = {};
 rows.forEach(row => {
   const name = clean_(row[0]);
   if (!name) return;
   const activeCell = clean_(row[5]);
   if (!activeCell || key_(activeCell) === 'yes') out[name] = row[1];
 });
 CONFIG_CACHE_ = out;
 return Object.assign({}, out);
}
function requireConfig_(config, keys) {
 const missing = keys.filter(k => !clean_(config[k]));
 if (missing.length) throw new Error(`Missing active configuration: ${missing.join(', ')}`);
}
function patternName_(pattern, request) {
 return safeDriveName_(clean_(pattern)
   .replace(/<organisation_name>/g, request.organisationName)
   .replace(/<project_title>/g, request.projectTitle)
   .replace(/<financial_year>/g, request.financialYear));
}
function findExactChildFolders_(parentFolder, name) {
 const found = [], it = parentFolder.getFoldersByName(name);
 while (it.hasNext()) found.push(it.next());
 return found;
}
function getOrCreateUniqueChildFolder_(parentFolder, name) {
 const cacheKey = `${parentFolder.getId()}|${clean_(name)}`;
 if (DRIVE_FOLDER_CACHE_[cacheKey]) return DRIVE_FOLDER_CACHE_[cacheKey];
 const matches = findExactChildFolders_(parentFolder, name);
 if (matches.length > 1)
   throw new Error(`Multiple folders named "${name}" exist under ${parentFolder.getName()}. Resolve the duplicate folders before rerunning.`);
 const folder = matches.length === 1 ? matches[0] : parentFolder.createFolder(name);
 DRIVE_FOLDER_CACHE_[cacheKey] = folder;
 return folder;
}
function folderFromSavedOrCreate_(parentFolder, savedUrl, name) {
 if (clean_(savedUrl)) {
   const id = urlId_(savedUrl), cacheKey = `id|${id}`;
   try {
     if (!DRIVE_FOLDER_CACHE_[cacheKey]) DRIVE_FOLDER_CACHE_[cacheKey] = DriveApp.getFolderById(id);
     return DRIVE_FOLDER_CACHE_[cacheKey];
   } catch (error) {
     console.warn(`Saved folder URL could not be reopened; resolving by name instead: ${error.message}`);
   }
 }
 return getOrCreateUniqueChildFolder_(parentFolder, name);
}
function findChildSpreadsheetByName_(folder, name) {
 const cacheKey = `${folder.getId()}|${clean_(name)}`;
 if (Object.prototype.hasOwnProperty.call(DRIVE_CHILD_FILE_CACHE_, cacheKey))
   return DRIVE_CHILD_FILE_CACHE_[cacheKey];
 const it = folder.getFilesByName(name), matches = [];
 while (it.hasNext()) {
   const f = it.next();
   if (f.getMimeType() === MimeType.GOOGLE_SHEETS) matches.push(f);
 }
 if (matches.length > 1)
   throw new Error(`Multiple Google Sheets files named "${name}" exist in ${folder.getName()}. Resolve duplicates before rerunning.`);
 DRIVE_CHILD_FILE_CACHE_[cacheKey] = matches[0] || null;
 return DRIVE_CHILD_FILE_CACHE_[cacheKey];
}
function hyperlinkFormula_(label, url) {
 const l = String(label).replace(/"/g, '""'), u = String(url).replace(/"/g, '""');
 return `=HYPERLINK("${u}","${l}")`;
}
function writeException_(data) {
 appendObject_(APFP.SHEETS.EXCEPTIONS, 2, {
   'Exception ID': id_('EXC'), 'Detected At': now_(), 'Exception Type': data.type || 'Automation Error',
   'Severity': data.severity || 'Medium', 'Status': 'Open', 'Organisation ID': data.organisationId || '',
   'Grant ID': data.grantId || '', 'Workspace ID': data.workspaceId || '',
   'Sheet or Folder': data.location || '', 'Field or File': data.field || '',
   'Issue Description': data.message || '',
   'Recommended Action': data.recommendedAction || 'Review the issue, correct it, and retry the relevant action.',
   'Assigned To': '', 'Resolved At': '', 'Resolution Notes': '', 'Run ID': data.runId || ''
 });
}
function friendlyErrorMessage_(code, error) {
 const message = clean_(error && error.message ? error.message : error), errorKey = key_(code);
 if (errorKey === 'sharing_failed')
   return 'Workspace was created, but sharing could not be completed. Check the Primary Contact Email, correct it if needed, then retry.';
 if (errorKey === 'notification_failed')
   return 'Workspace access is ready, but the notification email could not be sent. Check the Primary Contact Email and retry; the email will not be sent twice after a successful send.';
 if (errorKey === 'master_sync_failed')
   return 'Approved data could not be updated or the approved Setup could not be locked. Review the Setup Workbook and run APFP Grant Workspace → Approve setup and update records again.';
 if (errorKey === 'setup_archive_failed')
   return 'Approved data was processed, but the Setup workbook could not be moved to read-only storage. Run APFP Grant Workspace → Approve setup and update records again; it is safe to retry.';
 if (errorKey === 'reopen_failed')
   return 'The Setup workbook could not be reopened. Select the correct Workspace Creator row and contact the automation administrator if the issue repeats.';
 if (message.indexOf('Multiple folders named') >= 0 || message.indexOf('Multiple Google Sheets files named') >= 0)
   return 'Duplicate folders or workbooks were found. Resolve the duplicate before retrying.';
 return message || 'Something needs attention. Review this row and retry after correcting the issue.';
}
function permissionForUser_(fileId, email) {
 const result = Drive.Permissions.list(fileId, {
   supportsAllDrives: true,
   fields: 'permissions(id,type,role,emailAddress,view,permissionDetails(inherited))'
 }), wanted = key_(email),
   matches = (result.permissions || []).filter(p => p.type === 'user' && key_(p.emailAddress) === wanted && p.view !== 'metadata'),
   direct = matches.find(p => {
     const details = p.permissionDetails || [];
     return !details.length || details.some(d => d.inherited === false);
   }), permission = direct || matches[0] || null;
 if (!permission) return null;
 return Object.assign({}, permission, { _apfpDirect: !!direct && direct.id === permission.id });
}
function ensureUserRole_(fileId, email, role, config) {
 if (!validEmail_(email)) throw new Error('A valid Primary Contact Email is required for sharing.');
 const existing = permissionForUser_(fileId, email);
 if (existing) {
   const existingRole = key_(existing.role), requestedRole = key_(role);
   if (existingRole === 'owner' || existingRole === requestedRole) return existing;
   if (existing._apfpDirect && existing.id) return Drive.Permissions.update({ role }, fileId, existing.id, {
     supportsAllDrives: true, fields: 'id,type,role,emailAddress,view'
   });
 }
 const sendNotification = key_(config && config.SEND_SHARING_NOTIFICATION) === 'yes', options = {
   supportsAllDrives: true, sendNotificationEmail: sendNotification, fields: 'id,type,role,emailAddress,view'
 };
 if (sendNotification && role !== 'reader') options.emailMessage = 'Your APFP grant workspace is ready.';
 return Drive.Permissions.create({ type: 'user', role, emailAddress: email }, fileId, options);
}
function restoreUserPermission_(fileId, email, snapshot, config) {
 const current = permissionForUser_(fileId, email);
 if (snapshot && snapshot._apfpDirect) {
   ensureUserRole_(fileId, email, snapshot.role, config);
   return true;
 }
 if (current && current._apfpDirect && current.id) {
   Drive.Permissions.remove(fileId, current.id, { supportsAllDrives: true });
 }
 return true;
}
function removeDirectUserPermission_(fileId, email) {
 const permission = permissionForUser_(fileId, email);
 if (!permission || !permission._apfpDirect || !permission.id) return false;
 Drive.Permissions.remove(fileId, permission.id, { supportsAllDrives: true });
 return true;
}
function moveFileToFolder_(fileId, destinationFolderId) {
 const meta = Drive.Files.get(fileId, { supportsAllDrives: true, fields: 'id,name,parents' }), parents = meta.parents || [];
 if (parents.indexOf(destinationFolderId) >= 0 && parents.length === 1) return meta;
 const removeParents = parents.filter(id => id !== destinationFolderId).join(','),
   options = { supportsAllDrives: true, addParents: destinationFolderId, fields: 'id,name,parents,webViewLink' };
 if (removeParents) options.removeParents = removeParents;
 return Drive.Files.update({}, fileId, null, options);
}
function findShortcutToTarget_(parentFolderId, targetFileId) {
 const result = Drive.Files.list({
   q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.shortcut' and trashed=false`,
   supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: 100,
   fields: 'files(id,name,parents,webViewLink,shortcutDetails(targetId))'
 }), matches = (result.files || []).filter(f => f.shortcutDetails && key_(f.shortcutDetails.targetId) === key_(targetFileId));
 if (matches.length > 1) throw new Error(`Multiple shortcuts point to Setup workbook ${targetFileId}. Resolve duplicates before rerunning.`);
 return matches[0] || null;
}
function ensureShortcutToTarget_(parentFolderId, targetFileId, shortcutName) {
 const existing = findShortcutToTarget_(parentFolderId, targetFileId);
 if (existing) return existing;
 return Drive.Files.create({
   name: shortcutName, mimeType: 'application/vnd.google-apps.shortcut', parents: [parentFolderId],
   shortcutDetails: { targetId: targetFileId }
 }, null, { supportsAllDrives: true, fields: 'id,name,parents,webViewLink,shortcutDetails(targetId)' });
}
function deleteShortcutToTarget_(parentFolderId, targetFileId) {
 const existing = findShortcutToTarget_(parentFolderId, targetFileId);
 if (!existing) return false;
 Drive.Files.remove(existing.id, { supportsAllDrives: true });
 return true;
}
