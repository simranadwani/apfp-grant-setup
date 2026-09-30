// DisbursementSync.gs — central Committed & Spent Tracker <-> grantee "Disbursement Documents" sheets.
//
// Push: central rows with Status = Disbursed  ->  grantee workbook (Grant ID, Disbursement ID, Date, Amount only).
// Sync: Donation Receipt / Letter links entered by the grantee  ->  central tracker.
//
// Two optional, script-controlled columns at the end of the central tracker ("Push Status", "Document Sync Status",
// see APFP.DISBURSEMENT_STATUS) let both actions skip finished rows and open only the workbooks that still need work.
// Operators never type in them. Without the columns every row is checked on every run (the original behaviour).
// Each grant is processed independently: one broken workbook is reported but never stops the others, and a run
// pauses cleanly before the Apps Script time limit.

function disbStatusColumns_(map) {
  const names = APFP.DISBURSEMENT_STATUS;
  return { push: map[key_(names.PUSH_COLUMN)], sync: map[key_(names.SYNC_COLUMN)] };
}
function overRuntimeGuard_(startedAt) {
  return Date.now() - startedAt >= APFP.EXECUTION_GUARD_MS;
}
function shortFailure_(problem) {
  const text = clean_(problem && problem.message ? problem.message : problem).replace(/\s+/g, ' ');
  return `${APFP.DISBURSEMENT_STATUS.FAILED}: ${text.length > 140 ? `${text.slice(0, 137)}…` : text}`;
}
// Writes one value per row into one column, one setValues call per run of consecutive rows.
function writeColumnValues_(sheet, column, valuesByRow) {
  const rowNumbers = Object.keys(valuesByRow).map(Number).sort((a, b) => a - b);
  groupConsecutive_(rowNumbers).forEach(run => sheet.getRange(run[0], column + 1, run.length, 1)
    .setValues(run.map(rowNumber => [valuesByRow[rowNumber]])));
}
function centralDisbursementRows_() {
  const sheet = disbursementSheet_(), map = externalHeaderMap_(sheet, disbHeaderRow_()),
    firstRow = disbFirstDataRow_(), last = sheet.getLastRow();
  const rows = last < firstRow ? [] : sheet.getRange(firstRow, 1, last - firstRow + 1, sheet.getLastColumn()).getValues();
  return { sheet, map, firstRow, rows, status: disbStatusColumns_(map) };
}
function disbursementIsCentralOnly_(grantId) {
  const grant = grantById_(grantId);
  return !!grant && isDiscretionaryGrantType_(grant.record['Grant Type']);
}
function failureSummary_(failures) {
  return `${failures.length} grant(s) had a problem: ` +
    failures.slice(0, 3).map(f => `${f.grantId} — ${f.message}`).join('; ') + (failures.length > 3 ? '; …' : '');
}

// Writes the four system columns of one grantee workbook; returns the number of rows changed.
function pushItemsToWorkbook_(workbook, grantId, items) {
  const table = granteeDisbursementTable_(workbook, grantId);
  if (items.length > table.rows)
    throw new Error(`Disbursement Documents for Grant ID ${grantId} holds ${table.rows} rows; ${items.length} disbursements need a row.`);
  // Only these four system columns are ever written. Upload Folder and the grantee link columns are never touched.
  const fields = [
    { column: table.col('Grant ID'), value: () => grantId },
    { column: table.col('Disbursement ID'), value: item => item.id },
    { column: table.col('Disbursement Date'), value: item => item.date },
    { column: table.col('Disbursed Amount'), value: item => item.amount }
  ];
  const existing = table.sheet.getRange(table.firstRow, 1, table.rows, table.width).getValues(), byId = {}, empty = [];
  existing.forEach((row, i) => {
    const id = key_(row[fields[1].column]);
    if (id) byId[id] = i;
    // A row is free when none of the system columns is filled (other columns, e.g. Upload Folder, always show text).
    else if (!fields.some(field => clean_(row[field.column]))) empty.push(i);
  });
  const desired = existing.map(row => row.slice()), used = new Set();
  items.forEach(item => {
    const idKey = key_(item.id);
    let index = byId[idKey];
    if (index == null) {
      while (empty.length && used.has(empty[0])) empty.shift();
      if (!empty.length) throw new Error(`Disbursement Documents workbook for ${grantId} has no empty rows remaining.`);
      index = empty.shift();
      byId[idKey] = index;
    }
    fields.forEach(field => { desired[index][field.column] = field.value(item); });
    used.add(index);
  });
  const touchedRows = new Set();
  fields.forEach(field => {
    const changed = [];
    desired.forEach((row, i) => {
      if (comparable_(row[field.column]) !== comparable_(existing[i][field.column])) changed.push(i);
    });
    changed.forEach(i => touchedRows.add(i));
    groupConsecutive_(changed).forEach(run => table.sheet.getRange(table.firstRow + run[0], field.column + 1, run.length, 1)
      .setValues(run.map(i => [desired[i][field.column]])));
  });
  return touchedRows.size;
}

function pushDisbursements_() {
  const central = centralDisbursementRows_(), map = central.map, status = central.status, names = APFP.DISBURSEMENT_STATUS,
    startedAt = Date.now(), byGrant = {};
  central.rows.forEach((row, i) => {
    const grantId = clean_(row[map[key_('Grant ID')]]), id = clean_(row[map[key_('Disbursement ID')]]),
      state = key_(row[map[key_('Status')]]), actualDate = row[map[key_('Actual Date')]],
      actualAmount = row[map[key_('Actual Amount')]];
    if (!grantId || !id || state !== 'disbursed' || !actualDate || actualAmount === '' || actualAmount == null) return;
    if (status.push != null && [names.PUSHED, names.NOT_APPLICABLE].map(key_).includes(key_(row[status.push]))) return;
    (byGrant[grantId] || (byGrant[grantId] = [])).push({ id, date: actualDate, amount: actualAmount, rowNumber: central.firstRow + i });
  });
  const result = { changedRows: 0, pushedGrants: 0, failures: [], stoppedEarly: false }, pushState = {};
  Object.keys(byGrant).forEach(grantId => {
    if (result.stoppedEarly) return;
    if (result.pushedGrants + result.failures.length > 0 && overRuntimeGuard_(startedAt)) { result.stoppedEarly = true; return; }
    const items = byGrant[grantId];
    try {
      const workbook = disbursementWorkbookForGrant_(grantId);
      if (!workbook) {
        if (disbursementIsCentralOnly_(grantId)) items.forEach(item => { pushState[item.rowNumber] = names.NOT_APPLICABLE; });
        else {
          // A grant that should have a grantee workbook but has none must be visible, not silently skipped.
          const problem = new Error('no grantee Disbursement Documents workbook was found');
          result.failures.push({ grantId, message: problem.message });
          items.forEach(item => { pushState[item.rowNumber] = shortFailure_(problem); });
        }
        return;
      }
      result.changedRows += pushItemsToWorkbook_(workbook, grantId, items);
      result.pushedGrants++;
      items.forEach(item => { pushState[item.rowNumber] = names.PUSHED; });
    } catch (error) {
      result.failures.push({ grantId, message: error.message });
      items.forEach(item => { pushState[item.rowNumber] = shortFailure_(error); });
    }
  });
  if (status.push != null) {
    // An operator edit made while this run was working marks the row "Changed – push again"; that must survive.
    const rowNumbers = Object.keys(pushState).map(Number);
    if (rowNumbers.length) {
      const first = Math.min.apply(null, rowNumbers), last = Math.max.apply(null, rowNumbers),
        current = central.sheet.getRange(first, status.push + 1, last - first + 1, 1).getValues();
      rowNumbers.forEach(rowNumber => {
        const before = key_(central.rows[rowNumber - central.firstRow][status.push]), now = key_(current[rowNumber - first][0]);
        if (pushState[rowNumber] === names.PUSHED && now === key_(names.CHANGED) && before !== key_(names.CHANGED)) delete pushState[rowNumber];
      });
    }
    writeColumnValues_(central.sheet, status.push, pushState);
  }
  if (status.sync != null) {
    const syncUpdates = {};
    Object.keys(pushState).forEach(rowNumber => {
      const current = key_(central.rows[rowNumber - central.firstRow][status.sync]);
      if (pushState[rowNumber] === names.PUSHED && (!current || current === key_(names.WAITING))) syncUpdates[rowNumber] = names.AWAITING;
      if (pushState[rowNumber] === names.NOT_APPLICABLE) syncUpdates[rowNumber] = names.NOT_APPLICABLE;
    });
    writeColumnValues_(central.sheet, status.sync, syncUpdates);
  }
  return result;
}

// Original entry point (also used by Refresh Reporting): returns rows changed, throws if any grant failed.
function syncDisbursementsToGranteeWorkbooks_() {
  const result = pushDisbursements_();
  if (result.failures.length) throw new Error(failureSummary_(result.failures));
  return result.changedRows;
}

function syncDisbursementLinks_(options) {
  const full = !!(options && options.full), central = centralDisbursementRows_(), map = central.map,
    status = central.status, names = APFP.DISBURSEMENT_STATUS, startedAt = Date.now(), byGrant = {}, syncState = {};
  central.rows.forEach((row, i) => {
    const id = clean_(row[map[key_('Disbursement ID')]]), grantId = clean_(row[map[key_('Grant ID')]]),
      rowNumber = central.firstRow + i;
    if (!id || !grantId) return;
    if (status.push != null) {
      const pushed = key_(row[status.push]);
      if (pushed === key_(names.NOT_APPLICABLE)) return;
      if (pushed !== key_(names.PUSHED)) { syncState[rowNumber] = names.WAITING; return; }
    }
    if (status.sync != null && !full && key_(row[status.sync]) === key_(names.SYNCED)) return;
    (byGrant[grantId] || (byGrant[grantId] = [])).push({
      id, rowNumber, receipt: row[map[key_('Donation Receipt Link')]], letter: row[map[key_('Donation Letter Link')]]
    });
  });
  const result = { linkRows: 0, checkedGrants: 0, failures: [], stoppedEarly: false }, linkChanges = {};
  Object.keys(byGrant).forEach(grantId => {
    if (result.stoppedEarly) return;
    if (result.checkedGrants + result.failures.length > 0 && overRuntimeGuard_(startedAt)) { result.stoppedEarly = true; return; }
    const items = byGrant[grantId];
    try {
      const workbook = disbursementWorkbookForGrant_(grantId);
      if (!workbook) return;
      const table = granteeDisbursementTable_(workbook, grantId), idCol = table.col('Disbursement ID'),
        receiptCol = table.col('Donation Receipt Link'), letterCol = table.col('Donation Letter Link'), found = {};
      table.sheet.getRange(table.firstRow, 1, table.rows, table.width).getValues().forEach(row => {
        const id = clean_(row[idCol]);
        if (id) found[key_(id)] = { receipt: clean_(row[receiptCol]), letter: clean_(row[letterCol]) };
      });
      items.forEach(item => {
        const source = found[key_(item.id)];
        if (!source) { syncState[item.rowNumber] = shortFailure_('disbursement not found in the grantee workbook'); return; }
        const nextReceipt = source.receipt || item.receipt || '', nextLetter = source.letter || item.letter || '';
        if (comparable_(item.receipt) !== comparable_(nextReceipt) || comparable_(item.letter) !== comparable_(nextLetter))
          linkChanges[item.rowNumber] = [nextReceipt, nextLetter];
        const linkCount = [nextReceipt, nextLetter].filter(v => clean_(v)).length;
        syncState[item.rowNumber] = linkCount === 2 ? names.SYNCED : linkCount === 1 ? names.PARTIAL : names.AWAITING;
      });
      result.checkedGrants++;
    } catch (error) {
      result.failures.push({ grantId, message: error.message });
      items.forEach(item => { syncState[item.rowNumber] = shortFailure_(error); });
    }
  });
  const rowNumbers = Object.keys(linkChanges).map(Number);
  [['Donation Receipt Link', 0], ['Donation Letter Link', 1]].forEach(([header, position]) => {
    const column = map[key_(header)];
    if (!rowNumbers.length) return;
    if (column == null) throw new Error(`Disbursement Tracker is missing the column "${header}".`);
    const values = {};
    rowNumbers.forEach(rowNumber => { values[rowNumber] = linkChanges[rowNumber][position]; });
    writeColumnValues_(central.sheet, column, values);
  });
  result.linkRows = rowNumbers.length;
  if (status.sync != null) {
    const changedState = {};
    Object.keys(syncState).forEach(rowNumber => {
      if (key_(central.rows[rowNumber - central.firstRow][status.sync]) !== key_(syncState[rowNumber]))
        changedState[rowNumber] = syncState[rowNumber];
    });
    writeColumnValues_(central.sheet, status.sync, changedState);
  }
  return result;
}

// Original entry point (also used by Refresh Reporting): returns rows updated, throws if any grant failed.
function syncGranteeDisbursementLinksToCentral_(options) {
  const result = syncDisbursementLinks_(options);
  if (result.failures.length) throw new Error(failureSummary_(result.failures));
  return result.linkRows;
}

// A correction to a pushed row must never be skipped: editing its key fields marks it "Changed – push again".
function markEditedDisbursementsForRepush_(sheet, map, range) {
  const status = disbStatusColumns_(map);
  if (status.push == null) return 0;
  const touches = ['Status', 'Grant ID', 'Actual Date', 'Actual Amount'].some(header => {
    const column = map[key_(header)];
    return column != null && column + 1 >= range.getColumn() && column + 1 <= range.getLastColumn();
  });
  const first = Math.max(disbFirstDataRow_(), range.getRow()), last = range.getLastRow();
  if (!touches || last < first) return 0;
  const updates = {};
  sheet.getRange(first, status.push + 1, last - first + 1, 1).getValues().forEach(([value], i) => {
    if (key_(value) === key_(APFP.DISBURSEMENT_STATUS.PUSHED)) updates[first + i] = APFP.DISBURSEMENT_STATUS.CHANGED;
  });
  writeColumnValues_(sheet, status.push, updates);
  return Object.keys(updates).length;
}

// Redo action: blanks both status columns for the given rows so the next push/sync treats them as new.
function clearDisbursementStatuses_(sheet, map, fromRow, toRow) {
  const status = disbStatusColumns_(map), first = Math.max(disbFirstDataRow_(), fromRow);
  if (toRow < first) return 0;
  const blank = {};
  for (let row = first; row <= toRow; row++) blank[row] = '';
  [status.push, status.sync].forEach(column => { if (column != null) writeColumnValues_(sheet, column, blank); });
  return toRow - first + 1;
}
