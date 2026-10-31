# Phase 4 publication verification

Prepared: 2026-11-01T06:16:52.925305+08:00 (Asia/Shanghai).

- Target branch: `phase4`.
- The original local commit `d9f05f6` and its PDF/DOCX files are preserved on `phase4-completion`. Publication is reconstructed from its parent so excluded files are absent from all new commits sent to GitHub.
- `.gitignore` excludes PDF and DOCX files. Generated report exports and example documents are not tracked.
- `npm start` and the Docker build generate example documents from JavaScript fixtures. All four generated sample URLs returned HTTP 200 with non-empty document bytes in the publication checkout.
- Contract evidence rerun: **30 cases, 29 passed, 0 failed, 1 skipped** (local HTTPS); all **8 protocol probes** schema-valid. See `../local/results.json`.
- Publication source fingerprint: `e047fb4f61a30980e85ceab46ffa3f63e07f820aed4cfb0a4f2b92da59168d78`. The earlier full-suite/coverage outputs remain historical verification of the unchanged analyzer and test source; their original fingerprint is retained in `summary.json`.
- GitHub publication is separate from Cloud Run deployment. No deployment or real Groq verification is claimed.
