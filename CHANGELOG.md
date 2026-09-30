# Changelog

Every change to this project is recorded here: **what** changed, **which files**, and **why**.
Newest first. Apps Script (`clasp push`) only receives the `.js`, `.html` and `appsscript.json` files;
everything else listed under "Repo only" stays in git (see `.claspignore`).

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
