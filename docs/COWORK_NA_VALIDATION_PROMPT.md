# Prompt for Cowork: allow "NA" in the APFP Grant Setup Template (data validation + Field Config)

Paste everything below the line into Cowork. It was written from the validation rules read out of the template's .xlsx export, so the "current rule" column is exact.

---

You are editing ONE Google Sheet: **APFP Grant Setup Template** (https://docs.google.com/spreadsheets/d/1YFZU3tdMRPNfChwNfRoDeLTNRdOh18jQZFY1-vTVxQQ/edit), signed in as its owner. Goal: on the listed cells, let the grantee type exactly `NA` (capital N, capital A, nothing else) in addition to what the cell accepts today. Nothing else may change.

## Ground rules
1. FIRST make a backup: File → Make a copy → name it `APFP Grant Setup Template – backup before NA change`, same folder. Do not edit the backup.
2. Work only in the original, only on the sheets `A. Org Information`, `B. Grant & Funding`, `C. Project Design`, `E. Annexure`, `Field Config`. Do not touch `Instructions`, `Links`, `D. Outcomes`, `_Validation_Master`, `System - Registry Export`, or any protection, formatting, formula, text or merge.
3. Edit each validation with Data → Data validation (right-side panel). For every rule below: **Criteria = Custom formula is**, paste the formula exactly, **If the data is invalid = Reject the input**, **Appearance = Show validation help text** with the help text given. Replace the existing rule for that range; do not add a second rule on top. If a cell is part of a merged block (e.g. E28:F28), apply to the top-left cell the existing rule uses.
4. In each formula the cell reference is the FIRST cell of the "Apply to range". Google adjusts it for the other cells in the range, so keep it relative (no `$`).
5. Cells not listed here keep their current rules exactly (phone, email, year, Yes/No lists, dropdowns, project title, bank, grant budget D9/D12 on `B. Grant & Funding`, project duration D8).
6. If a range listed as "current" is not found exactly as described, STOP and tell me what you see instead of guessing.

## Part 1 – validation rules to REPLACE

### Sheet `A. Org Information`
| Apply to range | Current rule (for finding it) | New custom formula | Help text |
|---|---|---|---|
| `D9` and `F21:F26` (split into two rules if the panel requires) | `OR(D9="",REGEXMATCH(TO_TEXT(D9),"^https?://"))` | `=OR(D9="",EXACT(D9,"NA"),REGEXMATCH(TO_TEXT(D9),"^https?://"))` | Enter a complete link beginning with http:// or https://, or NA. |
| `E28`, `E30`, `E32`, `E34`, `E35`, `E36:E39` (one rule for all, or per range as they appear today: `E30 E35` and `E28 E32 E34 E36:E39`) | `OR(E28="",REGEXMATCH(TO_TEXT(E28),"^https://(drive\\.google\\.com|docs\\.google\\.com)/"))` and, for E30/E35, the same without the `E28=""` part | `=OR(E28="",EXACT(E28,"NA"),REGEXMATCH(TO_TEXT(E28),"^https://"))` | Paste a link beginning with https://, or NA if not applicable. |
| `D29`, `D31`, `D33` | `OR(NOT(ISERROR(DATEVALUE(D29))), AND(ISNUMBER(D29), LEFT(CELL("format", D29))="D"))` | `=OR(D29="",EXACT(D29,"NA"),ISDATE(D29))` | Enter a valid date, e.g. 12-Oct-2026, or NA. |

### Sheet `B. Grant & Funding`
| Apply to range | Current rule | New custom formula | Help text |
|---|---|---|---|
| `E27` | `OR(E27="",REGEXMATCH(TO_TEXT(E27),"^https://(drive\\.google\\.com|docs\\.google\\.com)/"))` | `=OR(E27="",EXACT(E27,"NA"),REGEXMATCH(TO_TEXT(E27),"^https://"))` | Paste a link beginning with https://, or NA if not applicable. |
| `D7` ONLY (today it shares one rule with `D8`: split it, `D8` keeps the old rule) | `OR(D7="",AND(ISNUMBER(D7),D7>=0,MOD(D7,1)=0))` | `=OR(D7="",EXACT(D7,"NA"),AND(ISNUMBER(D7),D7>=0,MOD(D7,1)=0))` | Enter a whole number of 0 or more, or NA. |

### Sheet `C. Project Design`
| Apply to range | Current rule | New custom formula | Help text |
|---|---|---|---|
| `C24:C28` | `OR(C24="",AND(ISNUMBER(C24),C24>=0,MOD(C24,1)=0))` | `=OR(C24="",EXACT(C24,"NA"),AND(ISNUMBER(C24),C24>=0,MOD(C24,1)=0))` | Enter a whole number of 0 or more, or NA. |
| `E24:E28` (today: Number ≥ 0) | Number greater than or equal to 0 | `=OR(E24="",EXACT(E24,"NA"),AND(ISNUMBER(E24),E24>=0))` | Enter a numeric amount of 0 or more, or NA. Do not type ₹ or commas. |

### Sheet `E. Annexure`
| Apply to range | Current rule | New custom formula | Help text |
|---|---|---|---|
| `D23`, `D28` | `OR(D23="",AND(ISNUMBER(D23),D23>=0,MOD(D23,1)=0))` | `=OR(D23="",EXACT(D23,"NA"),AND(ISNUMBER(D23),D23>=0,MOD(D23,1)=0))` | Enter a whole number of 0 or more, or NA. |
| `D24`, `D29`, and `D35` (today `D24 D29` is one rule and `D35` another; both are Number between 0 and 100) | Number between 0 and 100 | `=OR(D24="",EXACT(D24,"NA"),AND(ISNUMBER(D24),D24>=0,D24<=100))` | Enter a number from 0 to 100, e.g. 73 for 73%, or NA. |
| `D39:D41` and `E45:E54` | Number greater than or equal to 0 | `=OR(D39="",EXACT(D39,"NA"),AND(ISNUMBER(D39),D39>=0))` (for `E45:E54` use `E45` as the first cell) | Enter a numeric amount of 0 or more, or NA. Do not type ₹ or commas. |

Leave unchanged: `A. Org Information` D12, E21:E26 (phone), D13, D21:D26 (email), D17 (year); `B. Grant & Funding` D6, D8, D9, D12, D15, D17; `E. Annexure` D10:D13, D17:D19, D34.

## Part 2 – Field Config (sheet `Field Config`, column L "Validation Rule")
Find each row by **Field Code** (column D) and replace ONLY the value in column L with the new text (exactly, upper case, underscores). Do not change any other column or row.

| New value for column L | Field Codes |
|---|---|
| `HTTPS_URL_OR_NA` | fcra_link, section_12a_link, section_80g_link, pan_card_link, tan_card_link, annual_report_link, financial_audit_link, csr_registration_link, registration_certificate_link, itemised_budget_link |
| `HTTP_URL_OR_NA` | website_url, leadership_linkedin |
| `DATE_OR_NA` | fcra_expiry_date, section_12a_expiry_date, section_80g_expiry_date |
| `NONNEGATIVE_CURRENCY_OR_NA` | annual_budget_current_fy, annual_budget_previous_fy, annual_budget_two_fy_ago, cost_per_beneficiary, current_funder_amount |
| `NONNEGATIVE_WHOLE_NUMBER_OR_NA` | years_implemented, direct_beneficiary_count, team_size_previous_fy, team_size_current_fy |
| `PERCENT_0_100_OR_NA` | employee_attrition_previous_snapshot, employee_attrition_current_snapshot, foreign_funding_percentage |

These Field Codes must be exactly 27 rows (10 + 2 + 3 + 5 + 4 + 3). Their old values were DRIVE_URL, HTTP_URL, DATE, NONNEGATIVE_CURRENCY, NONNEGATIVE_WHOLE_NUMBER, PERCENT_0_100.

## Part 3 – Verify (in the template, then undo the test entries)
For each type below, in the first cell of its range type the test value, press Enter, note accepted or rejected, then clear the cell (Delete) so nothing is left behind:
- Link cell `A. Org Information!E28`: `NA` accepted; `https://example.org/x` accepted; `na` rejected; `N/A` rejected; `example.org` rejected.
- Website `A. Org Information!D9`: `NA` accepted; `http://example.org` accepted; `abc` rejected.
- Date `A. Org Information!D29`: `NA` accepted; `15/03/2027` accepted; `soon` rejected.
- Whole number `E. Annexure!D23`: `NA`, `12` accepted; `2.5`, `-1`, `twelve` rejected.
- Percentage `E. Annexure!D24`: `NA`, `73` accepted; `101`, `-1` rejected.
- Currency `E. Annexure!D39`: `NA`, `250000` accepted; `-5`, `₹5` rejected.
- Untouched check: `A. Org Information!D12` rejects `NA`; `B. Grant & Funding!D9` rejects `NA`.
If a protected cell stops you, tell me which one; do not remove or change any protection.

## Part 4 – Report back
A table with one row per range: sheet, range, old rule, new rule applied (yes/no), any deviation. Plus the list of any Field Code not found.
