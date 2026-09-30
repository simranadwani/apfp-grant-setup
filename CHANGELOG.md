# Changelog

Every change to this project is recorded here: **what** changed, **which files**, and **why**.
Newest first. Apps Script (`clasp push`) only receives the `.js`, `.html` and `appsscript.json` files;
everything else listed under "Repo only" stays in git (see `.claspignore`).

## Round L — production readiness (audit findings) and email change

**Date:** 2026-09-30 · **TEST only, not yet in production**

- **Old Setup workbooks** (`RegistrySync.js`): the Registry Export is read to the sheet's real width (a 60-column export no longer reads a 61st column) and a late field missing from an old export is left out instead of written as blank, so hand-keyed registry values are never erased.
- **Double click / two operators** (`IntakeValidation.js`): `processRequestedActions` takes the lock before it reads the queue, so a second run cannot re-process rows the first one just finished (no second Request ID, no orphan registry record).
- **Organisation Maturity** (`RegistryAndIDs.js`): rows are read and written by header name; an inserted column can no longer garble or duplicate rows.
- **Push** (`DisbursementSync.js`): an edit made while a push runs keeps "Changed – push again"; a Disbursed row whose grant has no grantee workbook now shows `Failed: no grantee Disbursement Documents workbook…` instead of nothing.
- **Time guard** 270 s → 210 s (`Config.js`): a row started near the limit can take a minute or more.
- **Preflight** (`MenuAndChecks.js`): warns about invalid `PROTECTION_EDITORS` entries and an empty one; checks `CENTRAL_ADMIN_FOLDER_ID` is a reachable folder.
- **Change Primary Contact Email** (`SharingAndEmail.js`, `UiActions.js`, `RetryReshareDialog.html`, `ApprovalsAndAccess.js`, `Utilities.js`): Retry/Reshare now always opens its dialog when the selected row has a workspace (even with an Action set). Changing the email also updates the Setup workbook's contact cell (so a later approval does not write the old address back), updates the organisation contact when this is its latest grant, handles Registry Only grants (records only), lists any folder that still has the old address, writes a resolved audit line to the Exceptions Log, and has a checkbox to skip the workspace email. Editing the locked email cell explains where to change it.
- **Runbook** (`docs/PRODUCTION_ROLLOUT.md`): prerequisites, keep the DATA_SYNC_SCHEMA_VERSION row until sign-off, never delete whole config rows, Push before Sync, rollback notes.
- **Tests:** `tests/email-change.test.js`, `tests/maturity-by-header.test.js`, additions to actions, disbursement-status and lists tests. 129 pass.

## Round K — extra columns are not warned about

**Date:** 2026-09-30 · **TEST only** · `MenuAndChecks.js` `checkHeaders_` and `Utilities.js` `checkAdminTables_` no longer report "extra column(s) the code leaves alone" (adding a column such as Support Provided is normal). Missing required columns still fail. Tests and docs updated.

## Round J — dropdown lists are edited directly in the sheet

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Why:** the config-driven lists (`LIST_…` rows, `refreshDropdownsFromConfig`) added complexity for no gain; operators should just edit a dropdown where it lives.
- **Removed** (`Config.js`, `Utilities.js`, `UiActions.js`): `LIST_DEFAULTS`, `getList_`, `listNames_`, `defaultList_`, `rollingFinancialYears_`, `dropdownUpdateRequests_`, `refreshDropdownsFromConfig`, and the `FIRST_FY` / `FY_YEARS_AHEAD` / `LIST_*` settings. `TIME_ZONE` stays.
- **Preflight:** label dropdowns (Financial Year, Thematic Area, Sub-area, Proximity, Programme Status) are marked `FREE`: only the column must be a dropdown, options are not compared. Code-driven dropdowns still require their needed options (extras allowed). Leftover `LIST_…` rows now show in the "settings the code never reads" warning.
- **Tests:** list tests removed; 114 pass.

## Round I — clean messages; Organisation Type correctable

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Timing output removed** (`Utilities.js`, `UiActions.js`, `IntakeValidation.js`, `ProtectionIntegrity.js`, `RegistryAndIDs.js`, `SharingAndEmail.js`, `TemplatePrefill.js`, `WorkspaceCreation.js`, `TrackerLinks.js`, `RegistrySync.js`, `MenuAndChecks.js`): `timed_`, `slowestStepsSummary_` and every timing wrapper are gone. Pop-ups and toasts show only the result; the run summary still lists "Rows picked up". Behaviour is otherwise identical.
- **Correct Workspace Details also corrects Organisation Type** (`RegistryAndIDs.js`, `ApprovalsAndAccess.js`, `UiActions.js`): the cell may now be edited on a completed row (other identity cells stay locked). The button validates it (New / Returning Organisation), saves it to the Technical Registry and the row. No IDs, folders, sharing or workbooks change. Shorter success message.
- **Tests:** `tests/correct-details.test.js`; timing test removed. 118 tests pass.

## Round H2 — unbound functions removed

**Date:** 2026-09-30 · **TEST only** · Removed `uiCompleteSelectedSupport`, `uiRetryWorkspace`, `uiReshareWorkspace` (`UiActions.js`) and `uiResetDisbursementStatuses`: the owner confirmed no button uses them (Central Administration buttons: Create Workspace, Retry/Reshare, Lock & Migrate, Reopen Setup, Correct Workspace Details, Refresh Outcomes/Support/Decisions/Documents, Push Grant Status, Push to Grantee Workspaces, Refresh Organisations Options, Complete Rows).

## Round H — dropdown check no longer position-sensitive; clear unused settings

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes (small) · **TEST only**

- **Preflight dropdown check** (`Utilities.js` `checkAdminTables_`): a Table dropdown passes when every option the code relies on is present — order, blanks and extra options no longer matter; the error names the missing option(s).
- **No blank option** (`Config.js`): the Setup Review Status dropdown no longer lists an empty first value.
- **One-time setup functions removed** (`UiActions.js`): `seedListsFromDefaults` and `removeUnusedConfigRows` (added earlier in this round) are gone — one-time sheet setup (adding columns/settings rows, deleting unused rows) is done by hand; lists fall back to built-in defaults when a `LIST_…` row is missing. Docs updated.

## Round G — Transactional Upload Folder link, obsolete code removed

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Upload Folder link** (`TemplatePrefill.js` `writeTransactionalUploadLinks_`, `WorkspaceCreation.js`, `ProtectionIntegrity.js`): the Disbursement Documents folder was already created, but the Transactional workbook's Upload Folder cells were plain text
  (that template has no Links sheet). They are now `=HYPERLINK(<Disbursement Folder URL>,"Upload Folder")` in all 100 rows, written at creation and again by Retry Workspace / Retry Sharing (so existing Transactional workbooks are repaired). Only the Upload Folder column is written; push/sync are unaffected.
- **Removed `DATA_SYNC_SCHEMA_VERSION`** (`Config.js`, `RegistrySync.js`): no longer required or stamped; the `Template Schema Version` registry columns keep their existing values. Delete that row from System - Configuration (preflight warns while it exists).
- **Removed `recordAutomationStatus_`** (`Utilities.js` and 14 calls): it wrote to Start Here rows that do not exist. `refreshReportingData` simplified accordingly.
- **Test:** `tests/upload-links.test.js`.

## Round F — FCRA Registration Status and Foreign Funding % are required fields

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes (small) · **TEST only**

- **Why:** the owner confirmed `FCRA Registration Status` (Organisation Registry) and `Foreign Funding — Percentage of Total Annual Funding` (Grant Registry) are required, not optional extras.
- **Schema** (`Config.js`): both added to `ORGANISATION_HEADERS` (now 43, position 43) / `GRANT_HEADERS` (now 61, position 61) and to the `ADMIN_TABLES` columns. Their Table type/dropdown is not checked (`ANY_TYPE`), only that the column exists, because the live Table types are set by the owner.
- **Preflight** (`Utilities.js`): honours `ANY_TYPE`; a missing column is now an error, never an "extra column" warning.
- **Registry Export read** (`RegistrySync.js`): `setupRegistryExportRecords_` reads the org and grant blocks by header name (extra/reordered columns fine, missing core header named in the error). Older workbooks lacking the two new fields read them as blank instead of failing.
- **Seed function** (`UiActions.js`): `seedListsFromDefaults` fills Active / Editable / Value Type / Description / Last Updated columns by header name.
- **Tests:** schema snapshot (43/61, Table columns equal the header lists), export read by header incl. old workbooks. 117 tests pass (118 after Round G).

## Round D — empty rows, documentation and the production runbook

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes (small) · **TEST only**

- **Empty row with an Action** (`IntakeValidation.js`): the run reports "This row is empty. Fill in the grant details, or clear the Action." and creates **no** Request ID and **no** Technical Registry record for it (before, a blank row left an orphan registry entry).
  A partly filled row is validated as before.
- **Docs (repo only):** `docs/OPERATING_MODEL.md` (layers, grant types and their statuses, every button, settings, Push/Sync statuses, how to change columns / lists / time zone without code, what is layout-driven on purpose),
  `docs/PRODUCTION_ROLLOUT.md` (exact backup → verify-original → push → sheet changes → preflight → smoke test → clean-up → rollback), `README.md`, `docs/PROJECT_NOTES.md` status.
- Left as is on purpose: `recordAutomationStatus_` (harmless when Start Here has no matching row), Exceptions Log auto-close (needs the owner's status vocabulary).
- 116 tests pass.

## Round A — fewer saves, isolated and skippable refreshes, batched dropdown refresh

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Fewer Technical Registry saves per workspace** (`WorkspaceCreation.js`, `RegistryAndIDs.js`, `Utilities.js`): the financial-year and organisation-folder saves are one checkpoint, and the sub-folder / Setup workbook / Outcome workbook saves are one checkpoint
  (10 → 7 saves for a Restricted grant). Folder and workbook creation is find-or-create by name, so a run that stops in between finds the same items on retry. Each remaining save also no longer re-reads the row: `setByHeaders_` accepts the cached record (`setByHeadersKnown_`).
- **Reporting refreshes are isolated** (`ReportingSupportDecisions.js`): Outcome, Support and Decision refreshes read each grantee workbook inside a guard. A workbook that cannot be read is reported ("N grant(s) skipped because of a problem: G1 — …") and skipped
  while the others are refreshed and that grant's central rows are kept; a run stops cleanly before the time limit and says so. A missing required export header now skips that grant with the header named instead of stopping everything.
- **Unchanged workbooks are skipped**: after a successful read the workbook's Drive "last updated" time is remembered per grant and kind in Script Properties (no sheet column, nothing to add to production). A workbook not changed since is not opened;
  its central rows stay as they are. New button function `uiRefreshReportingForce` forgets those times and re-reads everything (use it after fixing a workbook by hand or restoring central rows).
- **Batched loops** (`UiActions.js`, `Disbursements.js`, `ReportingSupportDecisions.js`): the organisation dropdown refresh in the Committed & Spent Tracker makes a few calls instead of ~6 per row (two column reads, option list once per year, one write per run of rows);
  Prepare Disbursement Rows reads the sheet once and stops cleanly before the time limit; Decision document links read once and write only changed cells.
- Tests: `tests/trackers-by-header.test.js` (skip unchanged, isolate a broken workbook, force re-read), `tests/disbursement-options.test.js`, known-record save in `tests/tracker.test.js`. 114 tests pass.

## Round C — dropdown lists, financial years and time zone from System - Configuration

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only** · **Nothing breaks before you seed the new rows (defaults are kept in `Config.js`).**

- **Lists** (`Config.js`, `Utilities.js`): the label-only dropdowns — Thematic Area, Thematic Sub-area, Proximity, Programme Status (and Financial Year) — are no longer typed into the code.
  Their live values are `LIST_<NAME>` rows in `System - Configuration` (values separated by `|`); a missing or empty row falls back to `APFP.LIST_DEFAULTS`.
  Values that drive behaviour stay in code and are not editable lists: Organisation Type, Grant Type, Grant Status, Action, Setup Review Status, Grant Start Quarter, Yes/No.
- **Financial years roll forward by themselves**: from `FIRST_FY` (default 2026-27) to the current FY + `FY_YEARS_AHEAD` (default 3); set `LIST_FINANCIAL_YEARS` to fix an explicit list instead. The list no longer expires after 2029-30.
- **New admin functions** (`UiActions.js`): `seedListsFromDefaults()` adds the missing settings with today's values (never overwrites); `refreshDropdownsFromConfig()` pushes edited lists into the native Table dropdowns (one Sheets `updateTable` call, only for lists that changed).
- **Preflight** compares Table dropdowns with the configured lists, and warns about `System - Configuration` rows the code never reads (safe to delete). `KNOWN_CONFIG_KEYS` is guarded by a test that scans the source.
- **Time zone** is the `TIME_ZONE` setting (default Asia/Kolkata) instead of a constant.
- Tests: `tests/lists.test.js` (defaults, overrides, rolling FY, dropdown update plan, seeding twice, known-keys scan). 109 tests pass.

## Round B — column-tolerant reads and writes (adding or moving a column needs no code change)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Workspace Creator columns by name** (`Utilities.js` `intakeColumn_`, used in `ApprovalsAndAccess.js`, `IntakeValidation.js`, `MenuAndChecks.js`, `RegistryAndIDs.js`): the 30 fixed column numbers in `Config.js` (`INTAKE.*_COLUMN`, identity block start/count) are gone.
  The grant-identity block is "Financial Year" through "Grant Title" as found in the header row; returning-organisation prefill writes Thematic Area / Sub-area / Proximity by header (no longer three adjacent cells).
- **Outcome / Support / Decision trackers by name** (`ReportingSupportDecisions.js`): the ~19 positional `row[n]` reads are replaced. Grantee export blocks are read by header (`trackerExportObjects_`, order and extra columns free, a missing required header is named in the error);
  central rows are built as objects and written to the live column positions (`upsertTrackerObjects_`); **columns the code does not know are never overwritten**; manual columns (Q1–Q4 Status / Notes, decision fields) are preserved by name.
  `refreshDecisionDocumentLinks_` no longer assumes its three columns are adjacent and writes only changed cells in grouped ranges instead of one read per row.
- **Widths** (`Disbursements.js`, `DisbursementHelpers.js`, `IntakeValidation.js`): the tracker, Workspace Creator and duplicate-flag scans read the live sheet width, not the length of a header list.
- **Preflight** (`MenuAndChecks.js`, `Utilities.js`, `ReportingSupportDecisions.js`): "exact order and exact width" became "every required header present by name". Extra columns (for example `FCRA Registration Status`, `Foreign Funding — Percentage…`) pass and are listed as warnings;
  a missing header or a wrong column type / dropdown is still a blocking error. Applies to central sheets, native Tables, template exports and the Transactional template.
- Tests: `tests/trackers-by-header.test.js` (reordered export, new central column, unknown column preserved, missing header named), `tests/preflight-headers.test.js`. 102 tests pass.
- **Still layout-driven by design:** the grantee templates' protected ranges (`F5:F14` …), export block rows (2 / 15 / 58 / 161) and the System - Configuration columns A / B / F are template layout, documented in `docs/OPERATING_MODEL.md`.

## Speed step 3 — table headroom, cheaper maturity rows, no repeat pre-share verification

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Measured:** Grant Registry write ~6 s per grant, Share folder 21.9 s for a full grant, Technical Registry saves ~1 s each.
- **Table headroom** (`Utilities.js` `appendObject_`, `RegistryAndIDs.js`): when a registry Table (Grant Registry, Maturity, …) is full it now grows by the rows needed **plus 100**, so the slow Table-extension call happens rarely
  instead of on nearly every new grant.
- **Maturity rows** (`RegistryAndIDs.js`): existing indicator rows are rewritten only when a value actually differs (was 11 read+write calls on every save).
- **Share folder** (`ProtectionIntegrity.js`): the "before sharing" check no longer repeats the links / protections / time-zone verification of a workbook that the **same run** just finalised and verified
  (tracked per run only, never across runs). The grantee-access check still runs, and the "after sharing" check always does the full verification, so the fail-closed gate is unchanged.
- **Finer timers** for the Grant Registry save (row / organisation entry / maturity rows); the alert now lists the 12 slowest steps.
- Tests: table headroom, per-run verification skip (and that the after-sharing check never skips). 94 tests pass.

## Buttons never write an Action; statuses for Transactional / Discretionary; faster protection editors

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Retry / Reshare bug** (`UiActions.js`): the button wrote `Retry Workspace` into whichever row was selected (a blank row 14) and then ran all queued rows. Rule now applies to **every** workspace button:
  they never write an Action; only rows a person (or the system after a failure) marked run. `uiRetryOrReshareWorkspace` opens its dialog only when the selected row already has a workspace (decided from the
  Technical Registry status) and no pending Action; otherwise it just runs the marked rows. `uiRetryWorkspace` / `uiReshareWorkspace` (aliases) simply run the marked rows. `runWorkspaceAction_` removed.
- **Statuses** (`TrackerLinks.js`, `WorkspaceCreation.js`, `Config.js`): Transactional now shows Workspace Status **Disbursement Only**; Discretionary keeps **Registry Only**; both show Setup Review Status **Not Applicable**.
  Display only: the Technical Registry keeps `Workspace Created` for Transactional, so no rule that reads it changes. `Not Applicable` was added to the Setup Review Status dropdown definition
  (**existing sheets need the value added once**, see steps below; preflight compares the dropdown list).
- **Faster** (`ProtectionIntegrity.js`): "Protection: restrict editors" cost ~1.8 s x13 per Setup workbook. Owner / running account / `PROTECTION_EDITORS` are now resolved once per workbook, editors are read once,
  and adds/removes happen only when needed (one batched `removeEditors`). The end state is identical (only those people can edit; everyone else and domain editing removed).
- The end-of-run alert now lists the 8 slowest steps.
- Tests: `tests/statuses.test.js` (new), button tests in `tests/actions.test.js`, call-count tests in `tests/safety.test.js`. 91 tests pass.

## Fix — batched placeholder check failed on out-of-grid ranges (regression from speed step 2)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **What broke:** Create Workspace failed on a new row with `Range (Links!B7) exceeds grid limits. Max rows: 6`. The batched check in `verifyConfiguredWorkbook_` (`TemplatePrefill.js`)
  sends Field Config ranges to the Sheets API, which rejects ranges outside the sheet; the old per-row `getRange` tolerated them. The Setup template's Field Config still has stale "System Link" rows (`Links!B5:B12`) but the Links sheet has 6 rows.
- **Fix:** ranges are clipped to the real grid first (`clipA1ToGrid_`): wholly outside → skipped, partly outside → shortened, unparseable → unchanged. The placeholder check itself is unchanged.
- **Row that failed:** it kept `Retry Workspace`; click Create Workspace again and it resumes from its saved step (nothing is duplicated).
- **Finer timers** inside the Setup protection steps (remove admin sheets/time zone, apply protections, flush, verify links, verify protections, and per protection: set ranges / restrict editors) to find the real cost (protections were ~30 s per Setup workbook).
- Tests: `clipA1ToGrid_` cases and the stale `Links!B7` scenario. 81 tests pass.

## Fix + speed step 2 — Create Workspace button no longer marks the selected row; faster Setup workbook check

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Bug fixed** (`UiActions.js`): the Create Workspace button used to write "Create Workspace" into whichever row was selected and then run every queued row, so pressing Enter after typing
  the Action in row 11 (cursor now on row 12) and clicking the button ran rows 11 **and** 12. `uiCreateWorkspace` now only runs rows whose Action a person already set and never writes into the selection.
  Retry / Reshare still act on the row you explicitly select (they choose the action from that row's status).
- **Faster** (`TemplatePrefill.js`): from the measured run, "Configure Setup workbook" took 46.9 s. The final check read every Field Config range with its own call and re-verified links and protections that
  had just been verified. It now reads all ranges in one Sheets call and does not repeat the verification (`finaliseSetupWorkbookIntegrity_` already ran it with nothing written since). The
  invisible-placeholder check is unchanged.
- **Finer timers** (`TemplatePrefill.js`, `SharingAndEmail.js`, `ProtectionIntegrity.js`) so the next run shows what is slow inside "Share folder" and the two workbook steps.
- Tests: `tests/prefill.test.js` (one call, placeholder still caught, missing sheet still fails), button test in `tests/actions.test.js`. 79 tests pass.

## Speed step 1 — measure where the time goes (no behaviour change)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes (reporting only) · **TEST only**

- **Files:** `Utilities.js` (`timed_`, `slowestStepsSummary_`, workbook opens timed), thin timing wrappers around the key steps in `WorkspaceCreation.js`, `TemplatePrefill.js`, `SharingAndEmail.js`,
  `MenuAndChecks.js`, `ProtectionIntegrity.js`, `TrackerLinks.js`, `RegistryAndIDs.js`, `RegistrySync.js`; `IntakeValidation.js` and `UiActions.js` show the result.
- **Why:** to optimise the real hot spots instead of guessing. The workspace alert and the refresh toasts now end with e.g. `Slowest steps: Copy template workbook 41.2s (x2), Save Technical Registry 9.8s (x27).`
- Each wrapped function keeps its name and behaviour (the original body is now `<name>Untimed_`). `tests/pure.test.js` covers the timer. 75 tests pass.

## Change — workspace buttons run every queued row; message lists the rows

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only**

- **Files:** `IntakeValidation.js` (`processRequestedActions`), `UiActions.js`, `tests/actions.test.js`.
- **Decision (owner):** every row whose Action says Create Workspace / Retry Workspace / Retry Sharing must run when a workspace button is clicked. A short-lived
  "selected row only" change was reverted for that reason.
- **Added:** the end-of-run message now ends with `Rows picked up: 9, 10, …`, so an operator can see exactly which rows ran (a failed row keeps its Action and runs again on the next click).

## Phase 3b — Data safety: growing tables, stable Outcome IDs, backup, protection editors, failure reasons

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **TEST only, not on production**

### Added
- **Auto-growing tracker tables** (`Utilities.js`: `extendTableToSheetEnd_`, `upsertTrackerRowsByKey_`). When Outcome Progress, Support or Decision Tracker is full, the sheet
  and its native Table gain rows instead of stopping with `Table capacity is N`. Why: history is kept forever, so a fixed size would eventually block every refresh.
- **Stable Outcome IDs** (`ReportingSupportDecisions.js`: `planOutcomeRows_`, `writeOutcomeSystemColumns_`). On re-approval an indicator keeps its row and Outcome ID
  (matched by text, then same-position edit, then a never-used row). Reordering the Setup no longer moves quarterly progress to another indicator. Retired rows are never reused.
  If no free row exists the error names the indicator. Writes go by header name and only to changed cells; the Upload Folder column is never touched.
- **Backup button** `uiBackupCentralAdministration` (`UiActions.js`, `MenuAndChecks.js`): copies Central Administration into `<CENTRAL_ADMIN_FOLDER_ID>/Backups` with a timestamp.
  Uses the previously unused `CENTRAL_ADMIN_FOLDER_ID` key.
- **`PROTECTION_EDITORS`** config key (`ProtectionIntegrity.js`): comma, semicolon, space or pipe separated emails kept as protection editors in addition to the owner and the
  running account (owner decision: team@goalkeep.net and Anagha). An editor with no access to a workbook is skipped, not fatal.
- **Failure reasons in the end-of-run message** (`WorkspaceCreation.js`, `IntakeValidation.js`, `SharingAndEmail.js`): each row that needs attention is listed with its reason
  (first 8, then "…and N more"), so operators no longer need the hidden sheets.

### Tests (repo only)
- `tests/outcomes.test.js`, `tests/safety.test.js` (new), growth tests in `tests/tracker.test.js`, `uiBackupCentralAdministration` added to the frozen API list, `FakeSheet.insertRowsAfter`. 72 tests pass.

## Phase 3a — Push Status / Document Sync Status (requirement R1)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes · **Works with or without the new columns**

### Added
- **`DisbursementSync.js`** (new): the disbursement push and link-sync logic, moved out of `ReportingSupportDecisions.js` and rebuilt around two optional,
  script-controlled columns at the end of `6. Committed & Spent Tracker`:
  - `Push Status`: *(blank)* → `Pushed` / `Failed: <reason>` / `Not applicable` (Discretionary) / `Changed – push again`.
  - `Document Sync Status`: `Waiting for push` → `Awaiting documents` → `Partial (1 of 2 links)` → `Synced` (or `Failed: <reason>` / `Not applicable`).
  Operators never type in them. Names and values are in `Config.js` (`APFP.DISBURSEMENT_STATUS`).
- Push visits only Disbursed rows that are not yet Pushed; Sync visits only pushed rows that are not yet Synced. **A grant with nothing left to do is not opened.**
- Editing Actual Date / Actual Amount / Status / Grant ID on a Pushed row sets it to `Changed – push again` (`markEditedDisbursementsForRepush_`, called from the
  existing edit handler), so a correction is never skipped.
- **Each grant is processed independently**: a broken workbook is reported on its own rows and never stops the others; a run pauses cleanly before the
  6-minute limit ("click again to continue"). Failures are shown in a message and in the row's status text.
- New public functions (buttons optional): `uiSyncDisbursementsFullCheck` (re-verifies rows already Synced) and `uiResetDisbursementStatuses` (blanks both
  statuses for the selected rows so they are redone).
- `disbHeaderMap_` now reads the whole header row (previously only the first 16 columns) so extra trailing columns are visible to the edit handler.

### Without the columns
Exactly the previous behaviour: every row is checked on every run (`syncDisbursementsToGranteeWorkbooks_` / `syncGranteeDisbursementLinksToCentral_` keep their names and
return values; Refresh Reporting still uses them). Failures now throw one summary message after all grants were tried, instead of stopping at the first.

### Tests
`tests/disbursement-status.test.js` (10 tests): second run opens nothing, only grants with pending rows are opened, failure isolation, time-guard pause and resume,
Not applicable, Waiting/Partial/Synced flow and full check, missing-in-workbook flag, re-push marking, reset, and the no-columns path. `npm test` → **52 passing**.

### Deploy / verify (TEST copy)
```bash
git pull origin claude/gifted-allen-0a626q
clasp push
```
In the TEST sheet, add two columns at the END of the header row (row 2) of `6. Committed & Spent Tracker`, spelled exactly `Push Status` and `Document Sync Status`.
Then with your existing "Zz Test Org" disbursement: Push (row → Pushed, sync → Awaiting documents), Sync Disbursement Links (→ Synced), then Push and Sync again
(both should report 0 and finish instantly), change the Actual Amount (→ Changed – push again), Push (→ Pushed, amount updated, links kept).

## Notes — requirements and decisions recorded (no code change)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** no

Added `docs/PROJECT_NOTES.md`, the living record of environments, owner decisions, the "processed status columns" requirement (R1),
the "never lose history" requirement (R2), the findings backlog and the build order. Owner decisions taken today: completed grants stay frozen
at completion (rows never deleted), central sheets keep mirroring grantee workbooks including blanks, and title corrections keep updating old
disbursement rows (all = current behaviour, kept on purpose).

## Phase 2b — Fix the Upload Folder layout defects (disbursements + outcome summary)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes (`ReportingSupportDecisions.js`, `DisbursementHelpers.js`)

### Fixed
The templates gained an **Upload Folder** column (Disbursement Documents col E; one after every quarter in Outcome
Progress) but four functions still used the old column positions. All four now find columns **by header name**.
1. **Push Disbursements** (`syncDisbursementsToGranteeWorkbooks_`) — no longer fails with "…has no empty rows remaining"
   (a row is free when its four system cells are empty; Upload Folder text no longer counts as data) and no longer
   overwrites the Upload Folder formula. It writes only *Grant ID, Disbursement ID, Disbursement Date, Disbursed Amount*,
   only for cells that changed; grantee-entered receipt/letter links are never touched.
2. **Sync Disbursement Links** (`syncGranteeDisbursementLinksToCentral_`) — reads *Donation Receipt Link* and
   *Donation Letter Link* by name (previously it copied "Upload Folder" into Receipt and the receipt into Letter).
   The central Receipt/Letter columns are also written by name.
3. **Decision Tracker "Outcome Summary"** (`outcomeSummaryForGrant_`) — picks the latest of *Final Actual, Q4…Q1 Progress*
   by header (previously it read "Upload Folder" text from an old column position).
4. New helper `granteeDisbursementTable_` (DisbursementHelpers.js) resolves the columns of a grantee *Disbursement Documents*
   sheet once from its header row; adding, removing or reordering columns there no longer needs a code change.

### Behaviour differences to be aware of
- Push now **stops with a clear error** if a grant has more disbursements than the sheet has rows (100) — before, extra
  rows were silently dropped.
- The "N rows pushed" number now counts rows actually changed (before, it was inflated because rows always looked changed).
- A missing required column produces a message naming the column, e.g.
  `Disbursement Documents for Grant ID G1 is missing the column "Donation Receipt Link".`
- Otherwise unchanged: grantees clearing a link does not clear it centrally; only `Disbursed` rows are pushed.

### Tests
`tests/known-defects.test.js` → `tests/disbursement-sync.test.js`; the four `todo` tests are now real tests, plus new ones for
idempotent push, in-place amount update, added/reordered columns, capacity error and missing-column error.
`npm test` → **42 passing, 0 TODO, 0 failing.**

### Deploy / verify (TEST copy first — do not use the 5 copied organisations)
The TEST sheet's five existing grants point at the *production* workbooks, so create a brand-new grant in TEST:
1. `1. Workspace Creator`: new row — FY 2026-27, 01/04/2026–31/03/2027, New Organisation "Zz Test Org", any classification,
   Grant Title "ZZ Test Grant", Unrestricted, Amount 1000000, Primary Contact Email = **your own address** → select the row → **Create Workspace**.
2. `6. Committed & Spent Tracker`: **Refresh Organisation Options**, pick FY 2026-27 and "Zz Test Org", enter Planned Date and Planned Amount,
   click **Prepare Disbursement Rows** (a `DISB-2627-…` ID appears). Set Status = Disbursed, Actual Date, Actual Amount.
3. Click **Push Disbursements**. Open the test org's Outcome workbook → *Disbursement Documents*: the row shows the
   Grant ID, Disbursement ID, date and amount, and the **Upload Folder** cell still works.
4. In that workbook paste any Drive links into *Donation Receipt Link* and *Donation Letter Link*, then in the central tracker click
   **Sync Disbursement Links**: the two central link columns show the pasted links (not the words "Upload Folder").
5. Change the Actual Amount centrally and push again: only the amount changes; the pasted links stay.
Send me anything unexpected. Nothing here touches production.

## Phase 1 — Cleanup and de-versioning (behaviour-preserving)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** yes (code only; no sheet, template or config change)

### Changed
- `V15Actions.js` → **`UiActions.js`** (renamed). Helpers renamed: `v15SelectedDataRow_` → `selectedDataRow_`,
  `v15Notify_` → `showToast_` (toast title `APFP V15` → `APFP`), `v15RunWorkspaceAction_` → `runWorkspaceAction_`,
  `v15DisbursementOrganisationsForFy_` → `disbursementOrganisationsForFy_`.
  `ProtectionIntegrity.js`: `v15HardenProtectionEditors_` → `hardenProtectionEditors_`.
  **Every public function name is unchanged**, so buttons, triggers and the Retry/Reshare dialog keep working.
- `Config.js` — removed the unused `SCHEMA_VERSION: '…-v15.0'` constant (nothing read it; the stamped
  `DATA_SYNC_SCHEMA_VERSION` comes from `System - Configuration`, unchanged).
- `UiActions.js` — the "Support closure is manual…" message no longer mentions V15.
- `ReportingSupportDecisions.js` — fixed a missing comma in `refreshReportingData` that turned `detail` into an
  accidental global variable (it worked only because Apps Script is not strict; now a proper `const`).
- New shared helper `groupConsecutive_` (Utilities.js) replaces three hand-written copies of the same loop in
  `writeChangedSegments_`, `writeChangedMatrixRows_` and `syncGranteeDisbursementLinksToCentral_`.
- New helpers `disbHeaderRow_()` / `disbFirstDataRow_()` (DisbursementHelpers.js) replace ~15 repeats of
  `APFP.PREFLIGHT_SCHEMA.CENTRAL_HEADER_ROWS.DISBURSEMENTS (+ 1)` in the disbursement code.

### Removed (dead code — no caller anywhere)
- `showAdminMenu_` (empty), `clearHeaderCache_`, `disbNotify_` (now calls `notifyAdmin_` directly).
- `ensureWriterAccess_`, `ensureInitialWorkspaceSharing_` — one-line wrappers, inlined as
  `ensureUserRole_(…, 'writer', config)`.
- The organisation fuzzy-match chain `likelyOrganisationMatches_`, `likelySameOrganisationName_`, `levenshtein_`,
  `normaliseOrganisationName_` — deliberately disabled ("similar-looking names are allowed for New Organisation");
  still available in git history if ever wanted.

### Kept on purpose
`uiRetryWorkspace`, `uiReshareWorkspace`, `uiCompleteSelectedSupport` and every other public function: they may still
be assigned to buttons. They will be removed only after the owner exports the real button assignments.

### Tests
`npm test` → 30 passing, 4 TODO (the known Upload Folder defects, unchanged), 0 failing. New tests: `groupConsecutive_`,
`writeChangedSegments_`, and a guard that no `V15`/version-number naming reappears in code or dialogs.

### Deploy / verify (TEST copy first)
```bash
git pull origin claude/gifted-allen-0a626q
clasp push                 # goes to the TEST script (see .clasp.json)
```
In the TEST sheet: run `runPreflightChecks` (expect PASS + the "notification disabled" warning), then click
**Refresh Outcome Progress** and **Refresh Disbursement Options** once to confirm buttons still respond.
Note: `clasp push` replaces the file `V15Actions` with `UiActions` in the script project — that is expected.

## Phase 0b — Test copy and push safety (no behaviour change)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** no

### Changed
- `.clasp.json` — now holds a **placeholder** script ID (`PASTE_TEST_COPY_SCRIPT_ID_HERE`). A plain `clasp push`
  therefore cannot reach production by accident (it fails until a real test script ID is pasted in).
- `.clasp.prod.json` (new) — holds the production script ID. Production is only ever pushed deliberately (below).
- `.claspignore` — also excludes both `.clasp*.json` files.

### Created in Google Drive (outside the production tree, owner: simranadwaniii@gmail.com, not shared)
- Folder `APFP TEST` → `Test Root (Grant Setups)` (id `1rUu4ULndFlMhktBVY1butW6ou5dPHHyd`) — the test `ROOT_FOLDER_ID`.
- `APFP Central Administration – TEST` (id `1g2CnNTCsgzDBRSMYr7Cu2bagoQmkcYDq9sqMWvOaVRk`) — a copy of the production
  sheet, including its hidden sheets. **It still contains the production `ROOT_FOLDER_ID`, `SEND_WORKSPACE_NOTIFICATION = Yes`
  and five real grantee emails until they are changed by hand (see steps below).**

### Why
Production sharing/email/disbursement code cannot be run from the cloud session and its side effects (emails, shares,
data writes) cannot be undone by rolling code back, so every change is tried on the copy first.

### Rollback (production)
```bash
git checkout 3346443 -- *.js *.html appsscript.json     # the original code cloned from Apps Script
clasp push --force -P .clasp.prod.json                  # restore it to production (only if something breaks)
```
Sheet *data* is restored from File → Version history; sent emails and granted shares cannot be undone.

### Steps for the owner (in the TEST copy only)
1. Open the TEST sheet → **Extensions → Apps Script**. If the code files are there, the script was copied; open
   **Project Settings** and copy the **Script ID**. Paste it into `.clasp.json` (replace the placeholder).
2. In the TEST sheet: **View → Hidden sheets → System - Configuration** and set
   `ROOT_FOLDER_ID` = `1rUu4ULndFlMhktBVY1butW6ou5dPHHyd` and `SEND_WORKSPACE_NOTIFICATION` = `No`.
3. In `1. Workspace Creator` replace the five grantee emails with your own address (or clear the rows).
4. Apps Script → **Triggers** → add `handleCentralAdminOpen` (On open) and `handleCentralAdminEdit` (On edit); click **Allow** when asked.
5. Locally: `clasp push` (goes to the TEST script because of step 1), then run `runPreflightChecks` in the TEST sheet and send me the result.

## Phase 0 — Safety net (no behaviour change)

**Date:** 2026-09-30 · **Affects Apps Script runtime:** no

### Added (repo only — not pushed to Apps Script)
- `.claspignore` — keeps `tests/`, `docs/`, `package.json` and Markdown out of `clasp push`.
- `package.json`, `.gitignore` — `npm test` runs the local test suite with Node's built-in runner (no dependencies).
- `tests/harness.js` — loads every project `.js` file into one Node `vm` context (mirroring Apps Script's shared
  global scope) with small in-memory fakes for sheets; no Google API is ever called.
- `tests/api.test.js` — freezes the 27 public entry points that may be bound to buttons, triggers or the HTML
  dialog, and snapshots the schema contract (header counts, editable ranges, Transactional layout).
- `tests/pure.test.js` — characterisation tests for the pure helpers (FY/quarter/date/number parsing, ID and
  name helpers, Drive-ID extraction, email-template merge, Field Config validation rules, step ordering).
- `tests/tracker.test.js` — characterisation tests for the row-diff / upsert logic used by the central trackers.
- `tests/known-defects.test.js` — four tests, flagged `todo`, that reproduce real defects (below). They report as
  TODO, not failures; when a defect is fixed its `todo` flag is removed so the test guards it permanently.
- `CHANGELOG.md` — this file.

### Why
The system is live and handles grant money and Drive sharing. Before cleaning up or making layouts
column-tolerant, current behaviour is pinned by tests so that "no lost functionality" is checkable.

### Result
`npm test` → 28 passing, 4 TODO (known defects), 0 failing.

### Known defects reproduced by the new tests (not fixed yet — scheduled as "Phase 2b")
All four come from the Upload Folder redesign: the templates changed layout, but some functions still use the
old positions. They are exercised with fakes that model the live templates (column E shows the text
"Upload Folder" on every row); confirm against a real run on the dev copy.
1. `syncGranteeDisbursementLinksToCentral_` (ReportingSupportDecisions.js) reads `row[4]`/`row[5]` as receipt/letter.
   Template is E = Upload Folder, F = Receipt, G = Letter, so central *Donation Receipt Link* becomes the text
   "Upload Folder" and *Donation Letter Link* receives the receipt link.
2. `syncDisbursementsToGranteeWorkbooks_` writes columns A–F including `old[4]`, i.e. it would replace the
   Upload Folder formula with plain text.
3. The same function detects empty rows with `!row.some(value => clean_(value))`; because every row's Upload
   Folder cell always shows text, no row is ever "empty", so a first push fails with
   "Disbursement Documents workbook for <Grant ID> has no empty rows remaining."
4. `outcomeSummaryForGrant_` picks the latest progress from column indices 21/17/13/9/5 (old 17-column layout);
   in the current 26-column layout index 21 is *Q4 Upload Folder*, so the Decision Tracker summary would read
   "<indicator> — Upload Folder".

### Other findings recorded during the review (see the plan; not changed here)
- `How will it be Measured?` (Setup › D. Outcomes) is required and validated but never stored anywhere.
- Nine `System - Configuration` keys are never read by the code; `recordAutomationStatus_` writes to Start Here
  rows that do not exist; several Setup-template Field Config "System Link" rows point at the wrong Links cells.
- Central Administration must not stay link-shared as "anyone – editor" after the review.

### How to deploy / verify (this phase has nothing to push to Apps Script)
```bash
# 1. Before any local editing session (brings down anything changed in the browser editor):
cd apfp-grant-setup && git pull origin claude/gifted-allen-0a626q && clasp pull
git status            # any modified .js file here means the deployed script differs from git — tell me before continuing

# Run the local tests (needs Node 20+):
npm test

# 3. clasp push  → not needed for Phase 0 (no runtime files changed)

# 4. Record and publish:
git add -A && git commit -m "Phase 0: test harness, claspignore, changelog" && git push origin claude/gifted-allen-0a626q
```
