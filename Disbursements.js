// ============================================================================
// Disbursements.gs — central row automation and grantee document synchronization.
// ============================================================================
function validateDisbursementRows_() {
 const sheet = disbTracker_(), map = disbHeaderMap_(sheet), last = sheet.getLastRow(),
   errors = [], warnings = [], seenIds = new Set();
 if (last < disbFirstDataRow_()) return { errors, warnings };
 const rows = sheet.getRange(disbFirstDataRow_(), 1, last - disbFirstDataRow_() + 1, disbWidth_(sheet)).getValues();
 rows.forEach((row, offset) => {
   const rowNumber = disbFirstDataRow_() + offset;
   if (!row.some(value => clean_(value))) return;
   const get = header => row[disbColumn_(map, header) - 1],
     status = clean_(get('Status')), plannedDate = get('Planned Date'), plannedAmount = get('Planned Amount'),
     actualDate = get('Actual Date'), actualAmount = get('Actual Amount'), id = clean_(get('Disbursement ID')),
     grantId = clean_(get('Grant ID'));
   if (!clean_(get('Organisation Name')))
     errors.push(`Row ${rowNumber}: Organisation Name is required.`);
   if (!plannedDate) errors.push(`Row ${rowNumber}: Planned Date is required.`);
   const plannedNumber = disbNumber_(plannedAmount), actualNumber = disbNumber_(actualAmount);
   if (plannedNumber === '' || plannedNumber == null || plannedNumber < 0 || !Number.isInteger(plannedNumber))
     errors.push(`Row ${rowNumber}: Planned Amount must be a non-negative whole-rupee amount.`);
   if (actualNumber !== '' && (actualNumber == null || actualNumber < 0 || !Number.isInteger(actualNumber)))
     errors.push(`Row ${rowNumber}: Actual Amount must be a non-negative whole-rupee amount.`);
   if (!APFP.DISBURSEMENT_STATUSES.includes(status))
     errors.push(`Row ${rowNumber}: Status must be ${APFP.DISBURSEMENT_STATUSES.join(', ')}.`);
   if (status === 'Disbursed' && !actualDate)
     errors.push(`Row ${rowNumber}: Actual Date is required when Status is Disbursed.`);
   if (status === 'Disbursed' && actualNumber === '')
     errors.push(`Row ${rowNumber}: Actual Amount is required when Status is Disbursed.`);
   if (id) {
     const key = key_(id);
     if (seenIds.has(key)) errors.push(`Row ${rowNumber}: duplicate Disbursement ID ${id}.`);
     seenIds.add(key);
   } else {
     warnings.push(`Row ${rowNumber}: Disbursement ID will be assigned by this tracker after the row is complete.`);
   }
   if (!grantId) warnings.push(`Row ${rowNumber}: Grant ID will be resolved from the retained Grant Registry on edit.`);
 });
 return { errors, warnings };
}
function disbCanonicalFy_(value) {
 const text = clean_(value).replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, '');
 const match = text.match(/^(?:April)?(\d{2,4})-(?:March)?(\d{2,4})$/i);
 if (!match) return '';
 const start = Number(match[1].length === 2 ? `20${match[1]}` : match[1]);
 const end = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
 return end === start + 1 ? `${start}-${String(end).slice(-2)}` : '';
}
function disbFyFromDate_(value) {
 const date = disbDateValue_(value);
 if (!date) return '';
 const year = date.getFullYear(), start = date.getMonth() >= 3 ? year : year - 1;
 return `${start}-${String(start + 1).slice(-2)}`;
}
function disbQuarterFromDate_(value) {
 const date = disbDateValue_(value);
 if (!date) return '';
 const month = date.getMonth();
 if (month >= 3 && month <= 5) return 'Q1';
 if (month >= 6 && month <= 8) return 'Q2';
 if (month >= 9 && month <= 11) return 'Q3';
 return 'Q4';
}
function availableDisbursementGrantRecords_() {
 return grantRegistryRows_().map(item => item.record).filter(record =>
   key_(record['Record Status']) === 'active');
}
function disbGrantMatches_(fy, organisation) {
 const wantedFy = key_(disbCanonicalFy_(fy)), wantedOrganisation = key_(organisation);
 if (!wantedFy || !wantedOrganisation) return [];
 return availableDisbursementGrantRecords_().filter(record =>
   key_(disbCanonicalFy_(record['Financial Year'])) === wantedFy &&
   key_(record['Organisation Name']) === wantedOrganisation);
}
function disbGrantById_(grantId) {
 const wanted = key_(grantId);
 return wanted ? grantRegistryRows_().map(item => item.record).find(record =>
   key_(record['Record Status']) === 'active' && key_(record['Grant ID']) === wanted) || null : null;
}
function disbWriteGrantDetails_(sheet, rowNumber, map, record) {
 const put = (header, value) => {
   const cell = sheet.getRange(rowNumber, disbColumn_(map, header));
   if (key_(cell.getValue()) !== key_(value)) cell.setValue(value);
 };
 if (record) {
   put('Financial Year', disbCanonicalFy_(record['Financial Year']));
   put('Organisation Name', record['Organisation Name']);
 }
 put('Grant Title', record ? record['Project Title'] : '');
 put('Grant ID', record ? record['Grant ID'] : '');
}
function disbIdPrefix_(fy) {
 const canonical = disbCanonicalFy_(fy), match = canonical.match(/^(\d{4})-(\d{2})$/);
 return match ? `DISB-${match[1].slice(-2)}${match[2]}-` : '';
}
function disbNextId_(sheet, map, fy) {
 const prefix = disbIdPrefix_(fy);
 if (!prefix) return '';
 let maximum = 0;
 const last = sheet.getLastRow();
 if (last >= disbFirstDataRow_())
   sheet.getRange(disbFirstDataRow_(), disbColumn_(map, 'Disbursement ID'),
     last - disbFirstDataRow_() + 1, 1).getDisplayValues().forEach(([value]) => {
       const match = clean_(value).match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
       if (match) maximum = Math.max(maximum, Number(match[1]));
     });
 return `${prefix}${String(maximum + 1).padStart(4, '0')}`;
}
function processDisbursementRow_(sheet, rowNumber, map, identityEdited) {
 const read = () => sheet.getRange(rowNumber, 1, 1, disbWidth_(sheet)).getValues()[0];
 let row = read(), get = header => row[disbColumn_(map, header) - 1],
   id = clean_(get('Disbursement ID')), grantId = clean_(get('Grant ID'));
 ['Financial Year', 'Organisation Name', 'Grant ID', 'Planned Date'].forEach(header =>
   sheet.getRange(rowNumber, disbColumn_(map, header)).clearNote());
 const fy = get('Financial Year'), organisation = get('Organisation Name');
 if (id) {
   const original = grantId ? disbGrantById_(grantId) : null,
     historicalMatches = original ? [original] : disbGrantMatches_(fy, organisation),
     historical = historicalMatches.length === 1 ? historicalMatches[0] : null;
   if (historical) disbWriteGrantDetails_(sheet, rowNumber, map, historical);
   return { resolved: historical ? 1 : 0, quarters: 0, ids: 0, locked: 1 };
 }
 const matches = disbGrantMatches_(fy, organisation),
   record = matches.length === 1 ? matches[0] : null;
 disbWriteGrantDetails_(sheet, rowNumber, map, record);
 row = read();
 get = header => row[disbColumn_(map, header) - 1];
 const plannedRaw = get('Planned Date'), plannedDate = disbDateValue_(plannedRaw),
   selectedFy = disbCanonicalFy_(get('Financial Year')),
   derivedFy = plannedDate ? disbFyFromDate_(plannedDate) : '',
   quarter = plannedDate ? disbQuarterFromDate_(plannedDate) : '',
   quarterCell = sheet.getRange(rowNumber, disbColumn_(map, 'Quarter'));
 if (clean_(quarterCell.getValue()) !== quarter) quarterCell.setValue(quarter);
 const fyMatchesDate = !plannedRaw || (plannedDate && key_(selectedFy) === key_(derivedFy)),
   amount = disbNumber_(get('Planned Amount')),
   ready = record && plannedDate && amount !== '' && amount != null && amount >= 0 && fyMatchesDate;
 id = clean_(get('Disbursement ID'));
 let created = 0;
 if (!id && ready) {
   const nextId = disbNextId_(sheet, map, selectedFy);
   if (nextId) {
     sheet.getRange(rowNumber, disbColumn_(map, 'Disbursement ID')).setValue(nextId);
     created = 1;
   }
 }
 return { resolved: record ? 1 : 0, quarters: quarter ? 1 : 0, ids: created, locked: 0 };
}
function handleDisbursementTrackerEdit_(e) {
 if (!e || !e.range) return;
 const sheet = e.range.getSheet();
 if (sheet.getName() !== APFP.SHEETS.DISBURSEMENTS || e.range.getLastRow() < disbFirstDataRow_()) return;
 const map = disbHeaderMap_(sheet), watched = [
   'Financial Year', 'Organisation Name', 'Planned Date', 'Planned Amount', 'Actual Date', 'Actual Amount'
 ], edited = new Set(watched.filter(header => {
   const column = disbColumn_(map, header);
   return column >= e.range.getColumn() && column <= e.range.getLastColumn();
 }));
 markEditedDisbursementsForRepush_(sheet, map, e.range);
 if (!edited.size) return;
 if (edited.has('Financial Year')) {
   for (let rowNumber = Math.max(disbFirstDataRow_(), e.range.getRow()); rowNumber <= e.range.getLastRow(); rowNumber++)
     refreshDisbursementOrganisationOptionsForRow_(sheet, rowNumber, map);
 }
 const lock = LockService.getScriptLock();
 if (!lock.tryLock(30000)) throw new Error('Another Disbursement Tracker automation run is active. Try again.');
 try {
   for (let rowNumber = Math.max(disbFirstDataRow_(), e.range.getRow()); rowNumber <= e.range.getLastRow(); rowNumber++)
     processDisbursementRow_(sheet, rowNumber, map,
       edited.has('Financial Year') || edited.has('Organisation Name'));
 } finally {
   lock.releaseLock();
 }
}

function completeDisbursementRows_() {
 const sheet = disbTracker_(), map = disbHeaderMap_(sheet), last = sheet.getLastRow(), startedAt = Date.now(),
   totals = { resolved: 0, quarters: 0, ids: 0, locked: 0, stoppedEarly: false };
 if (last < disbFirstDataRow_()) return totals;
 // One read for the whole tracker instead of one per row (empty rows are skipped without a further call).
 const rows = sheet.getRange(disbFirstDataRow_(), 1, last - disbFirstDataRow_() + 1, disbWidth_(sheet)).getValues();
 for (let offset = 0; offset < rows.length; offset++) {
   if (!rows[offset].some(value => clean_(value))) continue;
   if (overRuntimeGuard_(startedAt)) { totals.stoppedEarly = true; break; }
   const result = processDisbursementRow_(sheet, disbFirstDataRow_() + offset, map, false);
   Object.keys(totals).forEach(key => { if (key !== 'stoppedEarly') totals[key] += result[key] || 0; });
 }
 return totals;
}
function completeDisbursementRows() {
 const result = completeDisbursementRows_();
 notifyAdmin_(`Disbursement rows completed.\n\nGrant rows resolved: ${result.resolved}\nQuarters updated: ${result.quarters}\nDisbursement IDs created: ${result.ids}` +
   (result.stoppedEarly ? '\n\nThe run paused before the Apps Script time limit. Run it again to continue.' : ''));
 return result;
}
function validateDisbursementTracker() {
 const result = validateDisbursementRows_();
 SpreadsheetApp.getUi().alert(result.errors.length
   ? `Validation found ${result.errors.length} issue(s).\n\n${result.errors.slice(0, 40).join('\n')}`
   : `No blocking row issues found.${result.warnings.length ? `\n\nWarnings:\n${result.warnings.slice(0, 40).join('\n')}` : ''}`);
 return result;
}