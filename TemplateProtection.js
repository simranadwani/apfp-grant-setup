// TemplateProtection.gs — field-map checks and inherited workbook protections.
function templateValidationRuleSupported_(row) {
 const inputType = key_(row['Input Type']), rawRule = clean_(row['Validation Rule']),
   rule = key_(rawRule);
 if (!rule || ['text', 'required_text', 'text_or_number', 'none'].includes(rule)) return true;
 if (rule.indexOf('list:') === 0)
   return rawRule.slice(rawRule.indexOf(':') + 1).split('|').map(clean_).filter(Boolean).length > 0;
 return inputType === 'email' || inputType === 'email address' || rule === 'email' || rule === 'valid email' ||
   inputType === 'phone' || inputType === 'phone number' || rule === 'phone' || rule === 'valid phone number' ||
   inputType === 'website url' || rule === 'http_url' || rule === 'valid website url' ||
   inputType === 'google drive link' || rule === 'drive_url' || rule === 'drive link only' ||
   inputType === 'yes / no' || rule === 'yes_no' || rule === 'yes/no' ||
   inputType === 'date' || rule === 'date' || inputType === 'year' || rule === 'year_4_digit' ||
   inputType === 'whole number' || rule === 'nonnegative_whole_number' || rule === 'non-negative whole number' ||
   rule === 'positive_whole_number' || inputType === 'percentage' || rule === 'percent_0_100' || rule === '0 to 100' ||
   inputType === 'currency' || rule === 'nonnegative_currency' || rule === 'non-negative currency';
}
function templateConfigTokenAllowed_(value, allowed) {
 return allowed.indexOf(key_(value)) >= 0;
}
function validateTemplateFieldConfig_(spreadsheet, fieldConfig) {
 const errors = [], seen = {},
   allowedShapes = ['scalar', 'repeating_column', 'system'],
   allowedRequiredRules = [
     'as_applicable', 'at_least_one_complete_row', 'if fcra_link provided',
     'if funds_raised_other_sources=yes', 'if other_funders_considering=yes',
     'if programme_status=currently operational', 'if section_12a_link provided',
     'if section_80g_link provided', 'if_available', 'if_row_used', 'if_useful',
     'no', 'system', 'yes'
   ],
   allowedPrefillRules = [
     'none', 'request_organisation_name', 'request_project_title',
     'returning_latest_approved', 'system_budget_utilisation_link',
     'system_disbursement_link', 'system_outcome_progress_workbook_link',
     'system_q1_link', 'system_q2_link', 'system_q3_link', 'system_q4_link',
     'system_supporting_link', 'system_workspace_link'
   ],
   allowedSyncRules = ['group_by_row', 'single', 'system_write_only'];
 (fieldConfig || []).forEach((row, index) => {
   const code = clean_(row['Field Code']) || `row ${index + 2}`, sheetName = clean_(row['Sheet Name']),
     valueA1 = configValueRange_(row), editableA1 = configEditableRange_(row);
   seen[code] = (seen[code] || 0) + 1;
   const sheet = spreadsheet.getSheetByName(sheetName);
   if (!sheet) { errors.push(`${code}: sheet is missing (${sheetName || 'blank'}).`); return; }
   if (!valueA1) errors.push(`${code}: Value Cell(s) is blank.`);
   else {
     try { sheet.getRange(valueA1); } catch (e) { errors.push(`${code}: invalid Value Cell(s) range ${valueA1}.`); }
   }
   if (key_(row['Grantee Editable?']) === 'yes') {
     if (!editableA1) errors.push(`${code}: editable range is blank.`);
     else {
       try { sheet.getRange(editableA1); } catch (e) { errors.push(`${code}: invalid editable range ${editableA1}.`); }
     }
   }
   if (!templateValidationRuleSupported_(row))
     errors.push(`${code}: unsupported validation rule "${clean_(row['Validation Rule'])}".`);
   if (!templateConfigTokenAllowed_(row['Field Shape'], allowedShapes))
     errors.push(`${code}: unsupported Field Shape "${clean_(row['Field Shape'])}".`);
   if (!templateConfigTokenAllowed_(row['Required Rule'], allowedRequiredRules))
     errors.push(`${code}: unsupported Required Rule "${clean_(row['Required Rule'])}".`);
   if (!templateConfigTokenAllowed_(row['Prefill Rule'], allowedPrefillRules))
     errors.push(`${code}: unsupported Prefill Rule "${clean_(row['Prefill Rule'])}".`);
   if (!templateConfigTokenAllowed_(row['Sync / Extraction Rule'], allowedSyncRules))
     errors.push(`${code}: unsupported Sync / Extraction Rule "${clean_(row['Sync / Extraction Rule'])}".`);
   if (!templateConfigTokenAllowed_(row['Grantee Editable?'], ['yes', 'no']))
     errors.push(`${code}: Grantee Editable? must be Yes or No.`);
   const destinationTable = clean_(row['Destination Table']), destinationField = clean_(row['Destination Field']),
     hasDestinationTable = !!destinationTable && destinationTable !== '—',
     hasDestinationField = !!destinationField && destinationField !== '—';
   if (hasDestinationTable !== hasDestinationField)
     errors.push(`${code}: Destination Table and Destination Field must either both be mapped or both be —.`);
 });
 const registryPolicy = (fieldConfig || []).find(
   row => clean_(row['Sheet Name']) === APFP.TEMPLATE_SHEETS.REGISTRY_EXPORT
 );
 if (!registryPolicy) {
   errors.push('System - Registry Export must have an explicit Field Config policy row.');
 } else if (key_(registryPolicy['Grantee Editable?']) !== 'no') {
   errors.push('System - Registry Export must be marked Grantee Editable? = No.');
 }
 Object.keys(seen).forEach(code => { if (seen[code] > 1) errors.push(`${code}: duplicate Field Code (${seen[code]} rows).`); });
 if (errors.length)
   throw new Error(`Setup Field Config has ${errors.length} blocking issue(s):\n${errors.join('\n')}`);
 return true;
}


function verifyTemplateProtections_(spreadsheet, fieldConfig) {
  return verifyWorkbookProtectionSpecs_(
    spreadsheet,
    setupWorkbookProtectionSpecs_(fieldConfig)
  );
}