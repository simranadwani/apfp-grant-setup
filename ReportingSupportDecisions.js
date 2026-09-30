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
      headers = sheet.getRange(headerRow, 1, 1, APFP.DISBURSEMENT_HEADERS.length).getDisplayValues()[0];
    APFP.DISBURSEMENT_HEADERS.forEach((header, index) => {
      if (clean_(headers[index]) !== header) errors.push(`Disbursement header ${index + 1} must be ${header}.`);
    });
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
  const groups = [];
  let group = [changed[0]];
  for (let i = 1; i < changed.length; i++) {
    if (changed[i] === group[group.length - 1] + 1) group.push(changed[i]);
    else { groups.push(group); group = [changed[i]]; }
  }
  groups.push(group);
  groups.forEach(indexes => {
    const first = indexes[0], values = indexes.map(index => desired[index]);
    sheet.getRange(startRow + first, startColumn, values.length, desired[0].length).setValues(values);
  });
  return changed.length;
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
    targetSheet = target.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.OUTCOMES);
  if (!targetSheet) throw new Error(`Outcome Progress sheet is missing for Grant ID ${grantId}.`);
  const schema = APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE,
    existing = targetSheet.getRange(schema.DATA_START_ROW, 1, schema.DATA_ROWS, schema.SYSTEM_COLUMNS).getValues(),
    usedIds = new Set();
  existing.forEach((row, i) => {
    const id = clean_(row[2]);
    if (!id) return;
    const idKey = key_(id);
    if (usedIds.has(idKey)) throw new Error(`Duplicate Outcome ID ${id} found in Outcome Progress row ${i + 5}.`);
    usedIds.add(idKey);
  });
  let seq = 1;
  const output = [];
  for (let i = 0; i < schema.DATA_ROWS; i++) {
    const indicator = clean_(indicators[i]), old = existing[i] || Array(schema.SYSTEM_COLUMNS).fill('');
    let outcomeId = clean_(old[2]);
    if (indicator && !outcomeId) {
      const made = nextOutcomeId_(grantId, usedIds, seq);
      outcomeId = made.id;
      seq = made.next;
    }
    if (!indicator) {
      output.push([grantId, clean_(grant.record['Project Title']), outcomeId, '', '']);
      continue;
    }
    output.push([
      grantId, clean_(grant.record['Project Title']), outcomeId, indicator, targets[i] == null ? '' : targets[i]
    ]);
  }
  writeChangedMatrixRows_(targetSheet, schema.DATA_START_ROW, 1, existing, output);
  if (!deferCentralRefresh) refreshOutcomeProgressTracker_();
  return output.filter(row => clean_(row[2]) && clean_(row[3])).length;
}
function trackerKey_(row, indexes) {
  const parts = indexes.map(index => key_(row[index]));
  return parts.every(Boolean) ? parts.join('|') : '';
}
function upsertTrackerRowsByKey_(sheet, width, desiredRows, keyIndexes, preserveUnmatched) {
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS[Object.keys(APFP.SHEETS).find(key => APFP.SHEETS[key] === sheet.getName())] || 1, capacity = sheet.getMaxRows() - headerRow;
  if (desiredRows.length > capacity) throw new Error(`${sheet.getName()} Table capacity is ${capacity}; ${desiredRows.length} rows are required.`);
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
    finalRows[index] = row.slice();
    assigned.add(index);
  });
  existing.forEach((row, index) => {
    const key = trackerKey_(row, keyIndexes);
    if (!preserveUnmatched && key && !desiredKeys.has(key)) finalRows[index] = Array(width).fill('');
  });
  return writeChangedMatrixRows_(sheet, headerRow + 1, 1, existing, finalRows);
}
function existingOutcomeManualMap_(sheet) {
  const out = {}, headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.OUTCOMES,
    count = sheet.getMaxRows() - headerRow, width = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.OUTCOMES.length;
  if (count <= 0) return out;
  sheet.getRange(headerRow + 1, 1, count, width).getValues().forEach(row => {
    const stable = trackerKey_(row, [3, 4]);
    if (stable) out[stable] = {
      statuses: [row[9], row[13], row[17], row[21]],
      notes: [row[10], row[14], row[18], row[22]]
    };
  });
  return out;
}
function trackerExportRows_(workbook, section, headers) {
  const sheet = workbook.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.TRACKER_EXPORT);
  if (!sheet || !sheet.isSheetHidden()) throw new Error('Protected System - Tracker Export is missing or visible.');
  const actual = sheet.getRange(section.HEADER_ROW, 1, 1, headers.length).getDisplayValues()[0];
  headers.forEach((header, index) => {
    if (clean_(actual[index]) !== header) throw new Error(`Tracker Export ${section.LABEL} column ${index + 1} should be "${header}".`);
  });
  return sheet.getRange(section.DATA_START_ROW, 1, section.DATA_ROWS, headers.length).getValues();
}

function activeReportingGrants_() {
  return grantRegistryRecords_().map(item => item.record).filter(grant =>
    key_(grant['Record Status']) === 'active' && key_(grant['Grant Status']) === 'active');
}

function refreshOutcomeProgressTracker_() {
  const sheet = ss_().getSheetByName(APFP.SHEETS.OUTCOMES);
  if (!sheet) throw new Error('Outcome Progress tab is missing from Central Administration.');
  const manualByOutcome = existingOutcomeManualMap_(sheet), desired = [], section = APFP.PREFLIGHT_SCHEMA.OUTCOME_EXPORT_SECTIONS[0];
  activeReportingGrants_().forEach(grant => {
    if (isTransactionalGrantType_(grant['Grant Type']) || isDiscretionaryGrantType_(grant['Grant Type'])) return;
    const url = outcomeProgressWorkbookUrlForGrant_(grant['Grant ID']);
    if (!url) return;
    trackerExportRows_(openSpreadsheetCached_(url), section, APFP.OUTCOME_EXPORT_HEADERS).forEach(row => {
      const outcomeId = clean_(row[4]);
      if (!outcomeId || !clean_(row[5])) return;
      const stable = `${key_(grant['Grant ID'])}|${key_(outcomeId)}`,
        manual = manualByOutcome[stable] || { statuses: ['', '', '', ''], notes: ['', '', '', ''] };
      desired.push([
        row[0] || grant['Financial Year'], row[1] || grant['Organisation Name'], row[2] || grant['Project Title'],
        row[3] || grant['Grant ID'], outcomeId, row[5], row[6],
        row[7], row[8], manual.statuses[0], manual.notes[0],
        row[13], row[14], manual.statuses[1], manual.notes[1],
        row[19], row[20], manual.statuses[2], manual.notes[2],
        row[25], row[26], manual.statuses[3], manual.notes[3], row[31]
      ]);
    });
  });
  upsertTrackerRowsByKey_(sheet, APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.OUTCOMES.length, desired, [3, 4], true);
  return desired.length;
}
function existingSupportManualMap_(sheet) {
  const out = {}, headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.SUPPORT, count = sheet.getMaxRows() - headerRow;
  if (count <= 0) return out;
  sheet.getRange(headerRow + 1, 1, count, APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.SUPPORT.length).getValues().forEach(row => {
    const stable = trackerKey_(row, [3, 5, 6]);
    if (stable) out[stable] = { status: row[10], notes: row[11] };
  });
  return out;
}
function refreshSupportTracker_() {
  const support = ss_().getSheetByName(APFP.SHEETS.SUPPORT);
  if (!support) throw new Error('Support tab is missing from Central Administration.');
  const existing = existingSupportManualMap_(support), desired = [], section = APFP.PREFLIGHT_SCHEMA.OUTCOME_EXPORT_SECTIONS[1];
  activeReportingGrants_().forEach(grant => {
    if (isTransactionalGrantType_(grant['Grant Type']) || isDiscretionaryGrantType_(grant['Grant Type'])) return;
    const url = outcomeProgressWorkbookUrlForGrant_(grant['Grant ID']);
    if (!url) return;
    trackerExportRows_(openSpreadsheetCached_(url), section, APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.SUPPORT).forEach(row => {
      const grantId = clean_(row[3]) || clean_(grant['Grant ID']), outcomeId = clean_(row[5]), quarter = clean_(row[6]),
        type = clean_(row[7]), required = clean_(row[8]);
      if (!grantId || !outcomeId || !quarter || (!type && !required)) return;
      const stable = [key_(grantId), key_(outcomeId), key_(quarter)].join('|'), manual = existing[stable] || {};
      desired.push([
        row[0] || grant['Financial Year'], row[1] || grant['Organisation Name'], row[2] || grant['Project Title'], grantId,
        row[4], outcomeId, quarter, type, required, row[9], manual.status || row[10] || 'Open', manual.notes || row[11] || ''
      ]);
    });
  });
  upsertTrackerRowsByKey_(support, APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.SUPPORT.length, desired, [3, 5, 6], true);
  return desired.length;
}
function refreshReportingData() {
  try {
    const outcomes = refreshOutcomeProgressTracker_(),
      support = refreshSupportTracker_(),
      decisions = refreshDecisionTracker_(),
      disbursements = syncDisbursementsToGranteeWorkbooks_(),
      links = syncGranteeDisbursementLinksToCentral_()
      detail = `${outcomes} outcomes; ${support} support; ${decisions} decisions; ${disbursements} disbursement rows; ${links} links`;
    recordAutomationStatus_('Reporting, Support & Decisions', 'Success', detail);
    recordAutomationStatus_('Disbursement Transfer', 'Success', `${disbursements} rows; ${links} links`);
    notifyAdmin_(`Reporting refreshed: ${outcomes} outcomes, ${support} support items, ${decisions} decisions, ${disbursements} disbursement rows, ${links} document links.`);
    return { outcomes, support, decisions, disbursements, links };
  } catch (error) {
    recordAutomationStatus_('Reporting, Support & Decisions', 'Failed', error.message);
    recordAutomationStatus_('Disbursement Transfer', 'Failed', error.message);
    throw error;
  }
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
    const schema = APFP.PREFLIGHT_SCHEMA.OUTCOME_TEMPLATE;
    sheet.getRange(schema.DATA_START_ROW, 1, schema.DATA_ROWS, schema.TOTAL_COLUMNS).getDisplayValues().forEach(row => {
      if (!clean_(row[2]) || !clean_(row[3])) return;
      const latest = clean_(row[21]) || clean_(row[17]) || clean_(row[13]) || clean_(row[9]) || clean_(row[5]) || 'No progress reported yet';
      lines.push(`${row[3]} — ${latest}`);
    });
    return lines.join('\n');
  } catch (error) {
    throw new Error(`Could not build outcome summary for Grant ID ${clean_(grant['Grant ID']) || 'unknown'}: ${error.message}`);
  }
}
function refreshDecisionTracker_() {
  const tracker = openSpreadsheetCached_(ss_().getId()), sheet = tracker.getSheetByName(APFP.SHEETS.DECISIONS);
  if (!sheet) throw new Error('Decision Tracker is missing from Central Administration.');
  const currentFy = financialYearFromDate_(now_()), decisionFy = nextFinancialYear_(currentFy), existing = {}, headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DECISIONS, count = sheet.getMaxRows() - headerRow;
  if (count > 0) sheet.getRange(headerRow + 1, 1, count, APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.DECISIONS.length).getValues().forEach(row => {
    if (clean_(row[5])) existing[key_(row[5])] = {
      type: row[8], status: row[9], rationale: row[10], proposedAmount: row[11],
      dueDate: row[12], annualReport: row[13], fundUtilisation: row[14], form10be: row[15],
      clarity: row[16], capacity: row[17], compliance: row[18]
    };
  });
  const desired = grantRegistryRecords_().filter(item =>
    key_(item.record['Record Status']) === 'active' && key_(item.record['Grant Status']) === 'active' &&
    !isDiscretionaryGrantType_(item.record['Grant Type']) &&
    key_(item.record['Financial Year']) === key_(currentFy)
  ).map(item => {
    const grant = item.record, manual = existing[key_(grant['Grant ID'])] || {}, transactional = isTransactionalGrantType_(grant['Grant Type']), discretionary = isDiscretionaryGrantType_(grant['Grant Type']),
      noOutcomeWorkspace = transactional || discretionary,
      organisation = organisationById_(grant['Organisation ID']),
      annualReport = manual.annualReport || (organisation ? clean_(organisation.record['Latest Annual Report Link']) : '');
    return [
      decisionFy, currentFy, clean_(grant['Organisation Name']), clean_(grant['Project Title']), clean_(grant['Grant Type']), clean_(grant['Grant ID']),
      noOutcomeWorkspace ? '' : outcomeSummaryForGrant_(grant), noOutcomeWorkspace ? '' : outcomeProgressWorkbookUrlForGrant_(grant['Grant ID']),
      manual.type || '', manual.status || '', manual.rationale || '', manual.proposedAmount || '',
      manual.dueDate || grant['Grant End Date'] || '', annualReport, manual.fundUtilisation || '', manual.form10be || '',
      manual.clarity || '', manual.capacity || '', manual.compliance || ''
    ];
  });
  upsertTrackerRowsByKey_(sheet, APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADERS.DECISIONS.length, desired, [5], true);
  return desired.length;
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
function syncDisbursementsToGranteeWorkbooks_() {
  const sheet = disbursementSheet_(), map = externalHeaderMap_(sheet, 2), last = sheet.getLastRow();
  if (last < 3) return 0;
  const rows = sheet.getRange(3, 1, last - 2, sheet.getLastColumn()).getValues(), byGrant = {};
  rows.forEach(row => {
    const grantId = clean_(row[map[key_('Grant ID')]]), id = clean_(row[map[key_('Disbursement ID')]]),
      status = key_(row[map[key_('Status')]]), actualDate = row[map[key_('Actual Date')]], actualAmount = row[map[key_('Actual Amount')]];
    if (!grantId || !id || status !== 'disbursed' || !actualDate || actualAmount === '' || actualAmount == null) return;
    if (!byGrant[grantId]) byGrant[grantId] = [];
    byGrant[grantId].push({
      id,
      date: actualDate || row[map[key_('Planned Date')]],
      amount: actualAmount !== '' && actualAmount != null ? actualAmount : row[map[key_('Planned Amount')]]
    });
  });
  let changedRows = 0;
  Object.keys(byGrant).forEach(grantId => {
    const workbook = disbursementWorkbookForGrant_(grantId);
    if (!workbook) return;
    const target = workbook.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS);
    if (!target) throw new Error(`Disbursement Documents sheet is missing for Grant ID ${grantId}.`);
    const disbSchema = APFP.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE,
      existing = target.getRange(disbSchema.DATA_START_ROW, 1, disbSchema.DATA_ROWS, disbSchema.HEADERS.length).getValues(), byId = {}, empty = [];
    existing.forEach((row, i) => {
      const id = key_(row[1]);
      if (id) byId[id] = i;
      else if (!row.some(value => clean_(value))) empty.push(i);
    });
    const finalRows = existing.map(row => row.slice()), used = new Set();
    byGrant[grantId].slice(0, disbSchema.DATA_ROWS).forEach(item => {
      const idKey = key_(item.id);
      let index = byId[idKey];
      if (index == null) {
        while (empty.length && used.has(empty[0])) empty.shift();
        if (!empty.length) throw new Error(`Disbursement Documents workbook for ${grantId} has no empty rows remaining.`);
        index = empty.shift();
      }
      const old = existing[index] || Array(6).fill('');
      finalRows[index] = [grantId, item.id, item.date, item.amount, old[4] || '', old[5] || ''];
      used.add(index);
    });
    changedRows += writeChangedMatrixRows_(target, disbSchema.DATA_START_ROW, 1, existing, finalRows);
  });
  return changedRows;
}
function syncGranteeDisbursementLinksToCentral_() {
  const sheet = disbursementSheet_(), map = externalHeaderMap_(sheet, 2), last = sheet.getLastRow();
  if (last < 3) return 0;
  const width = sheet.getLastColumn(), rows = sheet.getRange(3, 1, last - 2, width).getValues(), central = {}, changes = {}, grantIds = new Set();
  rows.forEach((row, i) => {
    const id = clean_(row[map[key_('Disbursement ID')]]), grantId = clean_(row[map[key_('Grant ID')]]);
    if (id) central[key_(id)] = {
      rowNumber: i + 3, grantId,
      receipt: row[map[key_('Donation Receipt Link')]], letter: row[map[key_('Donation Letter Link')]]
    };
    if (id && grantId) grantIds.add(grantId);
  });
  grantIds.forEach(grantId => {
    const workbook = disbursementWorkbookForGrant_(grantId);
    if (!workbook) return;
    const source = workbook.getSheetByName(APFP.OUTCOME_TEMPLATE_SHEETS.DISBURSEMENTS);
    if (!source) throw new Error(`Disbursement Documents sheet is missing for Grant ID ${grantId}.`);
    const disbSchema = APFP.PREFLIGHT_SCHEMA.TRANSACTIONAL_TEMPLATE;
    source.getRange(disbSchema.DATA_START_ROW, 1, disbSchema.DATA_ROWS, disbSchema.HEADERS.length).getValues().forEach(row => {
      const id = clean_(row[1]), target = central[key_(id)];
      if (!id || !target || key_(target.grantId) !== key_(grantId)) return;
      const receipt = clean_(row[4]), letter = clean_(row[5]);
      const nextReceipt = receipt || target.receipt || '', nextLetter = letter || target.letter || '';
      if (comparable_(target.receipt) !== comparable_(nextReceipt) || comparable_(target.letter) !== comparable_(nextLetter))
        changes[target.rowNumber] = [nextReceipt, nextLetter];
    });
  });
  const rowNumbers = Object.keys(changes).map(Number).sort((a, b) => a - b);
  if (!rowNumbers.length) return 0;
  const groups = [];
  let group = [rowNumbers[0]];
  for (let i = 1; i < rowNumbers.length; i++) {
    if (rowNumbers[i] === group[group.length - 1] + 1) group.push(rowNumbers[i]);
    else { groups.push(group); group = [rowNumbers[i]]; }
  }
  groups.push(group);
  groups.forEach(items => sheet.getRange(items[0], map[key_('Donation Receipt Link')] + 1, items.length, 2)
    .setValues(items.map(rowNumber => changes[rowNumber])));
  return rowNumbers.length;
}
function refreshDecisionDocumentLinks_() {
  const sheet = ss_().getSheetByName(APFP.SHEETS.DECISIONS);
  if (!sheet) throw new Error('Decision Tracker is missing from Central Administration.');
  const headerRow = APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DECISIONS,
    map = headerMap_(sheet, headerRow),
    grantColumn = map[key_('Grant ID')] + 1,
    annualColumn = map[key_('Annual Report Link')] + 1,
    fundColumn = map[key_('Fund Utilisation Link')] + 1,
    form10beColumn = map[key_('10BE Form Link')] + 1,
    lastRow = Math.max(headerRow, sheet.getLastRow()),
    section = { HEADER_ROW: 161, DATA_START_ROW: 162, DATA_ROWS: 1, LABEL: 'Year-End Documents' };
  if (!grantColumn || !annualColumn || !fundColumn || !form10beColumn ||
      fundColumn !== annualColumn + 1 || form10beColumn !== fundColumn + 1)
    throw new Error('Decision document-link columns are missing or out of order.');
  let updated = 0;
  for (let rowNumber = headerRow + 1; rowNumber <= lastRow; rowNumber++) {
    const grantId = clean_(sheet.getRange(rowNumber, grantColumn).getValue());
    if (!grantId) continue;
    const grant = grantById_(grantId);
    if (!grant || isTransactionalGrantType_(grant.record['Grant Type'])) continue;
    const current = sheet.getRange(rowNumber, annualColumn, 1, 3).getValues()[0],
      organisation = organisationById_(grant.record['Organisation ID']),
      annualReport = organisation ? clean_(organisation.record['Latest Annual Report Link']) : current[0];
    let utilisation = current[1], form10be = current[2];
    const workbook = outcomeProgressWorkbookForGrant_(grantId);
    if (workbook) {
      const exported = trackerExportRows_(workbook, section,
        ['Grant ID', '10BE Form Link', 'Fund Utilisation Link'])[0] || [];
      const exportedGrantId = clean_(exported[0]);
      if (exportedGrantId && key_(exportedGrantId) !== key_(grantId))
        throw new Error(`Year-end export Grant ID mismatch for ${grantId}.`);
      form10be = clean_(exported[1]);
      utilisation = clean_(exported[2]);
    }
    if (comparable_(current[0]) === comparable_(annualReport) &&
        comparable_(current[1]) === comparable_(utilisation) &&
        comparable_(current[2]) === comparable_(form10be)) continue;
    sheet.getRange(rowNumber, annualColumn, 1, 3)
      .setValues([[annualReport, utilisation, form10be]]);
    updated++;
  }
  return updated;
}