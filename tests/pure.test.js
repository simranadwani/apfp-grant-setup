'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject, plain } = require('./harness');

const p = loadProject();
const f = name => p.get(name);

test('clean_ / key_ normalise blanks, NBSP and case', () => {
  assert.equal(f('clean_')(null), '');
  assert.equal(f('clean_')('  Hello  '), 'Hello');
  assert.equal(f('key_')('  ABC  '), 'abc');
});

test('validEmail_ and validFinancialYear_', () => {
  assert.equal(f('validEmail_')('a@b.org'), true);
  assert.equal(f('validEmail_')('a@b'), false);
  assert.equal(f('validFinancialYear_')('2026-27'), true);
  assert.equal(f('validFinancialYear_')('2026-28'), false);
  assert.equal(f('validFinancialYear_')('2099-00'), true); // century wrap
});

test('financial-year helpers follow the April–March year', () => {
  assert.equal(f('financialYearFromDate_')(p.date(2026, 3, 1)), '2026-27');
  assert.equal(f('financialYearFromDate_')(p.date(2027, 2, 31)), '2026-27');
  assert.equal(f('financialYearFromDate_')(p.date(2027, 3, 1)), '2027-28');
  assert.equal(f('financialYearCode_')('2026-27'), '202627');
  assert.throws(() => f('financialYearCode_')('2026-99'), /Invalid Financial Year/);
  assert.equal(f('financialYearStart_')('2026-27'), 2026);
  assert.equal(f('nextFinancialYear_')('2026-27'), '2027-28');
});

test('grant start quarter labels', () => {
  const q = f('grantQuarterFromDate_');
  assert.equal(q(p.date(2026, 3, 15)), 'Q1 (Apr-Jun)');
  assert.equal(q(p.date(2026, 8, 1)), 'Q2 (Jul-Sep)');
  assert.equal(q(p.date(2026, 11, 31)), 'Q3 (Oct-Dec)');
  assert.equal(q(p.date(2027, 0, 1)), 'Q4 (Jan-Mar)');
  assert.equal(q('not a date'), '');
});

test('ID and name helpers', () => {
  assert.equal(f('prefix5_')('Sadaya Foundation'), 'SADAY');
  assert.equal(f('prefix5_')('AB'), 'ABXXX');
  assert.equal(f('prefix5_')(''), 'XXXXX');
  assert.equal(f('safeDriveName_')('A/B:C  D'), 'A-B-C D');
  assert.match(f('id_')('REQ'), /^REQ-\d{14}-\d{4}$/);
});

test('urlId_ extracts Drive IDs from URLs and passes bare IDs through', () => {
  const id = '1A1Hxt51sWkr3nCe-IEqvtR5j-LBwRv0I';
  assert.equal(f('urlId_')(`https://drive.google.com/drive/folders/${id}`), id);
  assert.equal(f('urlId_')(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=drivesdk`), id);
  assert.equal(f('urlId_')(id), id);
  assert.throws(() => f('urlId_')('nope'), /Could not extract a Drive ID/);
});

test('dateValue_ parses dd/mm/yyyy strictly and rejects impossible dates', () => {
  const d = f('dateValue_')('31/03/2027');
  assert.equal(d.getFullYear(), 2027);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 31);
  const withTime = f('dateValue_')('15/09/2026 17:24:26');
  assert.equal(withTime.getHours(), 17);
  assert.equal(f('dateValue_')(''), null);
  assert.equal(f('dateValue_')('31/02/2027'), null);
});

test('number parsing accepts rupee formatting and rejects text (two implementations today)', () => {
  ['parseAdminTableNumber_', 'disbNumber_'].forEach(name => {
    assert.equal(f(name)('₹40,00,000.00'), 4000000, name);
    assert.equal(f(name)('Rs. 1,500'), 1500, name);
    assert.equal(f(name)(''), '', name);
    assert.equal(f(name)('abc'), null, name);
    assert.equal(f(name)(12), 12, name);
  });
});

test('disbursement FY/quarter/ID helpers', () => {
  assert.equal(f('disbCanonicalFy_')('2026-27'), '2026-27');
  assert.equal(f('disbCanonicalFy_')('April 2026 - March 2027'), '2026-27');
  assert.equal(f('disbCanonicalFy_')('26-27'), '2026-27');
  assert.equal(f('disbCanonicalFy_')('2026-28'), '');
  assert.equal(f('disbFyFromDate_')(p.date(2027, 0, 10)), '2026-27');
  assert.equal(f('disbQuarterFromDate_')(p.date(2026, 3, 1)), 'Q1');
  assert.equal(f('disbQuarterFromDate_')(p.date(2027, 1, 1)), 'Q4');
  assert.equal(f('disbIdPrefix_')('2026-27'), 'DISB-2627-');
  assert.equal(f('disbIdPrefix_')('garbage'), '');
});

test('a1Dimensions_ measures configured ranges', () => {
  assert.deepEqual(plain(f('a1Dimensions_')('A1:C3')), { rows: 3, cols: 3 });
  assert.deepEqual(plain(f('a1Dimensions_')('B4')), { rows: 1, cols: 1 });
  assert.deepEqual(plain(f('a1Dimensions_')('AA1:AB2')), { rows: 2, cols: 2 });
  assert.throws(() => f('a1Dimensions_')('not-a-range'), /Invalid configured A1 range/);
});

test('comparable_ treats equal values of different types consistently', () => {
  assert.equal(f('comparable_')(5), '5');
  assert.equal(f('comparable_')(' x '), 'x');
  assert.equal(f('comparable_')(true), 'true');
  assert.equal(f('comparable_')(p.date(2026, 0, 1)), f('comparable_')(p.date(2026, 0, 1)));
});

test('patternName_ and hyperlinkFormula_', () => {
  const request = { organisationName: 'HCJMRI', projectTitle: 'HCJMRI_26-27', financialYear: '2026-27' };
  assert.equal(f('patternName_')('<project_title> | Grant Setup', request), 'HCJMRI_26-27 | Grant Setup');
  assert.equal(f('patternName_')('<financial_year>', request), '2026-27');
  assert.equal(f('hyperlinkFormula_')('Open "Q1"', 'https://x/y'), '=HYPERLINK("https://x/y","Open ""Q1""")');
});

test('mergeWorkspaceEmailTemplate_ fills placeholders and refuses unresolved ones', () => {
  const merge = f('mergeWorkspaceEmailTemplate_');
  assert.equal(merge('Hi {{organisation_name}}', { organisation_name: 'A' }), 'Hi A');
  assert.throws(() => merge('Hi {{nope}}', {}), /Unresolved workspace email placeholder/);
});

test('grant-type predicates and defaults', () => {
  assert.equal(f('isTransactionalGrantType_')(' Transactional '), true);
  assert.equal(f('isDiscretionaryGrantType_')('discretionary'), true);
  assert.equal(f('isTransactionalGrantType_')('Restricted'), false);
  assert.equal(f('grantStatusOrDefault_')('Complete'), 'Complete');
  assert.equal(f('grantStatusOrDefault_')('bogus'), 'Active');
  assert.equal(f('validGrantType_')('Restricted'), true);
  assert.equal(f('validGrantType_')('Other'), false);
});

test('workspace step ordering', () => {
  const at = f('stepAtOrAfter_');
  assert.equal(at('Registries Updated', 'Setup Workbook Configured'), true);
  assert.equal(at('Validated', 'Sharing'), false);
  assert.equal(at('unknown', 'Sharing'), false);
});

test('configuredSetupValueIsValid_ enforces Field Config validation rules', () => {
  const ok = f('configuredSetupValueIsValid_');
  const row = (rule, input) => ({ 'Validation Rule': rule, 'Input Type': input || '' });
  assert.equal(ok('a@b.org', row('EMAIL')), true);
  assert.equal(ok('nope', row('EMAIL')), false);
  assert.equal(ok('9876543210', row('PHONE')), true);
  assert.equal(ok('1234567890', row('PHONE')), false);
  assert.equal(ok('https://drive.google.com/x', row('DRIVE_URL')), true);
  assert.equal(ok('https://example.org', row('DRIVE_URL')), false);
  assert.equal(ok('Yes', row('YES_NO')), true);
  assert.equal(ok('Maybe', row('YES_NO')), false);
  assert.equal(ok(2012, row('YEAR_4_DIGIT')), true);
  assert.equal(ok(12, row('YEAR_4_DIGIT')), false);
  assert.equal(ok(101, row('PERCENT_0_100')), false);
  assert.equal(ok(-1, row('NONNEGATIVE_CURRENCY')), false);
  assert.equal(ok('Registered', row('LIST:Registered|Not Registered')), true);
  assert.equal(ok('Other', row('LIST:Registered|Not Registered')), false);
  assert.equal(ok('', row('EMAIL')), true); // blanks are the Required Rule's job
});

test('groupConsecutive_ splits ascending numbers into contiguous runs', () => {
  const g = f('groupConsecutive_');
  assert.deepEqual(plain(g([])), []);
  assert.deepEqual(plain(g([3])), [[3]]);
  assert.deepEqual(plain(g([1, 2, 3, 5, 6, 9])), [[1, 2, 3], [5, 6], [9]]);
  assert.deepEqual(plain(g([{ index: 0 }, { index: 1 }, { index: 4 }], c => c.index)), [[{ index: 0 }, { index: 1 }], [{ index: 4 }]]);
});

test('writeChangedSegments_ writes each contiguous run of changed cells once', () => {
  const { FakeSheet } = require('./harness');
  const sheet = new FakeSheet('S', [['a', 'b', 'c', 'd', 'e']]);
  const changed = f('writeChangedSegments_')(sheet, 1, [
    { index: 4, value: 'E' }, { index: 0, value: 'A' }, { index: 1, value: 'B' }]);
  assert.equal(changed, true);
  assert.deepEqual(sheet.writes.map(w => [w.col, w.cols]), [[1, 2], [5, 1]]);
  assert.deepEqual(plain(sheet.grid[0]), ['A', 'B', 'c', 'd', 'E']);
  assert.equal(f('writeChangedSegments_')(sheet, 1, []), false);
});
