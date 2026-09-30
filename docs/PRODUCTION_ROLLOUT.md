# Production rollout — exact steps (do this only after every TEST check has passed)

Production = the **APFP Central Administration** sheet owned by team@goalkeep.net and its bound script (script id in `.clasp.prod.json`). TEST = `.clasp.json` (default). Nothing below touches TEST.
Everything you type is in `code blocks`; run terminal commands from the repository folder unless stated.

## 0. Before you start
* All TEST checks passed (last full round: Restricted, Transactional, Discretionary rows; every refresh button twice; preflight PASS; add-a-column and add-a-dropdown-value checks).
* Choose a quiet time: no grantee is mid-approval and nobody else is editing the sheet.
* Optional but recommended, once TEST is confirmed: `git tag test-passed-$(date +%Y%m%d) && git push origin --tags`.

## 0b. Production prerequisites (check BEFORE pushing the code)
* `9. Organisation Registry` has the column `FCRA Registration Status` and `8. Grant Registry` has `Foreign Funding — Percentage of Total Annual Funding` (both inside their Tables).
* `System - Configuration` is hidden; the maturity catalogue is intact: `J2:K12` (11 indicators), statuses `L2:L4`, named ranges `APFP_MATURITY_CATALOGUE` and `APFP_MATURITY_STATUSES`.
* **Never delete whole rows in System - Configuration** (the catalogue lives in columns J:L of the same rows). Select columns A to H of a row, then Delete cells → Shift up, or just clear them.
* **Keep the `DATA_SYNC_SCHEMA_VERSION` row until you have signed off production**: the original code requires it, so a rollback would fail without it.
* Take the **"Anyone with the link – Editor"** sharing off Central Administration now, not at the end.
* Confirm the buttons are assigned to the functions in `docs/OPERATING_MODEL.md` §3 (no drawing may still point at `uiRetryWorkspace`, `uiReshareWorkspace`, `uiCompleteSelectedSupport` or `uiResetDisbursementStatuses`, which were removed) and that the two triggers exist (Extensions → Apps Script → Triggers).
* In `6. Committed & Spent Tracker`, filter *Donation Receipt Link* and *Donation Letter Link* for the text `Upload Folder` and clear any such cell (the original code could copy the wrong column).

## 1. Two backups (5 minutes)
1. In production: **File → Make a copy** → name it `APFP Central Administration — backup before rollout YYYY-MM-DD`, keep it in the Admin folder.
2. The live code is saved by step 2 below (keep that folder until you are happy with production).

## 2. Prove production still equals the original code (so nothing is overwritten by surprise)
```
mkdir -p ../apfp-prod-live && cp .clasp.prod.json ../apfp-prod-live/.clasp.json
(cd ../apfp-prod-live && clasp pull)
mkdir -p /tmp/apfp-orig && git archive 3346443 | tar -x -C /tmp/apfp-orig
for f in ../apfp-prod-live/*.js ../apfp-prod-live/*.html ../apfp-prod-live/appsscript.json; do diff -q "$f" "/tmp/apfp-orig/$(basename "$f")"; done
```
No output = identical. **If any file differs, stop** and send me the `diff` of that file: someone changed production after the original clone and we merge that first. Keep `../apfp-prod-live` as the code backup (rollback source).

## 3. Push the new code to production
```
git fetch origin claude/gifted-allen-0a626q
git reset --hard origin/claude/gifted-allen-0a626q
git log -1 --oneline
npm test
rm -rf ../apfp-prod-push && mkdir ../apfp-prod-push
cp .clasp.prod.json ../apfp-prod-push/.clasp.json
cp *.js *.html appsscript.json ../apfp-prod-push/
(cd ../apfp-prod-push && clasp push)
```
(Newer `clasp` versions refuse `clasp push -P .clasp.prod.json` with "srcDir escapes project root", so production is pushed from its own small folder, exactly like step 2's pull. `../apfp-prod-live` stays untouched as the rollback copy.)
Do **not** run `clasp pull` in this folder right before updating: it overwrites the local files with the deployed script and you would push the old code again. After the push, run `runPreflightChecks`: its first line shows `Code version: …`, which must match the round in `CHANGELOG.md`.
`npm test` must show all tests passing. The manifest now also lists the `script.container.ui` scope (needed to open the Retry/Reshare dialog): after the push, open the Apps Script editor once, run any function (for example `runPreflightChecks`) and click **Allow** so the new permission is granted; other users are asked once on their next button click. `clasp push` asks nothing else; the script is replaced with this version (the old `V15Actions.js` is removed automatically).
Leave the `DATA_SYNC_SCHEMA_VERSION` row in place for now (see step 0b); nothing reads it in the new code, and preflight only warns about it. Delete it after sign-off, together with any V14.1 / V15.0 description text.

## 4. One-time sheet changes in production (in this order)
1. **Setup Review Status dropdown:** in `1. Workspace Creator`, edit the Table column *Setup Review Status* → dropdown → add the value `Not Applicable`.
2. **Tracker status columns:** in `6. Committed & Spent Tracker` add two columns at the far right (inside the Table): `Push Status` and `Document Sync Status`. Nobody types in them. (Optional: warning-only protection and grey shading.)
3. **System - Configuration:** add rows (Active = Yes) `PROTECTION_EDITORS` = `team@goalkeep.net, <Anagha's email>`; check `CENTRAL_ADMIN_FOLDER_ID` is the production Admin folder id.
4. Optional, by hand: delete the settings rows the code never reads (`WORKSPACE_FOLDER_PATTERN`, `ORGANISATION_ID_PATTERN`, `GRANT_ID_PATTERN`, `SHARING_METHOD`, `TECHNICAL_REGISTRY_SHEET`, `OUTCOME_PROGRESS_SCHEMA_VERSION`, `SUPPORT_CATEGORY_OPTIONS`, `SUPPORT_STATUS_OPTIONS`; `DATA_SYNC_SCHEMA_VERSION` only after sign-off). Also delete any `LIST_…`, `FIRST_FY` or `FY_YEARS_AHEAD` rows if you added them; nothing reads them any more. `TIME_ZONE` is only needed to override the default.
5. Run **`runPreflightChecks`** → expect **PASS**. Warnings are fine (settings the code does not read, which you can delete; email disabled). Any FAIL: stop and send me the text.
6. Run the **Backup** button once (`uiBackupCentralAdministration`) and confirm a copy appears in `Backups`.

## 5. Smoke test on production (use YOUR OWN email as the grantee email)
Set `SEND_WORKSPACE_NOTIFICATION` to `No` first if you do not want real emails; put it back afterwards.
1. Add three rows named `Zz Smoke …` — Restricted, Transactional, Discretionary — type *Create Workspace* in each Action cell, click **Create Workspace** once. Expected: `Workspace Created` / `Disbursement Only` / `Registry Only`, Setup Review `Awaiting Review` / `Not Applicable` / `Not Applicable`, the alert lists `Rows picked up`.
2. Click each refresh button (Outcome, Support, Decisions, Decision Documents) twice; the second run should be quick and say workbooks were skipped.
3. Add one Disbursed row for a real grant; **Push** first (rows with a blank Push Status are "Waiting for push" until then), then **Sync**; Push Status → `Pushed`; a second Push finds nothing to do.
4. On each existing Transactional row run **Retry Workspace** once (or use Retry/Reshare → same email): the Upload Folder cells become links to the Disbursement Documents folder. Then check Retry/Reshare → *Change the email* on a smoke grant with a second inbox of yours.
5. Mark the three smoke grants `Complete` so they drop out of active refreshes (rows are never deleted).

## 6. Owner clean-up
* Remove the **"Anyone with the link – Editor"** sharing on Central Administration (Share → General access → Restricted).
* Confirm each button is assigned to the function names in `docs/OPERATING_MODEL.md` §3 and that the two triggers exist (Extensions → Apps Script → Triggers).
* Tell Anagha: Push Status and Document Sync Status are filled by the script only.

## 7. Roll back (if anything looks wrong)
Code only (sheet data is untouched). The folder `../apfp-prod-live` from step 2 is an exact copy of the original production script:
```
cd ../apfp-prod-live
clasp push --force
cd ../apfp-grant-setup
```
That restores the original code (including its file names). Put the `DATA_SYNC_SCHEMA_VERSION` row back (Active = Yes) if you deleted it, or the original Lock & Migrate and preflight fail. Expected side effects of the older code on the new sheet state: its preflight reports the `Not Applicable` option, widened Tables and the extra columns; its Retry/Reshare treats *Disbursement Only* rows as Retry Workspace; its Push overwrites the Upload Folder links with plain text. Nothing is lost. Data: **File → Version history** of the sheet, or the backup copy from step 1. Sent emails and granted shares cannot be undone.
