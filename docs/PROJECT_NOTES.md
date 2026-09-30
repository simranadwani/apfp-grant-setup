# APFP Grant Setup — project notes (living record)

Read this first when picking the project up again. Keep it current. Every code change is also logged in `CHANGELOG.md`.

## 1. Environments and safety
| | Production | TEST copy |
|---|---|---|
| Central Administration sheet | `1zwkyD-F_BCmBvrLPuZzbbmFU1e44Nc_gBitHKNmjvuM` (owner team@goalkeep.net) | `1g2CnNTCsgzDBRSMYr7Cu2bagoQmkcYDq9sqMWvOaVRk` (owner simranadwaniii@gmail.com, shared with apfp.rda@gmail.com) |
| Apps Script project | id in `.clasp.prod.json` | id in `.clasp.json` (default) |
| Drive root for workspaces | `1fGA38bOPAf4GAzumjdJj1qFonjV1Uh4n` | `1rUu4ULndFlMhktBVY1butW6ou5dPHHyd` |

- `clasp push` goes to **TEST** by default. Production is pushed only deliberately: `clasp push -P .clasp.prod.json` (never before the change passed on TEST).
- Rollback of production code: `git checkout 3346443 -- *.js *.html appsscript.json && clasp push --force -P .clasp.prod.json`.
  Sheet *data* is restored from File → Version history; sent emails and granted shares cannot be undone.
- **TEST warning:** the 5 original organisations in the TEST sheet point at *production* workbooks. In TEST never use Retry/Reshare, change email,
  Lock & Migrate or Reopen on those rows. Use new rows (for example "Zz Test Org") only. TEST has `SEND_WORKSPACE_NOTIFICATION = No`.
- Local tests: `npm test` (Node 20+, no dependencies). Nothing in `tests/`, `docs/` or `*.md` is pushed to Apps Script (`.claspignore`).
- Buttons/triggers may be bound to any public function: the list is frozen by `tests/api.test.js`. Two manual triggers exist:
  `handleCentralAdminOpen` (on open) and `handleCentralAdminEdit` (on edit).

## 2. Status
Done and verified on TEST: test harness (Phase 0), TEST copy + push safety (0b), V15 cleanup / dead code (1),
Upload Folder layout fixes for disbursement push, link sync and outcome summary (2b). 42 tests passing.
Next: R1/R2 below, then column-tolerant reading everywhere (plan Phase 2), config-driven lists (Phase 3), hardening (Phase 5).

## 3. Owner decisions (do not re-litigate without asking)
- No hard-coded dropdown values or column positions in the long run; adding a column must not need a code change. Lists will live in
  `System - Configuration` (no new system sheet). Behaviour-driving values (Transactional, Discretionary, Approved …) stay in code.
- No functionality may be lost; all public function names stay until the real button bindings are confirmed.
- "Approved editors" for protections = team@goalkeep.net and Anagha's account (config key `PROTECTION_EDITORS` still to build).
- Mixed file ownership (apfp.rda vs team@goalkeep.net): parked.
- Central Administration must not stay link-shared "anyone – editor" (owner will restrict it).
- **Completed grants:** Outcome / Support / Decision refresh covers **Active grants only**; a Complete/Discontinued grant is frozen at completion.
  Rows are never deleted. Disbursement rows of completed grants stay and still push/sync.
- **Cleared cells:** central sheets **mirror** the grantee workbook, including blanks (current behaviour, kept).
- **Title corrections:** "Correct Workspace Details" updates the Grant Title on all rows including old disbursement rows (current behaviour, kept).

## 4. Requirement R1 — "processed" status columns (disbursements)
Owner adds two columns at the END of `6. Committed & Spent Tracker` (TEST first):
1. `Push Status`: blank/`Pending`, `Pushed`, `Changed – push again`, `Failed: <reason>`.
2. `Document Sync Status`: `Waiting for push`, `Awaiting documents`, `Partial (1 of 2 links)`, `Synced`.
Rules: Push visits only Disbursed rows not yet Pushed; Sync visits only rows not yet Synced; grants with nothing to do are not opened.
Editing Actual Date / Actual Amount / Status / Organisation on a Pushed row resets it automatically.
**These two columns are system-controlled: Anagha (and other operators) never fill them.** Only the script writes them; a redo is a button action
("Reset statuses for selected rows"), not typing. Protect the columns with *warning-only* protection (grey shading), never a hard lock: buttons run as the
person who clicks them, so a hard lock would stop the script writing as well.
Failure reasons go into the status text (visible feedback; there are no cell notes by design). A full-check variant re-verifies Synced rows.
Without the columns the code behaves as today. Outcome/Support get **no** per-row processed column (data changes all year); instead unchanged
workbooks are skipped using a per-grant "last read" time stored in `System - Technical Registry`. Nothing is added to Support.

## 5. Requirement R2 — never lose history
Audit result (code): nothing deletes history — all trackers use `upsertTrackerRowsByKey_(…, preserveUnmatched = true)`; `updateGrantStatus_` only
changes the status; disbursement eligibility uses Record Status, not Grant Status. Remaining work:
- Auto-grow tracker tables when full (today `Table capacity is N` stops refreshes because history accumulates forever).
- Keep Outcome IDs attached to their indicator when indicators are reordered on re-approval (today the ID follows the row position).
- Warn (never auto-delete) when a pushed disbursement is later set back from Disbursed.
- Add a `Backup Central Administration` utility (uses the currently unused `CENTRAL_ADMIN_FOLDER_ID`) and offer it before bulk operations.
- Optional, low priority: dated read-only Setup snapshot on each Lock & Migrate.
- Tests (`tests/history.test.js`) proving rows survive status changes, refreshes and re-syncs.

## 6. Findings backlog (from the full Drive/code review)
- Config: 9 keys in `System - Configuration` are never read by the code (`CENTRAL_ADMIN_FOLDER_ID`, `WORKSPACE_FOLDER_PATTERN`, `ORGANISATION_ID_PATTERN`,
  `GRANT_ID_PATTERN`, `SHARING_METHOD`, `TECHNICAL_REGISTRY_SHEET`, `OUTCOME_PROGRESS_SCHEMA_VERSION`, `SUPPORT_CATEGORY_OPTIONS`, `SUPPORT_STATUS_OPTIONS`).
- `recordAutomationStatus_` writes to Start Here rows that do not exist (no-op). Failure reasons are only in hidden sheets.
- Setup › D. Outcomes "How will it be Measured?" is required but never stored. Stale "System Link" rows in the Setup template's Field Config.
- Two meanings of Q1–Q4 (grant quarters vs financial-year quarters). Transactional template has no Links sheet, so its Upload Folder cell has no destination.
- Sharing/permissions hardening (reopen rollback, old-email revocation, approval tied to a workbook version, `writersCanShare=false`, ACL audit): Phase 5, approve item by item.
- Codebook docs in Drive `Codes/` (V15.0 / V15.2 / V15.3) are stale; this repo is the source of truth.
- Grant Status uses `Complete`; workspace Action/Status use `Completed` — different fields, keep.

## 7. Build order for R1 + R2
1. Owner adds the two columns in TEST and confirms. 2. Header-based read/write of those columns, Push Status / Document Sync Status logic, edit-reset,
per-grant isolation and time guard. 3. "Last read" tracking + skip-unchanged workbooks for Active grants. 4. History protections + backup utility.
5. TEST scenario matrix (two new grants; run every button twice → second run writes nothing; mark a grant Complete → its rows stay and still sync;
fill a tracker → it grows; reorder outcomes on re-approval → progress stays with its indicator). 6. Production plan with backup first.
