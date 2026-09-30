# Changelog

Every change to this project is recorded here: **what** changed, **which files**, and **why**.
Newest first. Apps Script (`clasp push`) only receives the `.js`, `.html` and `appsscript.json` files;
everything else listed under "Repo only" stays in git (see `.claspignore`).

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
