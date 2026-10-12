'use strict';
// Round X: a Field Config Validation Rule ending in _OR_NA accepts its normal rule or exactly "NA".
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

const p = loadProject(), f = name => p.get(name);
const row = (rule, input) => ({ 'Validation Rule': rule, 'Input Type': input || '' });

test('exactly NA is accepted only when the rule ends in _OR_NA', () => {
  const ok = f('configuredSetupValueIsValid_');
  ['HTTPS_URL_OR_NA', 'DRIVE_URL_OR_NA', 'DATE_OR_NA', 'NONNEGATIVE_CURRENCY_OR_NA', 'NONNEGATIVE_WHOLE_NUMBER_OR_NA', 'PERCENT_0_100_OR_NA', 'HTTP_URL_OR_NA']
    .forEach(rule => assert.equal(ok('NA', row(rule)), true, rule));
  ['DRIVE_URL', 'DATE', 'NONNEGATIVE_CURRENCY', 'HTTPS_URL'].forEach(rule => assert.equal(ok('NA', row(rule)), false, rule + ' without _OR_NA'));
  assert.equal(ok('na', row('DATE_OR_NA')), false, 'lower case is not NA');
  assert.equal(ok('N/A', row('DRIVE_URL_OR_NA')), false);
  assert.equal(ok('NA ', row('DATE_OR_NA')), true, 'surrounding spaces are trimmed');
});

test('the normal rule still applies next to NA', () => {
  const ok = f('configuredSetupValueIsValid_');
  assert.equal(ok('https://example.org/x', row('HTTPS_URL_OR_NA')), true);
  assert.equal(ok('http://example.org/x', row('HTTPS_URL_OR_NA')), false);
  assert.equal(ok('example.org', row('HTTPS_URL_OR_NA')), false);
  assert.equal(ok('https://drive.google.com/x', row('DRIVE_URL_OR_NA')), true);
  assert.equal(ok('https://example.org', row('DRIVE_URL_OR_NA')), false);
  assert.equal(ok(new Date(2026, 3, 1), row('DATE_OR_NA', 'Date')), true);
  assert.equal(ok('not a date', row('DATE_OR_NA', 'Date')), false);
  assert.equal(ok(500, row('NONNEGATIVE_CURRENCY_OR_NA', 'Currency')), true);
  assert.equal(ok(-5, row('NONNEGATIVE_CURRENCY_OR_NA', 'Currency')), false);
  assert.equal(ok(2.5, row('NONNEGATIVE_WHOLE_NUMBER_OR_NA', 'Whole Number')), false);
  assert.equal(ok(101, row('PERCENT_0_100_OR_NA', 'Percentage')), false);
});

test('an explicit rule wins over the Input Type: HTTPS_URL on a Google Drive Link field accepts any https link', () => {
  const ok = f('configuredSetupValueIsValid_');
  assert.equal(ok('https://example.org/report.pdf', row('HTTPS_URL_OR_NA', 'Google Drive Link')), true);
  assert.equal(ok('https://example.org/report.pdf', row('DRIVE_URL', 'Google Drive Link')), false, 'DRIVE_URL keeps the Google-only check');
});

test('existing rules behave exactly as before', () => {
  const ok = f('configuredSetupValueIsValid_');
  assert.equal(ok('https://drive.google.com/x', row('DRIVE_URL', 'Google Drive Link')), true);
  assert.equal(ok('', row('DATE', 'Date')), true);
  assert.equal(ok(2020, row('YEAR_4_DIGIT', 'Year')), true);
  assert.equal(ok(12, row('POSITIVE_WHOLE_NUMBER')), true);
  assert.equal(ok(0, row('POSITIVE_WHOLE_NUMBER')), false);
  assert.equal(ok('Registered', row('LIST:Registered|Not Registered')), true);
  assert.equal(ok('NA', row('LIST:Registered|Not Registered')), false);
  assert.equal(ok('anything', row('TEXT')), true);
});

test('the _OR_NA and HTTPS_URL rules pass the template Field Config check', () => {
  const supported = f('templateValidationRuleSupported_');
  ['HTTPS_URL', 'HTTPS_URL_OR_NA', 'DRIVE_URL_OR_NA', 'DATE_OR_NA', 'NONNEGATIVE_CURRENCY_OR_NA', 'PERCENT_0_100_OR_NA', 'HTTP_URL_OR_NA']
    .forEach(rule => assert.equal(supported(row(rule)), true, rule));
  assert.equal(supported(row('BANANA')), false);
  assert.equal(supported(row('BANANA_OR_NA')), false);
});

test('an NA link counts as not provided, so no expiry date is demanded; a real link still needs its date', () => {
  const validate = f('validateCompletedSetup_');
  const cells = { fcra: 'NA', fcraDate: '', a: 'NA', aDate: '', g: 'https://x.org/g', gDate: '' };
  const byCode = {
    fcra_link: { 'Field Label': 'FCRA link', code: 'fcra' }, fcra_expiry_date: { 'Field Label': 'FCRA date', code: 'fcraDate' },
    section_12a_link: { 'Field Label': '12A link', code: 'a' }, section_12a_expiry_date: { 'Field Label': '12A date', code: 'aDate' },
    section_80g_link: { 'Field Label': '80G link', code: 'g' }, section_80g_expiry_date: { 'Field Label': '80G date', code: 'gDate' }
  };
  p.override('readSingleConfigured_', (source, r) => (r ? cells[r.code] : ''));
  p.override('readTableConfigured_', () => []);
  assert.throws(() => validate({}, byCode), /Complete: Section 80G Expiry Date\.$/);
  cells.gDate = 'NA';
  assert.doesNotThrow(() => validate({}, byCode));
});
