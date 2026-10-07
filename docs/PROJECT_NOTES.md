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

## 2. Status (2026-09-30, close-out)
Built and tested locally (116 tests) and, up to Phase 3b + the speed rounds, verified on TEST by the owner: test harness, V15 cleanup, Upload Folder fixes, Push/Sync status columns, growing tables, stable Outcome IDs, Backup button,
`PROTECTION_EDITORS`, failure reasons, buttons that never write an Action, Disbursement Only / Not Applicable statuses, faster protection and sharing, and the close-out rounds:
**A** fewer saves + isolated / skippable refreshes, **B** column-tolerant reads/writes and name-based preflight, **C** config-driven lists / rolling financial years / time zone. Rounds A–C and the last cleanup still need the owner's TEST run
(checklist in `docs/PRODUCTION_ROLLOUT.md` §0 and the chat). **Nothing is on production.** Next: owner confirms TEST → follow `docs/PRODUCTION_ROLLOUT.md`.

Explicitly NOT done (needs the owner's yes, one item at a time): sharing / permission hardening (reopen rollback, old-email revocation retry, approval tied to a workbook version, `writersCanShare=false`, ACL audit);
storing "How will it be Measured?"; the two meanings of Q1–Q4; Exceptions Log auto-close (needs the owner's status vocabulary); `recordAutomationStatus_` was removed (Round G);
protected ranges of the grantee templates and the export block rows stay layout-driven (documented in `docs/OPERATING_MODEL.md` §6).

## 3. Owner decisions (do not re-litigate without asking)
- No hard-coded dropdown values or column positions in the long run; adding a column must not need a code change. Lists will live in
  `System - Configuration` (no new system sheet). Behaviour-driving values (Transactional, Discretionary, Approved …) stay in code.
- No functionality may be lost; all public function names stay until the real button bindings are confirmed.
- "Approved editors" for protections = team@goalkeep.net and Anagha's account (config key `PROTECTION_EDITORS`, built).
- Mixed file ownership (apfp.rda vs team@goalkeep.net): parked.
- Central Administration must not stay link-shared "anyone – editor" (owner will restrict it).
- **Completed grants:** Outcome / Support / Decision refresh covers **Active grants only**; a Complete/Discontinued grant is frozen at completion.
  Rows are never deleted. Disbursement rows of completed grants stay and still push/sync.
- **Cleared cells:** central sheets **mirror** the grantee workbook, including blanks (current behaviour, kept). It also corrects the Grant Start / End Dates (start must stay inside the grant's financial year; the Setup workbook's own dates are not changed) and Organisation Type (New / Returning): edit the cell on the completed row, then click the button; only the row and the Technical Registry change.
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
- Failure reasons are only in hidden sheets (shown in the end-of-run message).
- Setup › D. Outcomes "How will it be Measured?" is required but never stored. Stale "System Link" rows in the Setup template's Field Config.
- Two meanings of Q1–Q4 (grant quarters vs financial-year quarters). (Transactional Upload Folder cells are now written as links to the Disbursement Documents folder — Round G.)
- Sharing/permissions hardening (reopen rollback, old-email revocation, approval tied to a workbook version, `writersCanShare=false`, ACL audit): Phase 5, approve item by item.
- Codebook docs in Drive `Codes/` (V15.0 / V15.2 / V15.3) are stale; this repo is the source of truth.
- Grant Status uses `Complete`; workspace Action/Status use `Completed` — different fields, keep.

## 7. Build order for R1 + R2
1. Owner adds the two columns in TEST and confirms. 2. Header-based read/write of those columns, Push Status / Document Sync Status logic, edit-reset,
per-grant isolation and time guard. 3. "Last read" tracking + skip-unchanged workbooks for Active grants. 4. History protections + backup utility.
5. TEST scenario matrix (two new grants; run every button twice → second run writes nothing; mark a grant Complete → its rows stay and still sync;
fill a tracker → it grows; reorder outcomes on re-approval → progress stays with its indicator). 6. Production plan with backup first.

## 8. Health and optimisation audit (2026-09-30, after Phase 3a)
**Health:** 19 code files, ~5,300 lines, all pass a syntax check; 52 automated tests pass; no `V15` naming left; no unused internal functions left. Preflight PASS on TEST.
**Nothing is on production yet.** Test coverage is strong for helpers, tracker upsert and disbursement push/sync; there is none for workspace creation, sharing, protection,
approval, reopen or email (covered only by the manual TEST scenario).

**Done (verified on TEST):** test harness; TEST copy + push safety; cleanup; four Upload Folder fixes; Push Status / Document Sync Status with per-grant isolation and time guard.

**Not done — in priority order**
- P0: production rollout (backup → confirm production == original clone → push → add the two columns → preflight → real push/sync); owner removes the "anyone – editor" link;
  confirm real button bindings to retire unused aliases.
- P1 (data safety): tracker tables are fixed size → auto-grow; Outcome IDs follow row position → keep them attached to the indicator; Backup button;
  `PROTECTION_EDITORS` (team@goalkeep.net + Anagha are not kept as protection editors today); sharing hardening (reopen rollback, old-email revocation, approval tied to a version,
  grantees are folder writers); "How will it be Measured?" never stored; failure reasons only in hidden sheets; `recordAutomationStatus_`
  is a no-op; Exceptions Log never closes; orphan registry row for blank intake rows.
- P2 (column/dropdown changes without code): 27 positional `row[n]` reads (21 in `ReportingSupportDecisions.js`), `APFP.INTAKE.*_COLUMN` constants, ~34 fixed header widths,
  exact-order preflight, hard-coded dropdown lists / FY list / time zone, 9 unused config keys, 2 columns unknown to `Config.js`, stale docs.
- P3 (speed): per-cell API calls inside loops (`processDisbursementRow_` ~15–20 calls per tracker row, organisation-dropdown refresh, decision-document links, Prepare Disbursement Rows) can
  approach the 6-minute limit at a few hundred rows → batch reads/writes; refreshes re-open every active workbook on every run → skip unchanged; Outcome/Support/Decision refresh lack
  per-grant isolation and a time guard.
**Proposed order:** A production rollout → B history + backup + protection editors → C batching / skip-unchanged / isolation → D column-tolerant + config lists → E hardening one by one.
