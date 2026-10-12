# Setup template: allowing "NA" in link, date, currency, number and percentage fields (round X)

A Field Config **Validation Rule** that ends in `_OR_NA` accepts its normal rule **or exactly `NA`** (capital N, capital A, nothing else). `NA` then flows through approval, the sync and the central registries unchanged, and counts as "filled" for required fields. An `NA` link counts as **not provided**, so its expiry date is not demanded.
Which fields allow NA is decided in the template's Field Config only; no further code change is needed to add or remove one.

New rule: `HTTPS_URL` (any link starting `https://`). An explicit rule now wins over the Input Type, so a field whose Input Type is "Google Drive Link" but whose rule is `HTTPS_URL_OR_NA` accepts any https link. Keep `DRIVE_URL_OR_NA` where only Google links should be accepted.

## 1. Field Config (the template, column L "Validation Rule")
Only the template's Field Config is read by the code (generated workbooks no longer carry it). Change the cell, keep everything else.

| Field Code(s) | Value cell(s) | Set Validation Rule to |
|---|---|---|
| fcra_link, section_12a_link, section_80g_link, pan_card_link, tan_card_link, annual_report_link, financial_audit_link, csr_registration_link, registration_certificate_link | A. Org Information E28, E30, E32, E34, E35, E36, E37, E38, E39 | `HTTPS_URL_OR_NA` |
| itemised_budget_link | B. Grant & Funding E27 | `HTTPS_URL_OR_NA` |
| website_url, leadership_linkedin | A. Org Information D9, F21:F26 | `HTTP_URL_OR_NA` (http:// stays allowed, as today) |
| fcra_expiry_date, section_12a_expiry_date, section_80g_expiry_date | A. Org Information D29, D31, D33 | `DATE_OR_NA` |
| annual_budget_current_fy, annual_budget_previous_fy, annual_budget_two_fy_ago | E. Annexure D39, D40, D41 | `NONNEGATIVE_CURRENCY_OR_NA` |
| cost_per_beneficiary, current_funder_amount | C. Project Design E24:E28; E. Annexure E45:E54 | `NONNEGATIVE_CURRENCY_OR_NA` |
| years_implemented | B. Grant & Funding D7 | `NONNEGATIVE_WHOLE_NUMBER_OR_NA` |
| direct_beneficiary_count | C. Project Design C24:C28 | `NONNEGATIVE_WHOLE_NUMBER_OR_NA` |
| team_size_previous_fy, team_size_current_fy | E. Annexure D23, D28 | `NONNEGATIVE_WHOLE_NUMBER_OR_NA` |
| employee_attrition_previous_snapshot, employee_attrition_current_snapshot, foreign_funding_percentage | E. Annexure D24, D29, D35 | `PERCENT_0_100_OR_NA` |

Left strict on purpose (core facts; tell me if you want NA there too): project_total_budget, amount_requested, project_duration_months, registration_year, phone, email, Yes/No and dropdown fields.

## 2. The cells themselves (Data → Data validation, in the template AND in every existing Setup workbook)
For each range choose **Custom formula is**, *Reject the input*, help text "Enter a value, or NA". The formula refers to the **first cell** of the range you are applying it to.
- Links (first cell E28 shown): `=OR(EXACT(E28,"NA"),REGEXMATCH(TO_TEXT(E28),"^https://"))`
- Dates (D29): `=OR(D29="",EXACT(D29,"NA"),ISDATE(D29))` (any valid date; the cells are already formatted dd-mmm-yyyy)
- Currency (D39): `=OR(EXACT(D39,"NA"),AND(ISNUMBER(D39),D39>=0))`
- Whole number (D7): `=OR(EXACT(D7,"NA"),AND(ISNUMBER(D7),D7>=0,D7=INT(D7)))`
- Percentage (D24): `=OR(EXACT(D24,"NA"),AND(ISNUMBER(D24),D24>=0,D24<=100))`
If a value cell is merged (for example E28:F28), apply the rule to the merged cell.

## 3. Central Administration: nothing to change (round Y)
The central registries store `NA` only in text and link columns (for example FCRA Registration Link shows `NA`). For date, number, currency and percentage columns the sync writes a **blank** instead of `NA`, so the typed Table columns never receive text and no column type has to be changed. (If you already switched some columns to plain text, that is fine too: preflight accepts either.)

## 4. Check
1. In a TEST Setup workbook type `NA` in a link, a date, a currency and a percentage field: accepted. Type `na`, `N/A`, `abc`: rejected.
2. Set the FCRA link to `NA` and leave its expiry date blank: Approve → Lock & Migrate succeeds; the Organisation Registry shows `NA` in the link column and a blank expiry date.
3. Check the hidden `System - Registry Export` sheet of that workbook shows `NA` and no error (if a cell there converts a number with VALUE(), tell me).

To apply all of this with Cowork instead of by hand, use the ready prompt in `docs/COWORK_NA_VALIDATION_PROMPT.md` (it contains the exact current and new rule for every range).

To apply it all in one run instead, paste `docs/scripts/NaValidationTemplate.gs` into the template's Apps Script (backup copy first): `previewNaValidation`, `applyNaValidation`, `verifyNaValidation`, then delete the script.

## Round Z: how NA works end to end
- **Single cells (merged once):** every one must hold a value or `NA`. The one-time template script also sets Required Rule = YES for the fields that were optional (website, CSR/UIN, TAN, FCRA link, CSR registration link, Other Policy, Other SOP, the two attrition notes). The six that depended on another answer (Years Implemented, the two "If Yes" details, the three expiry dates) are now mandatory too, so the grantee types a value or `NA` there (15 fields in all). Leadership email and contact number accept `NA` (`EMAIL_OR_NA`, `PHONE_OR_NA`).
- **Tables (leadership, stakeholders, beneficiaries, outcomes, current funders):** rows left empty are fine, and need no NA. A row you start must have every cell filled (NA counts). A row holding only NA is ignored. The "at least one row" rules for leadership, stakeholders, beneficiaries and outcomes still apply.
- **Central sheets:** `NA` is read as blank everywhere (links, text, dates, numbers, currency, percentages and the joined tables), so nothing downstream sees the text NA. The Outcome rows copied into the grantee's Outcome Progress workbook stay exactly as typed.
