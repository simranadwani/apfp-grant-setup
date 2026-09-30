# APFP Grant Workspace — operating model

This file replaces the older codebook documents in the Drive `Codes/` folder (they describe earlier versions). The code in this repository is the source of truth; every change is in `CHANGELOG.md`.

## 1. The three layers
1. **APFP Central Administration** (Google Sheet, owner team@goalkeep.net) with the bound Apps Script. It holds the registries, trackers, settings and the buttons.
2. **Generated workbooks** per grant (copied from the templates in `Admin/Templates`): *Grant Setup* (filled by the grantee, approved by the team, then locked and moved to the read-only archive), *Outcome, Support and Disbursement Tracker*, and for Transactional grants a small *Disbursement Documents* workbook. Each has hidden export sheets (`System - Registry Export`, `System - Tracker Export`) that the script reads **by header name**.
3. **Drive folders** per organisation and financial year (Q1–Q4 folders, Supporting Documents, Budget & Fund Utilisation, Disbursement).

Stable IDs join everything: Grant ID, Organisation ID, Request ID, Workspace ID, Outcome ID, Disbursement ID.

## 2. Grant types and what each one gets
| Grant type | Folders + workbooks | Workspace Status shown | Setup Review Status |
|---|---|---|---|
| Restricted / Unrestricted | Full workspace, Setup, Outcome/Support/Disbursement tracker | Workspace Created | Awaiting Review → Approved → Locked & Migrated |
| Transactional | Disbursement folder + Disbursement Documents workbook only | Disbursement Only | Not Applicable |
| Discretionary | Registry entries only (no folders) | Registry Only | Not Applicable |

`Disbursement Only` is a display label; the Technical Registry keeps `Workspace Created` for Transactional so no rule changes.

## 3. Buttons and what they do
Buttons are drawings assigned to these functions. A workspace button **never writes an Action**; it runs every row whose Action a person (or the system after a failure) set to *Create Workspace*, *Retry Workspace* or *Retry Sharing*. The end-of-run message lists `Rows picked up`, the reason for every row that needs attention, and the slowest steps.

| Function | Purpose |
|---|---|
| `uiCreateWorkspace` | Create workspaces for all rows marked Create Workspace / Retry Workspace / Retry Sharing |
| `uiRetryOrReshareWorkspace` | Opens the Retry / Reshare dialog for the selected row (change email, reshare); otherwise runs the marked rows |
| `uiLockAndMigrateApprovedSetups`, `uiReopenSetupForChanges` | Approve → lock and archive a Setup; reopen it for changes |
| `uiRefreshOutcomeProgress`, `uiRefreshSupport`, `uiRefreshDecisions`, `uiRefreshDecisionDocuments` | Refresh the central trackers from Active grants' workbooks. Unchanged workbooks are skipped; a broken one is reported and skipped |
| `uiRefreshReportingForce` | Forget "unchanged" memory and re-read every Active workbook |
| `uiPushGrantStatus` | Mark the selected Decision Tracker grant Complete |
| `uiRefreshDisbursementOptions`, `completeDisbursementRows` | Organisation dropdowns and ID/quarter completion in the Committed & Spent Tracker |
| `uiPushDisbursements`, `uiSyncDisbursements`, `uiSyncDisbursementsFullCheck`, `uiResetDisbursementStatuses` | Push Disbursed rows to grantee workbooks; sync document links back (see §5) |
| `uiCorrectWorkspaceDetails` | Correct a grant title / details everywhere, including old disbursement rows |
| `uiBackupCentralAdministration` | Copy this sheet into `<CENTRAL_ADMIN_FOLDER_ID>/Backups` (do this before bulk operations) |
| `runPreflightChecks` | Health check: settings, sheets, headers by name, Tables, dropdowns, templates, protections, time zones, email templates |
| `seedListsFromDefaults`, `refreshDropdownsFromConfig` | One-time seeding of list settings; push edited lists into the dropdowns |

Triggers (manual, installed by the operating account): `handleCentralAdminOpen` (on open) and `handleCentralAdminEdit` (on edit).

## 4. Settings: `System - Configuration`
Rows are `Setting | Value | … | Active` (the script reads columns A, B and F; row 3 onward). An inactive row is ignored. Rows the code never reads are listed as warnings by preflight (safe to delete).

* Folders / templates / patterns: `ROOT_FOLDER_ID`, `CENTRAL_ADMIN_FOLDER_ID`, `SETUP_TEMPLATE_ID`, `OUTCOME_PROGRESS_TEMPLATE_ID`, `DISBURSEMENT_DOCUMENT_TEMPLATE_ID`, `*_WORKBOOK_PATTERN`, `*_FOLDER_PATTERN`, `SUPPORTING_DOCUMENTS_FOLDER_NAME`, `BUDGET_UTILISATION_FOLDER_NAME`.
* Behaviour: `MAX_BATCH_SIZE` (rows per run), `SEND_WORKSPACE_NOTIFICATION`, `SEND_SHARING_NOTIFICATION`, `WORKSPACE_EMAIL_TEMPLATE_DOC_ID`, `PROTECTION_EDITORS` (emails kept as protection editors besides the owner and the running account), `TIME_ZONE` (default Asia/Kolkata).
* Lists: `LIST_THEMATIC_AREAS`, `LIST_THEMATIC_SUBAREAS`, `LIST_PROXIMITY`, `LIST_PROGRAMME_STATUSES` (values separated by `|`); financial years roll forward from `FIRST_FY` for `FY_YEARS_AHEAD` years past the current one, or set `LIST_FINANCIAL_YEARS` to fix them. A missing row falls back to the default in `Config.js`.

## 5. Disbursement Push Status / Document Sync Status
Two script-controlled columns at the end of `6. Committed & Spent Tracker` (nobody types in them): **Push Status** — blank → *Pushed* / *Failed: reason* / *Not applicable* (Discretionary) / *Changed – push again* (an edit to date, amount, status or grant after a push). **Document Sync Status** — *Waiting for push* → *Awaiting documents* → *Partial (1 of 2 links)* → *Synced*. Push and Sync only visit rows that are not finished; a grant with nothing to do is not opened. Without the columns the code works as before.

## 6. Changing things without touching code
* **Add a column to a central sheet or Table:** add it anywhere; the code finds columns by header name and never overwrites columns it does not know. Preflight shows an "extra column" warning only.
* **Add a value to a label dropdown** (thematic area, sub-area, proximity, programme status): edit the `LIST_…` row, then run `refreshDropdownsFromConfig`.
* **Change the time zone or the years shown:** edit `TIME_ZONE`, `FIRST_FY`, `FY_YEARS_AHEAD`.
* **Not configurable on purpose** (logic depends on the exact words): Grant Type, Grant Status, Action, Setup Review Status, Organisation Type, quarter labels, Yes/No.
* **Still layout-driven (change together with the template):** the protected/editable ranges of the grantee templates (`F5:F14`, …), the export block rows in `System - Tracker Export` (2 / 15 / 58 / 161), and the `System - Configuration` column positions. `tests/api.test.js` freezes the public function names because buttons and triggers are bound to them.

## 7. History is never deleted
Refreshes only add or update rows (tables grow automatically instead of failing). Completed / Discontinued grants are frozen at completion (Outcome/Support/Decision refresh covers Active grants only) but their rows and disbursement records stay. Central sheets mirror the grantee workbooks, including blanks. Outcome IDs stay attached to their indicator when the Setup is re-approved with a different order. Use **Backup Central Administration** before bulk operations; Version history restores data.
