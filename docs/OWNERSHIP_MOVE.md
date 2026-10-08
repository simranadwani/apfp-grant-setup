# Ownership move: everything owned by Anagha (apfp.rda@gmail.com)

Goal: Admin sheet + bound script, templates, email doc, folders and all grant workspaces owned by **apfp.rda@gmail.com**; team@goalkeep.net has **no access** at the end.
Facts: Drive "Transfer ownership" from team@goalkeep.net does not work (tested), so Anagha makes **copies while signed in as herself** (a copy is owned by its maker). The code has no file IDs, so no code change is needed. Old environment stays untouched until sign-off (rollback).

Current state (audited): production Admin sheet and root folder are owned by team@goalkeep.net; apfp.rda@, simran@goalkeep.net, bhumika@goalkeep.net and simranadwaniii@gmail.com are Editors. The old Admin sheet also has "Anyone with the link: Editor" (remove it).

## Rules
- **Anagha herself clicks** Create Workspace, Retry Workspace and Retry/Reshare: files a script creates belong to the account that clicks. Staff and Simran only fill rows and set Actions.
- Never delete whole rows in System - Configuration (the catalogue lives in J:L). Edit cells only.
- Do not re-add team@goalkeep.net anywhere (shares, `PROTECTION_EDITORS`).

## Phase 0: rehearse on TEST
- [ ] Anagha opens the TEST Admin sheet and does File > Make a copy into her own Drive, then repeats Phases 2 to 4 with TEST templates and a test root folder. Confirm Owner = apfp.rda@ on the copy, preflight PASS, one Create Workspace (Zz Test Org) owned by her.

## Phase 1: prepare (team@goalkeep.net)
- [ ] Stop all workspace activity. Make a dated backup copy of the old Admin sheet.
- [ ] Note the old script ID (`.clasp.prod.json`) and the six config IDs (rollback).
- [ ] Make sure apfp.rda@ can open the Templates folder (4 templates + email Google Doc) and the root `Grant Setups` folder.

## Phase 2: skeleton (Anagha, in her Drive)
- [ ] Create `APFP / Admin / Templates` and `APFP / Grant Setups`.
- [ ] Note the folder IDs: `Admin` (CENTRAL_ADMIN_FOLDER_ID), `Grant Setups` (ROOT_FOLDER_ID).

## Phase 3: templates (Anagha)
- [ ] File > Make a copy of the Setup, Outcome Progress and Disbursement Document templates and the workspace email Google Doc into `Admin/Templates`. Remove "Copy of" from names. Note the 4 new IDs.
- [ ] Open each copy: hidden `System - ...` sheets, Field Config and protections are present.

## Phase 4: Admin sheet + script (Anagha)
- [ ] Old Admin sheet > File > Make a copy into `Admin`, named `APFP Central Administration`. Check its sharing is private.
- [ ] In System - Configuration set: ROOT_FOLDER_ID, CENTRAL_ADMIN_FOLDER_ID, SETUP_TEMPLATE_ID, OUTCOME_PROGRESS_TEMPLATE_ID, DISBURSEMENT_DOCUMENT_TEMPLATE_ID, WORKSPACE_EMAIL_TEMPLATE_DOC_ID. Set PROTECTION_EDITORS to apfp.rda@ plus the staff accounts that must edit protected cells. Keep SEND_WORKSPACE_NOTIFICATION = No until tested.
- [ ] Share the new sheet (Editor) with simranadwaniii@gmail.com and the Goalkeep staff accounts.
- [ ] Extensions > Apps Script > Project Settings: copy the new Script ID into `.clasp.prod.json` (keep the old file as `.clasp.prod.old.json`).
- [ ] Simran pushes the newest code with the standard sequence in PRODUCTION_ROLLOUT.md step 3 (new script ID).
- [ ] Anagha runs `runPreflightChecks` in the editor and clicks **Allow**. Expect the current Code version line and PASS.
- [ ] Anagha creates the triggers: `handleCentralAdminOpen` (spreadsheet, On open) and `handleCentralAdminEdit` (spreadsheet, On edit).
- [ ] Check every button drawing and that the Action dropdown has `Correct Workspace`.
- [ ] team@goalkeep.net deletes its own triggers on the old sheet, renames it `ARCHIVE - do not use`, sets it to view only and removes "Anyone with the link".

## Phase 5: the 5 existing grant workspaces
- [ ] In the new hidden `System - Technical Registry`, per Request ID clear the URL block (folder/workbook URLs, archive and shortcut URLs, notification status/sent/recipient) and set Action = `Retry Workspace`.
- [ ] Optional, to keep grantee entries: Anagha copies each old workbook into the new organisation folder using the exact generated name; the engine adopts it instead of copying a template.
- [ ] Anagha clicks **Create Workspace**. New folders/workbooks are created under the new root and shared with the grantee email.
- [ ] Tell grantees the new links, then remove their access to the old tree.

## Phase 6: prove it and remove team@
- [ ] Owner = apfp.rda@ on: Admin sheet, Admin and Templates folders, 4 templates + email doc, root folder, every FY/org folder, every workbook.
- [ ] team@goalkeep.net is in no Share dialog, no `PROTECTION_EDITORS`, no protection (run Retry/Reshare, same email, per workspace to re-harden).
- [ ] Smoke tests (PRODUCTION_ROLLOUT.md step 5) as Anagha. Then set SEND_WORKSPACE_NOTIFICATION = Yes if wanted.
- [ ] Sign-off: team@ deletes the old tree and the archive sheet when everyone is happy.

## Notes
- Welcome emails now come from Anagha's address (consumer accounts allow about 100 recipients per day).
- Rollback: the old sheet, script, templates and workspaces are untouched; re-enable team@'s triggers and point grantees back.
