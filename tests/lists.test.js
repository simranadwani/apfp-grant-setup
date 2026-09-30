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

test('time zone comes from config with the built-in fallback', () => {
  assert.equal(project({ TIME_ZONE: 'Asia/Dubai' }).get('timeZone_')(), 'Asia/Dubai');
  assert.equal(project({}).get('timeZone_')(), 'Asia/Kolkata');
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
