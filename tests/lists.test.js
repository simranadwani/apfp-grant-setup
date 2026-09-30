'use strict';
// Dropdown lists, financial years and the time zone come from System - Configuration; missing rows fall back to the defaults in Config.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadProject, plain, ROOT } = require('./harness');

function project(config, nowIso) {
  const p = loadProject();
  p.override('config_', () => Object.assign({}, config));
  if (nowIso) p.override('now_', () => p.date(nowIso));
  return p;
}

test('getList_ returns the default when the LIST_ row is missing, and the sheet value (pipe separated, de-duplicated) when present', () => {
  assert.deepEqual(plain(project({}).get('getList_')('PROGRAMME_STATUSES')), ['Currently Operational', 'Starting Soon']);
  const p = project({ LIST_PROGRAMME_STATUSES: ' Currently Operational | Starting Soon |Paused| Paused ||' });
  assert.deepEqual(plain(p.get('getList_')('PROGRAMME_STATUSES')), ['Currently Operational', 'Starting Soon', 'Paused']);
});

test('financial years roll forward by themselves and honour FIRST_FY / FY_YEARS_AHEAD', () => {
  assert.deepEqual(plain(project({}, '2026-09-30').get('getList_')('FINANCIAL_YEARS')), ['2026-27', '2027-28', '2028-29', '2029-30']);
  assert.deepEqual(plain(project({}, '2028-05-10').get('getList_')('FINANCIAL_YEARS')).slice(-2), ['2030-31', '2031-32']);
  assert.deepEqual(plain(project({ FIRST_FY: '2025-26', FY_YEARS_AHEAD: '1' }, '2026-09-30').get('getList_')('FINANCIAL_YEARS')), ['2025-26', '2026-27', '2027-28']);
  assert.deepEqual(plain(project({ LIST_FINANCIAL_YEARS: '2026-27|2027-28' }, '2026-09-30').get('getList_')('FINANCIAL_YEARS')), ['2026-27', '2027-28']);
});

test('Table dropdown definitions use the configured lists', () => {
  const p = project({ LIST_THEMATIC_AREAS: 'Education|Nutrition' });
  const spec = plain(p.get('APFP')).ADMIN_TABLES.find(s => s.SHEET_NAME === '8. Grant Registry');
  const columns = plain(p.get('tableColumnProperties_')(spec));
  const area = columns.find(c => c.columnName === 'Thematic Area');
  assert.deepEqual(area.dataValidationRule.condition.values.map(v => v.userEnteredValue), ['Education', 'Nutrition']);
});

test('dropdownUpdateRequests_ only touches list columns whose values changed', () => {
  const p = project({ LIST_PROGRAMME_STATUSES: 'Currently Operational|Starting Soon|Paused' });
  const spec = plain(p.get('APFP')).ADMIN_TABLES.find(s => s.SHEET_NAME === '8. Grant Registry');
  // the live table still has the OLD statuses; every other dropdown already matches
  const defaultsProject = project({});
  const live = plain(defaultsProject.get('tableColumnProperties_')(spec));
  const snapshot = { sheets: [{ properties: { title: spec.SHEET_NAME }, tables: [{ name: spec.TABLE_NAME, tableId: 42, columnProperties: live }] }] };
  const plan = plain(p.get('dropdownUpdateRequests_')(snapshot, [spec]));
  assert.deepEqual(plan.changed, ['8. Grant Registry › Programme Status']);
  assert.equal(plan.requests.length, 1);
  const updated = plan.requests[0].updateTable.table.columnProperties.find(c => c.columnName === 'Programme Status');
  assert.deepEqual(updated.dataValidationRule.condition.values.map(v => v.userEnteredValue), ['Currently Operational', 'Starting Soon', 'Paused']);
  assert.equal(plan.requests[0].updateTable.fields, 'columnProperties');
  // nothing to do when the table already matches
  assert.deepEqual(plain(defaultsProject.get('dropdownUpdateRequests_')(snapshot, [spec])), { requests: [], changed: [] });
});

test('time zone comes from config with the built-in fallback', () => {
  assert.equal(project({ TIME_ZONE: 'Asia/Dubai' }).get('timeZone_')(), 'Asia/Dubai');
  assert.equal(project({}).get('timeZone_')(), 'Asia/Kolkata');
});

test('seedListsFromDefaults adds only the missing settings, and is safe to run twice', () => {
  const rows = [['Setting'], ['ROOT_FOLDER_ID', 'x', '', '', '', 'Yes'], ['LIST_THEMATIC_AREAS', 'Education', '', '', '', 'Yes']];
  const writes = [];
  const sheet = {
    getLastRow: () => rows.length, getLastColumn: () => 6, getMaxRows: () => 500, insertRowsAfter() {},
    getRange: (row, col, n, m) => ({
      getDisplayValues: () => [['Setting', 'Value', 'Value Type', 'Description', 'Editable', 'Active', 'Last Updated']],
      getValues: () => rows.slice(row - 1, row - 1 + n).map(r => r.slice(col - 1, col - 1 + m)),
      setValues: values => { writes.push({ row, col, values }); values.forEach((v, i) => { rows[row - 1 + i] = rows[row - 1 + i] || []; v.forEach((cell, j) => { rows[row - 1 + i][col - 1 + j] = cell; }); }); }
    })
  };
  // rows[0] is row 1 (title), rows[1] row 2 (headers) -> data starts at row 3
  rows.splice(0, rows.length, ['TITLE'], ['Setting'], ['ROOT_FOLDER_ID', 'x', '', '', '', 'Yes'], ['LIST_THEMATIC_AREAS', 'Education', '', '', '', 'Yes']);
  const p = loadProject();
  p.override('sheet_', () => sheet);
  p.override('showToast_', () => {});
  const added = plain(p.get('seedListsFromDefaults')());
  assert.deepEqual(added, ['FIRST_FY', 'FY_YEARS_AHEAD', 'TIME_ZONE', 'LIST_THEMATIC_SUBAREAS', 'LIST_PROXIMITY', 'LIST_PROGRAMME_STATUSES']);
  assert.equal(rows.find(r => r[0] === 'LIST_THEMATIC_AREAS')[1], 'Education', 'existing row untouched');
  assert.equal(rows.find(r => r[0] === 'TIME_ZONE')[1], 'Asia/Kolkata');
  assert.equal(rows.find(r => r[0] === 'LIST_PROGRAMME_STATUSES')[5], 'Yes');
  assert.deepEqual(plain(p.get('seedListsFromDefaults')()), []);
});

test('KNOWN_CONFIG_KEYS lists every setting the code reads (keeps the "unused row" warning honest)', () => {
  const known = new Set(plain(loadProject().get('APFP')).PREFLIGHT_SCHEMA.KNOWN_CONFIG_KEYS);
  const found = new Set();
  fs.readdirSync(ROOT).filter(n => n.endsWith('.js')).forEach(name => {
    const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
    for (const m of text.matchAll(/\b(?:config|effectiveConfig|loaded)\.([A-Z][A-Z0-9_]{3,})/g)) found.add(m[1]);
    for (const m of text.matchAll(/config_\(\)\.([A-Z][A-Z0-9_]{3,})/g)) found.add(m[1]);
    for (const m of text.matchAll(/requireConfig_\([^,]+,\s*\[([^\]]*)\]/g)) for (const k of m[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)) found.add(k[1]);
  });
  const missing = [...found].filter(k => !known.has(k));
  assert.deepEqual(missing, [], `add to APFP.PREFLIGHT_SCHEMA.KNOWN_CONFIG_KEYS: ${missing.join(', ')}`);
});

test('setupRegistryExportRecords_ reads by header name and tolerates old workbooks lacking the two newer fields', () => {
  const p = loadProject(), A = plain(p.get('APFP'));
  const build = (orgHeaders, grantHeaders) => {
    const grid = [[], orgHeaders, orgHeaders.map(h => 'v:' + h), [], [], grantHeaders, grantHeaders.map(h => 'g:' + h)];
    return {
      getSheetByName: () => ({
        isSheetHidden: () => true, getLastColumn: () => 70,
        getRange: (r, c, n, w) => ({
          getDisplayValues: () => [(grid[r - 1] || []).slice(0, w)],
          getValues: () => [(grid[r - 1] || []).slice(0, w)]
        })
      })
    };
  };
  // extra + reordered columns are fine
  const org = ['Extra'].concat(A.ORGANISATION_HEADERS.slice().reverse()), grant = A.GRANT_HEADERS.slice().reverse();
  const out = plain(p.get('setupRegistryExportRecords_')(build(org, grant)));
  assert.equal(out.organisation['FCRA Registration Status'], 'v:FCRA Registration Status');
  assert.equal(out.grant['Foreign Funding — Percentage of Total Annual Funding'], 'g:Foreign Funding — Percentage of Total Annual Funding');
  // an older workbook without the two newer fields still reads (blank); a missing core header is an error
  const oldOrg = A.ORGANISATION_HEADERS.filter(h => h !== 'FCRA Registration Status'), oldGrant = A.GRANT_HEADERS.filter(h => !/^Foreign Funding/.test(h));
  assert.equal(plain(p.get('setupRegistryExportRecords_')(build(oldOrg, oldGrant))).organisation['FCRA Registration Status'], '');
  assert.throws(() => p.get('setupRegistryExportRecords_')(build(oldOrg.filter(h => h !== 'PAN Number'), oldGrant)), /missing the column "PAN Number"/);
});
