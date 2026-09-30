// ============================================================================
// DisbursementHelpers.gs
// Central Administration disbursement helpers.
// ============================================================================
function disbNumber_(value) {
 if (value == null || value === '') return '';
 if (typeof value === 'number') return isFinite(value) ? value : null;
 const text = clean_(value).replace(/^(?:Rs\.?|INR)\s*/i, '')
   .replace(/[₹,$£€¥]/g, '').replace(/,/g, '').trim();
 if (!text || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
 const number = Number(text);
 return isFinite(number) ? number : null;
}
function disbDateValue_(value) {
 if (value instanceof Date && !isNaN(value.getTime())) return value;
 if (typeof value === 'number' && isFinite(value)) {
   const date = new Date(1899, 11, 30);
   date.setDate(date.getDate() + value);
   return isNaN(date.getTime()) ? null : date;
 }
 const text = clean_(value);
 if (!text) return null;
 const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
 if (numeric) {
   const date = new Date(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]));
   if (date.getFullYear() === Number(numeric[3]) && date.getMonth() === Number(numeric[2]) - 1 &&
       date.getDate() === Number(numeric[1])) return date;
 }
 const parsed = new Date(text);
 return isNaN(parsed.getTime()) ? null : parsed;
}

function disbHeaderRow_() {
 return APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DISBURSEMENTS;
}
function disbFirstDataRow_() {
 return disbHeaderRow_() + 1;
}
function disbTracker_() {
 const sheet = ss_().getSheetByName(APFP.SHEETS.DISBURSEMENTS);
 if (!sheet) throw new Error(`Missing sheet: ${APFP.SHEETS.DISBURSEMENTS}`);
 return sheet;
}
function disbColumn_(map, header) {
 const index = map[key_(header)];
 if (index == null) throw new Error(`Missing required Disbursement Tracker column: ${header}`);
 return index + 1;
}

// Column positions in a grantee "Disbursement Documents" sheet, resolved from its header row, so that
// added or reordered columns (for example Upload Folder) can never change what is read or written.
// col(name) throws a clear error only for a column the caller actually uses.
function granteeDisbursementTable_(workbook, grantId) {
 const schema = APFP.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE,
   sheet = workbook.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS);
 if (!sheet) throw new Error(`Disbursement Documents sheet is missing for Grant ID ${grantId}.`);
 const columns = columnsByHeader_(sheet, schema.HEADER_ROW, `Disbursement Documents for Grant ID ${grantId}`);
 return { sheet, width: columns.width, firstRow: schema.DATA_START_ROW, rows: schema.DATA_ROWS, col: columns.col };
}
// Live width of the Committed & Spent Tracker (extra columns such as the status columns are included).
function disbWidth_(sheet) {
 return Math.max(APFP.DISBURSEMENT_HEADERS.length, sheet.getLastColumn());
}
function disbHeaderMap_(sheet) {
 const width = disbWidth_(sheet);
 const headers = sheet.getRange(disbHeaderRow_(), 1, 1, width).getDisplayValues()[0];
 const map = {};
 headers.forEach((header, i) => { if (clean_(header)) map[key_(header)] = i; });
 return map;
}
