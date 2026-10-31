# Phase 4 publication verification

Prepared: 2026-11-01T06:17:55.688511+08:00 (Asia/Shanghai).

- Target branch: `phase4`.
- The original local commit `d9f05f6` and its files are preserved on `phase4-completion`. Publication was reconstructed from its parent to keep the excluded report exports out of the new GitHub history.
- The user's clarified exclusion is exactly `docs/PHASE4_REPORT.pdf` and `docs/PHASE4_REPORT.docx`. Both paths are ignored and remain local. The two model PDFs and four sample PDF/DOCX documents are included.
- Example documents are served directly from the committed files, with `npm run samples` available for regeneration. The temporary startup/build regeneration added for the initial broad exclusion was removed after clarification.
- Final contract evidence rerun: **30 cases, 29 passed, 0 failed, 1 skipped** (local HTTPS); all **8 protocol probes** schema-valid. See `../local/results.json`.
- Final publication source fingerprint: `d66e1eef41a914cb83417db8f687deddb0268808e2702529951490bb973f83ba`. The earlier full-suite/coverage outputs remain historical verification of the unchanged analyzer and test source, with their original fingerprint in `summary.json`.
- GitHub publication is separate from Cloud Run deployment. No deployment or real Groq verification is claimed.
