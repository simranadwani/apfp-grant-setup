# APFP Grant Setup

Google Apps Script automation for the APFP grant workspace (Central Administration sheet).

* `docs/OPERATING_MODEL.md` — how it works, buttons, settings, how to change things without code
* `docs/PRODUCTION_ROLLOUT.md` — exact backup / push / verify / rollback steps
* `docs/PROJECT_NOTES.md` — decisions, environments and status (read first when resuming)
* `CHANGELOG.md` — every change: what, which files, why

Local checks: `npm test` (Node 20+, no dependencies). Push to the TEST script with `clasp push`; production only by following `docs/PRODUCTION_ROLLOUT.md` (it pushes from a small `../apfp-prod-push` folder, because newer `clasp` rejects `-P`).
