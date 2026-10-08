// ============================================================================
// ReportingSupportDecisions.gs
// APFP — Central outcome, support, decision, and disbursement reporting.
// ============================================================================
function phase2TrackerTableSpecs_() {
  const headers = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS;
  return [
    { sheetName: APFP.SHEETS.OUTCOMES, width: headers.OUTCOMES.length },
    { sheetName: APFP.SHEETS.SUPPORT, width: headers.SUPPORT.length },
    { sheetName: APFP.SHEETS.DECISIONS, width: headers.DECISIONS.length }
  ];
}
function phase2TrackerTablesSnapshot_(trackerId) {
  requireAdvancedSheetsService_();
  return Sheets.Spreadsheets.get(clean_(trackerId), {
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),tables(tableId,name,range,columnProperties))'
  });
}
function checkPhase2TrackerTables_(errors) {
  try {
    const trackerId = ss_().getId(), tracker = openSpreadsheetCached_(trackerId),
      snapshot = phase2TrackerTablesSnapshot_(trackerId), bySheet = {};
    (snapshot.sheets || []).forEach(item => {
      const title = item.properties && item.properties.title;
      if (title) bySheet[title] = item;
    });
    phase2TrackerTableSpecs_().forEach(spec => {
      const sheet = tracker.getSheetByName(spec.sheetName), tables = (bySheet[spec.sheetName] || {}).tables || [];
      if (!sheet) { errors.push(`Outcome / Support / Decision Tracker is missing sheet: ${spec.sheetName}`); return; }
      if (tables.length !== 1) { errors.push(`${spec.sheetName} must contain exactly one Google Sheets Table; found ${tables.length}.`); return; }
      const range = tables[0].range || {};
      if (range.startRowIndex !== 1 || range.startColumnIndex !== 0 || range.endColumnIndex < spec.width || range.endRowIndex !== sheet.getMaxRows())
        errors.push(`${spec.sheetName} Table must cover all rows and at least the first ${spec.width} required columns.`);
    });
  } catch (e) {
    errors.push(`Outcome / Support / Decision Table check failed: ${e.message}`);
  }
}
function checkDisbursementTrackerTable_(errors) {
  try {
    const sheet = ss_().getSheetByName(APFP.SHEETS.DISBURSEMENTS);
    if (!sheet) { errors.push(`Missing sheet: ${APFP.SHEETS.DISBURSEMENTS}`); return; }
    const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DISBURSEMENTS,
      gaps = headerGaps_(sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0], APFP.DISBURSEMENT_HEADERS);
    if (gaps.missing.length) errors.push(`Disbursement tracker is missing required header(s): ${gaps.missing.join(', ')}.`);
  } catch (error) { errors.push(`Disbursement check failed: ${error.message}`); }
}
function grantRegistryRecords_() {
  return grantRegistryRows_().filter(item => clean_(item.record['Grant ID']));
}
function outcomeProgressWorkbookUrlForGrant_(grantId) {
  const technical = techByGrantId_(grantId);
  return technical ? clean_(technical.record['Outcome Progress Workbook URL']) : '';
}
function outcomeProgressWorkbookForGrant_(grantId) {
  const grant = grantById_(grantId);
  if (!grant || isTransactionalGrantType_(grant.record['Grant Type']) || isDiscretionaryGrantType_(grant.record['Grant Type'])) return null;
  const url = outcomeProgressWorkbookUrlForGrant_(grantId);
  return url ? openSpreadsheetCached_(url) : null;
}
function disbursementWorkbookForGrant_(grantId) {
  const grant = grantById_(grantId);
  if (!grant || isDiscretionaryGrantType_(grant.record['Grant Type'])) return null;
  if (!isTransactionalGrantType_(grant.record['Grant Type'])) return outcomeProgressWorkbookForGrant_(grantId);
  const tech = techByGrantId_(grantId), url = tech ? clean_(tech.record['Disbursement Workbook URL']) : '';
  return url ? openSpreadsheetCached_(url) : null;
}
function nextOutcomeId_(grantId, used, startAt) {
  let n = startAt || 1, candidate;
  do { candidate = `OUT-${grantId}-${String(n++).padStart(2, '0')}`; } while (used.has(key_(candidate)));
  used.add(key_(candidate));
  return { id: candidate, next: n };
}
function rowValuesEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, i) => comparable_(value) === comparable_(b[i]));
}
function writeChangedMatrixRows_(sheet, startRow, startColumn, current, desired) {
  const changed = [];
  for (let i = 0; i < desired.length; i++) if (!rowValuesEqual_(current[i] || [], desired[i])) changed.push(i);
  if (!changed.length) return 0;
  groupConsecutive_(changed).forEach(indexes => {
    const first = indexes[0], values = indexes.map(index => desired[index]);
    sheet.getRange(startRow + first, startColumn, values.length, desired[0].length).setValues(values);
  });
  return changed.length;
}
// Decides which sheet row each approved indicator lives in, so an outcome keeps its row (where the grantee types the
// quarterly progress) and its Outcome ID even when the Setup lists the indicators in a different order.
//   1. an indicator whose text already exists keeps that row;
//   2. an edited indicator (text changed) at the same position keeps the row of the outcome it replaces;
//   3. a new indicator takes a row that has never held an outcome (retired outcomes keep their row and ID).
function planOutcomeRows_(existingRows, indicators) {
  const norm = value => key_(String(value == null ? '' : value).replace(/\s+/g, ' ')),
    wanted = indicators.map(norm), claimedBy = existingRows.map(() => -1), rowOf = indicators.map(() => -1);
  wanted.forEach((text, s) => {
    if (!text) return;
    const row = existingRows.findIndex((r, i) => claimedBy[i] < 0 && r.id && norm(r.indicator) === text);
    if (row >= 0) { claimedBy[row] = s; rowOf[s] = row; }
  });
  wanted.forEach((text, s) => {
    if (!text || rowOf[s] >= 0 || s >= existingRows.length) return;
    if (claimedBy[s] < 0 && existingRows[s].id && norm(existingRows[s].indicator)) { claimedBy[s] = s; rowOf[s] = s; }
  });
  wanted.forEach((text, s) => {
    if (!text || rowOf[s] >= 0) return;
    const row = existingRows.findIndex((r, i) => claimedBy[i] < 0 && !r.id);
    if (row < 0) throw new Error(`Outcome Progress has no free row for the indicator "${clean_(indicators[s])}". ` +
      'Retired outcomes keep their rows and IDs; ask an administrator to review the Outcome Progress sheet.');
    claimedBy[row] = s;
    rowOf[s] = row;
  });
  return claimedBy;
}
// Writes the five system columns of a grantee Outcome Progress sheet (by header name, changed cells only).
function writeOutcomeSystemColumns_(table, grantId, projectTitle, indicators, targets) {
  const cols = {
    grantId: table.col('Grant ID'), title: table.col('Grant Title'), id: table.col('Outcome ID'),
    indicator: table.col('Outcome / Indicator'), target: table.col('End-of-Program Cycle Target')
  };
  const existing = table.sheet.getRange(table.firstRow, 1, table.rows, table.width).getValues(), usedIds = new Set();
  existing.forEach((row, i) => {
    const id = clean_(row[cols.id]);
    if (!id) return;
    if (usedIds.has(key_(id))) throw new Error(`Duplicate Outcome ID ${id} found in Outcome Progress row ${table.firstRow + i}.`);
    usedIds.add(key_(id));
  });
  const claimedBy = planOutcomeRows_(existing.map(row => ({ id: clean_(row[cols.id]), indicator: clean_(row[cols.indicator]) })), indicators);
  let seq = 1, count = 0;
  const desired = existing.map((row, i) => {
    const out = row.slice(), s = claimedBy[i];
    let outcomeId = clean_(row[cols.id]);
    out[cols.grantId] = grantId;
    out[cols.title] = projectTitle;
    if (s >= 0) {
      if (!outcomeId) {
        const made = nextOutcomeId_(grantId, usedIds, seq);
        outcomeId = made.id;
        seq = made.next;
      }
      out[cols.indicator] = clean_(indicators[s]);
      out[cols.target] = targets[s] == null ? '' : targets[s];
      count++;
    } else {
      out[cols.indicator] = '';
      out[cols.target] = '';
    }
    out[cols.id] = outcomeId;
    return out;
  });
  Object.keys(cols).forEach(name => {
    const column = cols[name], changed = [];
    desired.forEach((row, i) => { if (comparable_(row[column]) !== comparable_(existing[i][column])) changed.push(i); });
    groupConsecutive_(changed).forEach(run => table.sheet.getRange(table.firstRow + run[0], column + 1, run.length, 1)
      .setValues(run.map(i => [desired[i][column]])));
  });
  return count;
}
function syncApprovedOutcomesToGranteeWorkbook_(grantId, sourceSetupId, deferCentralRefresh) {
  const grant = grantById_(grantId);
  if (!grant || isTransactionalGrantType_(grant.record['Grant Type'])) return 0;
  const target = outcomeProgressWorkbookForGrant_(grantId);
  if (!target) throw new Error(`Outcome Progress Workbook is missing for Grant ID ${grantId}.`);
  const config = config_();
  requireConfig_(config, ['SETUP_TEMPLATE_ID']);
  const source = openSpreadsheetCached_(sourceSetupId), fieldConfig = templateFieldConfigRows_(config.SETUP_TEMPLATE_ID), byCode = {};
  fieldConfig.forEach(row => byCode[clean_(row['Field Code'])] = row);
  if (!byCode.outcome_indicator || !byCode.outcome_target)
    throw new Error('Setup Field Config is missing outcome_indicator or outcome_target.');
  const indicators = readTableConfigured_(source, byCode.outcome_indicator).flat(),
    targets = readTableConfigured_(source, byCode.outcome_target).flat(),
    sheet = target.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES);
  if (!sheet) throw new Error(`Outcome Progress sheet is missing for Grant ID ${grantId}.`);
  const schema = APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE,
    columns = columnsByHeader_(sheet, schema.DATA_START_ROW - 1, `Outcome Progress for Grant ID ${grantId}`),
    table = { sheet, width: columns.width, col: columns.col, firstRow: schema.DATA_START_ROW, rows: schema.DATA_ROWS };
  const count = writeOutcomeSystemColumns_(table, grantId, clean_(grant.record['Project Title']), indicators, targets);
  if (!deferCentralRefresh) refreshOutcomeProgressTracker_();
  return count;
}
function trackerKey_(row, indexes) {
  const parts = indexes.map(index => key_(row[index]));
  return parts.every(Boolean) ? parts.join('|') : '';
}
// Extra rows added whenever a tracker table is full (history is never deleted, so tables must be able to grow).
const TRACKER_GROWTH_ROWS_ = 100;
function upsertTrackerRowsByKey_(sheet, width, desiredRows, keyIndexes, preserveUnmatched) {
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS[Object.keys(APFP.SHEETS).find(key => APFP.SHEETS[key] === sheet.getName())] || 1, capacity = sheet.getMaxRows() - headerRow;
  const existing = capacity > 0 ? sheet.getRange(headerRow + 1, 1, capacity, width).getValues() : [],
    existingByKey = {}, emptyIndexes = [];
  existing.forEach((row, i) => {
    const key = trackerKey_(row, keyIndexes);
    if (key) {
      if (existingByKey[key] != null) throw new Error(`Duplicate key ${key} found in ${sheet.getName()} tracker.`);
      existingByKey[key] = i;
    } else if (!row.some(value => clean_(value))) {
      emptyIndexes.push(i);
    }
  });
  // Grow the sheet and its Table (with headroom) when there are more new keys than empty rows.
  const newKeys = new Set();
  desiredRows.forEach(row => {
    const key = trackerKey_(row, keyIndexes);
    if (key && existingByKey[key] == null) newKeys.add(key);
  });
  if (newKeys.size > emptyIndexes.length) {
    const extra = newKeys.size - emptyIndexes.length + TRACKER_GROWTH_ROWS_;
    sheet.insertRowsAfter(sheet.getMaxRows(), extra);
    extendTableToSheetEnd_(sheet.getName());
    for (let i = 0; i < extra; i++) {
      emptyIndexes.push(existing.length);
      existing.push(Array(width).fill(''));
    }
  }
  const finalRows = existing.map(row => row.slice()), desiredKeys = new Set(), assigned = new Set();
  desiredRows.forEach(row => {
    const key = trackerKey_(row, keyIndexes);
    if (!key) throw new Error(`${sheet.getName()} desired tracker row is missing its stable key.`);
    if (desiredKeys.has(key)) throw new Error(`Duplicate desired key ${key} in ${sheet.getName()} tracker refresh.`);
    desiredKeys.add(key);
    let index = existingByKey[key];
    if (index == null) {
      while (emptyIndexes.length && assigned.has(emptyIndexes[0])) emptyIndexes.shift();
      if (!emptyIndexes.length) throw new Error(`${sheet.getName()} has no empty Table rows available.`);
      index = emptyIndexes.shift();
    }
    // undefined = "not ours" (a column the code does not know): keep whatever is in the sheet.
    finalRows[index] = row.map((value, i) => value === undefined ? existing[index][i] : value);
    assigned.add(index);
  });
  existing.forEach((row, index) => {
    const key = trackerKey_(row, keyIndexes);
    if (!preserveUnmatched && key && !desiredKeys.has(key)) finalRows[index] = Array(width).fill('');
  });
  return writeChangedMatrixRows_(sheet, headerRow + 1, 1, existing, finalRows);
}
// Central tracker rows are built as objects keyed by header name and written by the sheet's live column positions, so
// adding, moving or renaming-around columns in a central tracker (or in a grantee export block) needs no code change.
// Columns the code does not know are never overwritten.
function upsertTrackerObjects_(sheet, headerRow, label, desiredObjects, keyHeaders, requiredHeaders) {
  const cols = columnsByHeader_(sheet, headerRow, label);
  requiredHeaders.forEach(header => cols.col(header));
  const keyIndexes = keyHeaders.map(header => cols.col(header));
  const rows = desiredObjects.map(object => {
    const row = new Array(cols.width).fill(undefined);
    // undefined leaves the cell as it is (used when a source could not be read this time); null / '' clear it.
    Object.keys(object).forEach(header => { if (cols.has(header) && object[header] !== undefined) row[cols.col(header)] = object[header] === null ? '' : object[header]; });
    return row;
  });
  return upsertTrackerRowsByKey_(sheet, cols.width, rows, keyIndexes, true);
}
function trackerManualMap_(sheet, headerRow, label, keyHeaders, manualHeaders) {
  const out = {}, cols = columnsByHeader_(sheet, headerRow, label), count = sheet.getMaxRows() - headerRow;
  if (count <= 0) return out;
  const keyIndexes = keyHeaders.map(header => cols.col(header));
  sheet.getRange(headerRow + 1, 1, count, cols.width).getValues().forEach(row => {
    const stable = trackerKey_(row, keyIndexes);
    if (!stable) return;
    const manual = {};
    manualHeaders.forEach(header => { manual[header] = cols.has(header) ? row[cols.col(header)] : ''; });
    out[stable] = manual;
  });
  return out;
}
// A block of the hidden System - Tracker Export sheet as objects keyed by lower-cased header. Extra or reordered columns are fine;
// a missing REQUIRED header stops the refresh with a message naming it.
function trackerExportObjects_(workbook, section, requiredHeaders) {
  const sheet = workbook.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.TRACKER_EXPORT);
  if (!sheet || !sheet.isSheetHidden()) throw new Error('Protected System - Tracker Export is missing or visible.');
  const cols = columnsByHeader_(sheet, section.HEADER_ROW, `Tracker Export ${section.LABEL}`);
  requiredHeaders.forEach(header => cols.col(header));
  return sheet.getRange(section.DATA_START_ROW, 1, section.DATA_ROWS, cols.width).getValues().map(row => cols.record(row));
}

function activeReportingGrants_() {
  return grantRegistryRecords_().map(item => item.record).filter(grant =>
    key_(grant['Record Status']) === 'active' && key_(grant['Grant Status']) === 'active');
}

// ---- Refresh safety: one broken workbook never stops the others, and unchanged workbooks are not re-read ----
// Per grant and per kind of read, the workbook's Drive "last updated" time from the last successful read is kept in Script Properties
// (no sheet column needed). A workbook that has not changed since is skipped; its central rows simply stay as they are.
// uiRefreshReportingForce clears the memory so everything is read again.
let REFRESH_ISSUES_ = [];
let REFRESH_SKIPPED_ = 0;
let READ_STATE_CACHE_ = null;
let FORCE_FULL_REFRESH_ = false;
function beginRefresh_() { REFRESH_ISSUES_ = []; REFRESH_SKIPPED_ = 0; return Date.now(); }
function refreshNote_() {
  const parts = [];
  if (REFRESH_SKIPPED_) parts.push(`${REFRESH_SKIPPED_} unchanged workbook(s) skipped.`);
  if (REFRESH_ISSUES_.length) parts.push(`${REFRESH_ISSUES_.length} grant(s) skipped because of a problem: ` +
    REFRESH_ISSUES_.slice(0, 3).map(item => `${item.grantId} — ${item.message}`).join('; ') + (REFRESH_ISSUES_.length > 3 ? '; …' : ''));
  return parts.length ? ` ${parts.join(' ')}` : '';
}
function readState_() {
  if (!READ_STATE_CACHE_) {
    try { READ_STATE_CACHE_ = PropertiesService.getScriptProperties().getProperties() || {}; } catch (error) { READ_STATE_CACHE_ = {}; }
  }
  return READ_STATE_CACHE_;
}
function readStateKey_(kind, grantId) { return `rd|${kind}|${key_(grantId)}`; }
// { changed, stamp } for one grant's workbook; anything unknown counts as changed (never skips by mistake).
function workbookChanged_(kind, grantId, url) {
  if (FORCE_FULL_REFRESH_) return { changed: true, stamp: 0 };
  try {
    const stamp = DriveApp.getFileById(urlId_(url)).getLastUpdated().getTime(), last = Number(readState_()[readStateKey_(kind, grantId)] || 0);
    return { changed: !last || stamp > last, stamp };
  } catch (error) {
    return { changed: true, stamp: 0 };
  }
}
function commitReadMarks_(marks) {
  const keys = Object.keys(marks).filter(key => marks[key]);
  if (!keys.length) return;
  const values = {};
  keys.forEach(key => { values[key] = String(marks[key]); readState_()[key] = String(marks[key]); });
  try { PropertiesService.getScriptProperties().setProperties(values); } catch (error) { console.warn(`Could not remember read times: ${error.message}`); }
}
function forgetReadMarks_() {
  READ_STATE_CACHE_ = {};
  try {
    const store = PropertiesService.getScriptProperties();
    Object.keys(store.getProperties()).filter(key => /^rd\|/.test(key)).forEach(key => store.deleteProperty(key));
  } catch (error) { console.warn(`Could not clear read times: ${error.message}`); }
}
// Runs one grant's read; a failure or a paused run is remembered for the message and returns null (nothing is marked as read).
function guardedGrantRead_(grantId, startedAt, read) {
  if (overRuntimeGuard_(startedAt)) {
    REFRESH_ISSUES_.push({ grantId, message: 'not read yet: the run paused before the time limit — run the refresh again' });
    return null;
  }
  try {
    return read();
  } catch (error) {
    REFRESH_ISSUES_.push({ grantId, message: clean_(error.message).replace(/\s+/g, ' ').slice(0, 140) });
    return null;
  }
}
const OUTCOME_MANUAL_HEADERS_ = ['Q1', 'Q2', 'Q3', 'Q4'].reduce((list, quarter) => list.concat([`${quarter} Status`, `${quarter} Anagha Notes`]), []);
function refreshOutcomeProgressTracker_() {
  const sheet = ss_().getSheetByName(APFP.SHEETS.OUTCOMES);
  if (!sheet) throw new Error('Outcome Progress tab is missing from Central Administration.');
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.OUTCOMES, required = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.OUTCOMES,
    exportRequired = required.filter(header => !OUTCOME_MANUAL_HEADERS_.includes(header)),
    manualByOutcome = trackerManualMap_(sheet, headerRow, 'Outcome Progress', ['Grant ID', 'Outcome ID'], OUTCOME_MANUAL_HEADERS_),
    desired = [], marks = {}, startedAt = beginRefresh_(), section = APFP.PREFLIGHT_SCHEMA.OUTCOME_EXPORT_SECTIONS[0];
  activeReportingGrants_().forEach(grant => {
    if (isTransactionalGrantType_(grant['Grant Type']) || isDiscretionaryGrantType_(grant['Grant Type'])) return;
    const url = outcomeProgressWorkbookUrlForGrant_(grant['Grant ID']);
    if (!url) return;
    const check = workbookChanged_('outcome', grant['Grant ID'], url);
    if (!check.changed) { REFRESH_SKIPPED_++; return; }
    const records = guardedGrantRead_(grant['Grant ID'], startedAt, () => trackerExportObjects_(openSpreadsheetCached_(url), section, exportRequired));
    if (!records) return;
    marks[readStateKey_('outcome', grant['Grant ID'])] = check.stamp;
    records.forEach(record => {
      const outcomeId = clean_(record['outcome id']);
      if (!outcomeId || !clean_(record['outcome / indicator'])) return;
      const stable = `${key_(grant['Grant ID'])}|${key_(outcomeId)}`, manual = manualByOutcome[stable] || {}, object = {};
      required.forEach(header => {
        object[header] = OUTCOME_MANUAL_HEADERS_.includes(header) ? (manual[header] == null ? '' : manual[header]) : record[key_(header)];
      });
      object['Financial Year'] = record['financial year'] || grant['Financial Year'];
      object['Organisation Name'] = record['organisation name'] || grant['Organisation Name'];
      object['Grant Title'] = record['grant title'] || grant['Project Title'];
      object['Grant ID'] = record['grant id'] || grant['Grant ID'];
      object['Outcome ID'] = outcomeId;
      desired.push(object);
    });
  });
  upsertTrackerObjects_(sheet, headerRow, 'Outcome Progress', desired, ['Grant ID', 'Outcome ID'], required);
  commitReadMarks_(marks);
  return desired.length;
}
function refreshSupportTracker_() {
  const support = ss_().getSheetByName(APFP.SHEETS.SUPPORT);
  if (!support) throw new Error('Support tab is missing from Central Administration.');
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.SUPPORT, required = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.SUPPORT,
    keyHeaders = ['Grant ID', 'Outcome ID', 'Quarter'],
    existing = trackerManualMap_(support, headerRow, 'Support', keyHeaders, ['Status', 'Anagha Notes']),
    desired = [], marks = {}, startedAt = beginRefresh_(), section = APFP.PREFLIGHT_SCHEMA.OUTCOME_EXPORT_SECTIONS[1];
  activeReportingGrants_().forEach(grant => {
    if (isTransactionalGrantType_(grant['Grant Type']) || isDiscretionaryGrantType_(grant['Grant Type'])) return;
    const url = outcomeProgressWorkbookUrlForGrant_(grant['Grant ID']);
    if (!url) return;
    const check = workbookChanged_('support', grant['Grant ID'], url);
    if (!check.changed) { REFRESH_SKIPPED_++; return; }
    const records = guardedGrantRead_(grant['Grant ID'], startedAt, () => trackerExportObjects_(openSpreadsheetCached_(url), section, required));
    if (!records) return;
    marks[readStateKey_('support', grant['Grant ID'])] = check.stamp;
    records.forEach(record => {
      const grantId = clean_(record['grant id']) || clean_(grant['Grant ID']), outcomeId = clean_(record['outcome id']), quarter = clean_(record['quarter']),
        type = clean_(record['support type']), requiredText = clean_(record['support required']);
      if (!grantId || !outcomeId || !quarter || (!type && !requiredText)) return;
      const stable = [key_(grantId), key_(outcomeId), key_(quarter)].join('|'), manual = existing[stable] || {};
      desired.push({
        'Financial Year': record['financial year'] || grant['Financial Year'],
        'Organisation Name': record['organisation name'] || grant['Organisation Name'],
        'Grant Title': record['grant title'] || grant['Project Title'],
        'Grant ID': grantId, 'Outcome Indicator': record['outcome indicator'], 'Outcome ID': outcomeId, 'Quarter': quarter,
        'Support Type': type, 'Support Required': requiredText, 'Evidence Link': record['evidence link'],
        'Status': manual['Status'] || record['status'] || 'Open', 'Anagha Notes': manual['Anagha Notes'] || record['anagha notes'] || ''
      });
    });
  });
  upsertTrackerObjects_(support, headerRow, 'Support', desired, keyHeaders, required);
  commitReadMarks_(marks);
  return desired.length;
}
function refreshReportingData() {
  const outcomes = refreshOutcomeProgressTracker_(),
    support = refreshSupportTracker_(),
    decisions = refreshDecisionTracker_(),
    disbursements = syncDisbursementsToGranteeWorkbooks_(),
    links = syncGranteeDisbursementLinksToCentral_();
  notifyAdmin_(`Reporting refreshed: ${outcomes} outcomes, ${support} support items, ${decisions} decisions, ${disbursements} disbursement rows, ${links} document links.`);
  return { outcomes, support, decisions, disbursements, links };
}
function nextFinancialYear_(fy) {
  if (!validFinancialYear_(fy)) return '';
  const start = Number(clean_(fy).slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
function outcomeSummaryForGrant_(grant) {
  if (isTransactionalGrantType_(grant['Grant Type']) || isDiscretionaryGrantType_(grant['Grant Type'])) return '';
  const workbook = outcomeProgressWorkbookForGrant_(grant['Grant ID']);
  if (!workbook) return '';
  try {
    const sheet = workbook.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES), lines = [];
    if (!sheet) throw new Error(`Outcome Progress workbook is missing sheet ${APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES}.`);
    const schema = APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE, headerRow = schema.DATA_START_ROW - 1,
      values = sheet.getRange(headerRow, 1, schema.DATA_ROWS + 1, sheet.getLastColumn()).getDisplayValues(),
      positions = {};
    // Columns are found by header name: the sheet has several "Upload Folder" columns between the quarters.
    values[0].forEach((header, index) => {
      const name = key_(header);
      if (name && positions[name] == null) positions[name] = index;
    });
    const col = name => {
      if (positions[key_(name)] == null) throw new Error(`Outcome Progress is missing the column "${name}".`);
      return positions[key_(name)];
    };
    const idCol = col('Outcome ID'), indicatorCol = col('Outcome / Indicator'),
      progressCols = ['Final Actual', 'Q4 Progress', 'Q3 Progress', 'Q2 Progress', 'Q1 Progress'].map(col);
    values.slice(1).forEach(row => {
      if (!clean_(row[idCol]) || !clean_(row[indicatorCol])) return;
      const latest = progressCols.map(c => clean_(row[c])).find(Boolean) || 'No progress reported yet';
      lines.push(`${row[indicatorCol]} — ${latest}`);
    });
    return lines.join('\n');
  } catch (error) {
    throw new Error(`Could not build outcome summary for Grant ID ${clean_(grant['Grant ID']) || 'unknown'}: ${error.message}`);
  }
}
const DECISION_MANUAL_HEADERS_ = ['Decision Type', 'Decision Status', 'Decision Rationale', 'Proposed Amount', 'Decision Due Date',
  'Annual Report Link', 'Fund Utilisation Link', '10BE Form Link', 'Maturity — Clarity RAG', 'Maturity — Capacity RAG', 'Maturity — Compliance RAG'];
function refreshDecisionTracker_() {
  const tracker = openSpreadsheetCached_(ss_().getId()), sheet = tracker.getSheetByName(APFP.SHEETS.DECISIONS);
  if (!sheet) throw new Error('Decision Tracker is missing from Central Administration.');
  const currentFy = financialYearFromDate_(now_()), decisionFy = nextFinancialYear_(currentFy),
    headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DECISIONS, required = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.DECISIONS,
    existing = trackerManualMap_(sheet, headerRow, 'Decision Tracker', ['Grant ID'], DECISION_MANUAL_HEADERS_),
    marks = {}, startedAt = beginRefresh_();
  const desired = grantRegistryRecords_().filter(item =>
    key_(item.record['Record Status']) === 'active' && key_(item.record['Grant Status']) === 'active' &&
    !isDiscretionaryGrantType_(item.record['Grant Type']) &&
    key_(item.record['Financial Year']) === key_(currentFy)
  ).map(item => {
    const grant = item.record, manual = existing[key_(grant['Grant ID'])] || {},
      noOutcomeWorkspace = isTransactionalGrantType_(grant['Grant Type']) || isDiscretionaryGrantType_(grant['Grant Type']),
      organisation = organisationById_(grant['Organisation ID']),
      annualReport = manual['Annual Report Link'] || (organisation ? clean_(organisation.record['Latest Annual Report Link']) : '');
    return {
      'Decision For FY': decisionFy, 'Previous Grant FY': currentFy,
      'Organisation Name': clean_(grant['Organisation Name']), 'Grant Title': clean_(grant['Project Title']),
      'Grant Type': clean_(grant['Grant Type']), 'Grant ID': clean_(grant['Grant ID']),
      'Outcome Summary': noOutcomeWorkspace ? '' : decisionOutcomeSummary_(grant, startedAt, marks),
      'Evidence / Workspace Link': noOutcomeWorkspace ? '' : outcomeProgressWorkbookUrlForGrant_(grant['Grant ID']),
      'Decision Type': manual['Decision Type'] || '', 'Decision Status': manual['Decision Status'] || '',
      'Decision Rationale': manual['Decision Rationale'] || '', 'Proposed Amount': manual['Proposed Amount'] || '',
      'Decision Due Date': manual['Decision Due Date'] || grant['Grant End Date'] || '',
      'Annual Report Link': annualReport, 'Fund Utilisation Link': manual['Fund Utilisation Link'] || '',
      '10BE Form Link': manual['10BE Form Link'] || '',
      'Maturity — Clarity RAG': manual['Maturity — Clarity RAG'] || '', 'Maturity — Capacity RAG': manual['Maturity — Capacity RAG'] || '',
      'Maturity — Compliance RAG': manual['Maturity — Compliance RAG'] || ''
    };
  });
  upsertTrackerObjects_(sheet, headerRow, 'Decision Tracker', desired, ['Grant ID'], required);
  commitReadMarks_(marks);
  return desired.length;
}
// The outcome summary for one decision row. undefined = keep what the sheet already has (workbook unchanged, or it could not be read now).
function decisionOutcomeSummary_(grant, startedAt, marks) {
  const url = outcomeProgressWorkbookUrlForGrant_(grant['Grant ID']);
  const check = url ? workbookChanged_('decision', grant['Grant ID'], url) : { changed: true, stamp: 0 };
  if (!check.changed) { REFRESH_SKIPPED_++; return undefined; }
  const summary = guardedGrantRead_(grant['Grant ID'], startedAt, () => outcomeSummaryForGrant_(grant));
  if (summary === null) return undefined;
  if (url) marks[readStateKey_('decision', grant['Grant ID'])] = check.stamp;
  return summary;
}
function disbursementSheet_() {
  const tracker = openSpreadsheetCached_(ss_().getId()), sheet = tracker.getSheetByName(APFP.DISBURSEMENT_TRACKER_SHEET);
  if (!sheet) throw new Error(`${APFP.DISBURSEMENT_TRACKER_SHEET} is missing from the Disbursement Tracker.`);
  return sheet;
}
function externalHeaderMap_(sheet, headerRow) {
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0], map = {};
  headers.forEach((header, i) => { if (clean_(header)) map[key_(header)] = i; });
  return map;
}
function refreshDecisionDocumentLinks_() {
  const sheet = ss_().getSheetByName(APFP.SHEETS.DECISIONS);
  if (!sheet) throw new Error('Decision Tracker is missing from Central Administration.');
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DECISIONS,
    cols = columnsByHeader_(sheet, headerRow, 'Decision Tracker'),
    grantColumn = cols.col('Grant ID'), annualColumn = cols.col('Annual Report Link'),
    fundColumn = cols.col('Fund Utilisation Link'), form10beColumn = cols.col('10BE Form Link'),
    lastRow = Math.max(headerRow, sheet.getLastRow()),
    section = { HEADER_ROW: 161, DATA_START_ROW: 162, DATA_ROWS: 1, LABEL: 'Year-End Documents' };
  if (lastRow <= headerRow) return 0;
  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, cols.width).getValues(), changes = [];
  values.forEach((row, offset) => {
    const grantId = clean_(row[grantColumn]);
    if (!grantId) return;
    const grant = grantById_(grantId);
    if (!grant || isTransactionalGrantType_(grant.record['Grant Type'])) return;
    const organisation = organisationById_(grant.record['Organisation ID']),
      annualReport = organisation ? clean_(organisation.record['Latest Annual Report Link']) : row[annualColumn];
    let utilisation = row[fundColumn], form10be = row[form10beColumn];
    const workbook = outcomeProgressWorkbookForGrant_(grantId);
    if (workbook) {
      const exported = trackerExportObjects_(workbook, section, ['Grant ID', '10BE Form Link', 'Fund Utilisation Link'])[0] || {};
      const exportedGrantId = clean_(exported['grant id']);
      if (exportedGrantId && key_(exportedGrantId) !== key_(grantId))
        throw new Error(`Year-end export Grant ID mismatch for ${grantId}.`);
      form10be = clean_(exported['10be form link']);
      utilisation = clean_(exported['fund utilisation link']);
    }
    [[annualColumn, annualReport], [fundColumn, utilisation], [form10beColumn, form10be]].forEach(([column, value]) => {
      if (comparable_(row[column]) !== comparable_(value)) changes.push({ column, rowNumber: headerRow + 1 + offset, value });
    });
  });
  // Only the changed cells are written (consecutive rows of one column in one call).
  [annualColumn, fundColumn, form10beColumn].forEach(column => {
    const mine = changes.filter(change => change.column === column);
    groupConsecutive_(mine, change => change.rowNumber).forEach(group =>
      sheet.getRange(group[0].rowNumber, column + 1, group.length, 1).setValues(group.map(change => [change.value])));
  });
  return new Set(changes.map(change => change.rowNumber)).size;
}
