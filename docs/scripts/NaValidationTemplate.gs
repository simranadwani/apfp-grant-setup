/**
 * ONE-TIME script for the "APFP Grant Setup Template" (paste into Extensions > Apps Script of THE TEMPLATE, run, then delete).
 * Lets the grantee type exactly "NA" (capital N, capital A) in link, date, currency, number and percentage fields,
 * in addition to what the cell accepts today. Dates: any valid date (the cells are already formatted dd-mmm-yyyy).
 *
 * It (1) sets column L "Validation Rule" in Field Config for the 29 fields below, (2) sets the matching data validation on
 * each field's Value Cell(s), found from Field Config itself, and (3) sets "Required Rule" = YES for the single-cell fields that
 * were optional or conditional (they must now hold a value or NA; tables keep their rules: unused rows may stay empty).
 * If you already made the Field Config edits by hand, the script just finds them already set. Nothing else is touched (phone, email, year, lists, budget,
 * amount requested and project duration keep their rules). Safe to run twice.
 *
 * Steps: File > Make a copy (backup) first. Run previewNaValidation (read the log), then applyNaValidation, then verifyNaValidation.
 */
const NA_RULES = {
  fcra_link: 'HTTPS_URL_OR_NA', section_12a_link: 'HTTPS_URL_OR_NA', section_80g_link: 'HTTPS_URL_OR_NA',
  pan_card_link: 'HTTPS_URL_OR_NA', tan_card_link: 'HTTPS_URL_OR_NA', annual_report_link: 'HTTPS_URL_OR_NA',
  financial_audit_link: 'HTTPS_URL_OR_NA', csr_registration_link: 'HTTPS_URL_OR_NA',
  registration_certificate_link: 'HTTPS_URL_OR_NA', itemised_budget_link: 'HTTPS_URL_OR_NA',
  website_url: 'HTTP_URL_OR_NA', leadership_linkedin: 'HTTP_URL_OR_NA',
  fcra_expiry_date: 'DATE_OR_NA', section_12a_expiry_date: 'DATE_OR_NA', section_80g_expiry_date: 'DATE_OR_NA',
  annual_budget_current_fy: 'NONNEGATIVE_CURRENCY_OR_NA', annual_budget_previous_fy: 'NONNEGATIVE_CURRENCY_OR_NA',
  annual_budget_two_fy_ago: 'NONNEGATIVE_CURRENCY_OR_NA', cost_per_beneficiary: 'NONNEGATIVE_CURRENCY_OR_NA',
  current_funder_amount: 'NONNEGATIVE_CURRENCY_OR_NA',
  years_implemented: 'NONNEGATIVE_WHOLE_NUMBER_OR_NA', direct_beneficiary_count: 'NONNEGATIVE_WHOLE_NUMBER_OR_NA',
  team_size_previous_fy: 'NONNEGATIVE_WHOLE_NUMBER_OR_NA', team_size_current_fy: 'NONNEGATIVE_WHOLE_NUMBER_OR_NA',
  employee_attrition_previous_snapshot: 'PERCENT_0_100_OR_NA', employee_attrition_current_snapshot: 'PERCENT_0_100_OR_NA',
  foreign_funding_percentage: 'PERCENT_0_100_OR_NA',
  leadership_email: 'EMAIL_OR_NA', leadership_contact: 'PHONE_OR_NA'
};
const NA_REQUIRED = ['website_url', 'csr_uin', 'tan_number', 'fcra_link', 'csr_registration_link', 'policy_other', 'sop_other',
  'attrition_context_previous_snapshot', 'attrition_context_current_snapshot',
  // were conditional; now always a value or NA
  'fcra_expiry_date', 'section_12a_expiry_date', 'section_80g_expiry_date', 'years_implemented', 'other_funding_details', 'other_funders_details'];
// c = the first cell of the field's range (the rule is relative, so every cell of the range gets its own reference).
const NA_BASES = {
  HTTPS_URL: { check: c => `REGEXMATCH(TO_TEXT(${c}),"^https://")`, help: 'Paste a link beginning with https://, or NA if not applicable.' },
  HTTP_URL: { check: c => `REGEXMATCH(TO_TEXT(${c}),"^https?://")`, help: 'Enter a complete link beginning with http:// or https://, or NA.' },
  // If a typed date is ever refused, replace ISDATE(c) with: NOT(ISERROR(DATEVALUE(TEXT(c,"dd-mmm-yyyy"))))
  EMAIL: { check: c => `ISEMAIL(${c})`, help: 'Enter a valid email address, e.g. name@example.org, or NA.' },
  PHONE: { check: c => `REGEXMATCH(IF(ISNUMBER(${c}),TEXT(${c},"0"),TO_TEXT(${c})),"^[6-9][0-9]{9}$")`, help: 'Enter a 10-digit Indian mobile number, e.g. 9876543210 (no 0 or +91), or NA.' },
  DATE: { check: c => `ISDATE(${c})`, help: 'Enter a valid date, e.g. 12-Oct-2026, or NA.' },
  NONNEGATIVE_WHOLE_NUMBER: { check: c => `AND(ISNUMBER(${c}),${c}>=0,MOD(${c},1)=0)`, help: 'Enter a whole number of 0 or more, or NA.' },
  NONNEGATIVE_CURRENCY: { check: c => `AND(ISNUMBER(${c}),${c}>=0)`, help: 'Enter a numeric amount of 0 or more, or NA. Do not type ₹ or commas.' },
  PERCENT_0_100: { check: c => `AND(ISNUMBER(${c}),${c}>=0,${c}<=100)`, help: 'Enter a number from 0 to 100, e.g. 73 for 73%, or NA.' }
};

function previewNaValidation() { runNaValidation_(true); }
function applyNaValidation() { runNaValidation_(false); }

function naFieldRows_() {
  const ss = SpreadsheetApp.getActive(), fc = ss.getSheetByName('Field Config');
  if (!fc) throw new Error('This spreadsheet has no "Field Config" sheet. Run the script in the Grant Setup Template.');
  const data = fc.getDataRange().getValues(), head = data[0].map(h => String(h).trim());
  const col = name => { const i = head.indexOf(name); if (i < 0) throw new Error(`Field Config has no column "${name}".`); return i; };
  const c = { sheet: col('Sheet Name'), code: col('Field Code'), cells: col('Value Cell(s)'), rule: col('Validation Rule'), required: col('Required Rule') };
  const rows = [], requiredRows = [];
  data.forEach((r, i) => {
    const code = String(r[c.code]).trim();
    if (i > 0 && NA_RULES[code]) rows.push({ line: i + 1, code, sheet: String(r[c.sheet]).trim(), a1: String(r[c.cells]).trim(), rule: String(r[c.rule]).trim() });
    if (i > 0 && NA_REQUIRED.indexOf(code) >= 0) requiredRows.push({ line: i + 1, code, required: String(r[c.required]).trim() });
  });
  const missing = Object.keys(NA_RULES).concat(NA_REQUIRED).filter(code => !rows.some(r => r.code === code) && !requiredRows.some(r => r.code === code));
  if (missing.length) throw new Error(`Field Codes not found in Field Config: ${missing.join(', ')}. Nothing was changed.`);
  return { ss, fc, ruleColumn: c.rule + 1, requiredColumn: c.required + 1, rows, requiredRows };
}
function naFormula_(newRule, a1) {
  const base = NA_BASES[newRule.replace(/_OR_NA$/, '')];
  if (!base) throw new Error(`No validation defined for ${newRule}.`);
  const first = a1.split(':')[0].replace(/\$/g, '');
  return { formula: `=OR(${first}="",EXACT(${first},"NA"),${base.check(first)})`, help: base.help };
}
function runNaValidation_(dryRun) {
  const { ss, fc, ruleColumn, requiredColumn, rows, requiredRows } = naFieldRows_(), log = [];
  rows.forEach(r => {   // check everything first so a problem stops the run before any change
    if (!ss.getSheetByName(r.sheet)) throw new Error(`${r.code}: sheet "${r.sheet}" not found.`);
    ss.getSheetByName(r.sheet).getRange(r.a1);
    naFormula_(NA_RULES[r.code], r.a1);
  });
  rows.forEach(r => {
    const rule = NA_RULES[r.code], made = naFormula_(rule, r.a1);
    if (r.rule !== rule) {
      log.push(`Field Config row ${r.line} (${r.code}): ${r.rule || '(blank)'} -> ${rule}`);
      if (!dryRun) fc.getRange(r.line, ruleColumn).setValue(rule);
    }
    log.push(`${r.sheet}!${r.a1}: ${made.formula}`);
    if (!dryRun) {
      const validation = SpreadsheetApp.newDataValidation().requireFormulaSatisfied(made.formula).setAllowInvalid(false).setHelpText(made.help).build();
      ss.getSheetByName(r.sheet).getRange(r.a1).setDataValidation(validation);
    }
  });
  requiredRows.forEach(r => {
    if (r.required.toUpperCase() !== 'YES') {
      log.push(`Field Config row ${r.line} (${r.code}): Required Rule ${r.required || '(blank)'} -> YES`);
      if (!dryRun) fc.getRange(r.line, requiredColumn).setValue('YES');
    }
  });
  console.log(log.join('\n'));
  SpreadsheetApp.getUi().alert(`${dryRun ? 'PREVIEW (nothing changed)' : 'DONE'}: ${rows.length} fields (+ ${requiredRows.length} made required).\nOpen View > Logs (or Executions) to read the list.\n` +
    (dryRun ? 'Run applyNaValidation to apply.' : 'Run verifyNaValidation to check.'));
}
function verifyNaValidation() {
  const { ss, rows, requiredRows } = naFieldRows_(), problems = [];
  rows.forEach(r => {
    const first = ss.getSheetByName(r.sheet).getRange(r.a1.split(':')[0]), dv = first.getDataValidation();
    const criteria = dv ? dv.getCriteriaType() : null, args = dv ? dv.getCriteriaValues() : [];
    const formula = String(args[0] || '');
    if (!dv || String(criteria) !== 'CUSTOM_FORMULA' || formula.indexOf('EXACT(') < 0) problems.push(`${r.sheet}!${r.a1} (${r.code}) has no NA rule.`);
    if (r.rule !== NA_RULES[r.code]) problems.push(`Field Config ${r.code} is ${r.rule}, expected ${NA_RULES[r.code]}.`);
  });
  requiredRows.forEach(r => { if (r.required.toUpperCase() !== 'YES') problems.push(`Field Config ${r.code} Required Rule is ${r.required}, expected YES.`); });
  SpreadsheetApp.getUi().alert(problems.length ? `Problems:\n${problems.join('\n')}` : `OK: all ${rows.length} fields have the NA rule and their Field Config value.`);
}
