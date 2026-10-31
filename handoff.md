# Phase 4 handoff — Team 19 / AccessAssist

Prepared for **Xiyue Chen**, **2026-11-01 (Asia/Shanghai)**. Q6 cross-team answers and coordination are excluded at your request.

## What is ready

- Publication branch: `phase4`, based on `495707b827e97fcc8c7af8a426aadc4418372174`; implementation version `0.4.0`. Deployment remains pending. The original local `phase4-completion` branch and its files are preserved. Per Xiyue's clarified request, only `docs/PHASE4_REPORT.pdf` and `docs/PHASE4_REPORT.docx` are excluded from publication; the two model PDFs and four PDF/DOCX examples are included. Examples can be regenerated with `npm run samples`.
- HTML DOM checks with A/AA filtering; real PDF and DOCX parsing/checks; structured findings with repair guidance; an explicit scoped no-violations message for all supported formats.
- Optional Groq remediation adapter, with deterministic default, bounded requests, validated responses, no uploaded content sent to Groq, and 503 on a required provider failure.
- Expanded contract/unit/integration/UI tests, runtime JSON Schema validation, CI artifacts, version verification, sample files and JSON report download.
- All requested report sections: `docs/PHASE4_REPORT.md` (Q1–Q5, Q7–Q9); current models and recorded local/live evidence.

## Questions that need real team/course/account information

| Priority | Question to resolve | Why it matters / exact action |
| --- | --- | --- |
| P0 | What is the complete current Pod F specification, including REQ/AC definitions, Sections 3.2, 5.1 and 6? | The supplied Phase 2 PDF contains Q1.1 and Q7–Q10, not the shared requirements/milestones. Mapping is reconstructed from the Phase 3 report and repository. Compare every reported status/test oracle against the actual shared text before submission. |
| P0 | Which bounded WCAG checks and formats did both teams actually agree on for Phase 4? | `docs/IMPLEMENTATION.md` records the implemented subset. Do not treat it as an agreed reduction in shared scope. Any reduction requires both teams and instructor sign-off under the rubric. |
| P0 | Does the course's “Project Phase #4” rubric intentionally retain Phase 3 wording in Q1.2/Q6.1 and “next Phase 4” in Q7.3? | The report explains the current Phase 4 increment and preserves the historical Phase 3 comparison; confirm the intended milestone references with course staff. |
| P0 | Who can review this branch and deploy to Cloud Run? | GitHub authentication and repository write access were verified for publication to `phase4`; GCP access remains unavailable. The last observed live revision was `accessassist-git-00008-f92`. Repository publication and local results are not evidence of a Phase 4 deployment. |
| P0 | Will Groq be enabled, and who owns the key, model, quota and cost approval? | Set `REMEDIATION_MODE=groq` only with a valid secret and successful live/provider quality review. The default works without a key. If runtime AI is mandatory, deterministic-only operation is still a partial delivery. Do not paste secrets into the report or source. |
| P0 | Who will update the class Endpoint_Registry and the shared team document? | Copy the system and tester URLs, release SHA and scope. Replace Q2.2's pending dates only after the edits are actually made. Registry access/location URL was not provided. |
| P0 | What is the final commit/tag and Cloud Run revision for submission? | Commit the reviewed code, deploy that exact SHA, verify `/about.commit`, rerun the full remote suite, and replace Q2.1/Q3.1/Q4.1/Q4.5 release fields together. |
| P1 | Are the Phase 3 optional fields `wcag_level`, `checks_run`, `no_violations_detected` accepted by the pod? Are severity/location decisions from Oct 25 recorded? | Existing `openapi.yaml` already permits these fields; do not claim pod agreement without its date/channel. We did not change the common schema. |
| P1 | Does the official tester interface require live per-session code coverage, a particular error classification, or additional operations? | Current system reports `coverage.code: null` with a reason. CLI coverage is aggregate backend coverage, not per-session deployed coverage. Tester schema is not part of the supplied `openapi.yaml`. |
| P1 | Do parser/complexity limits conform to the common input requirements? | Limits are documented; supported-size but complex files may return 503, and unsupported/encrypted package variants return 422. Verify that this matches agreed scope. |
| P1 | Who reviews remediation quality and signs the model/code review? | Use `docs/REMEDIATION_REVIEW.md`. Automated fixtures and provider mocks do not substitute for human review or a live Groq benchmark. No teammate review has been claimed. |
| P1 | What did Remley, Prisha and Athena actually do with GenAI in Phase 4? | Their Phase 4 records were not supplied. Do not reuse Phase 3 anecdotes. Each must supply tools/delegation, verification, one actual correction, and reflection on agentic principles. Xiyue's draft describes this session and still requires personal review. |
| P1 | Is `main` protected, and is the Cloud Build trigger gated on checks? | Phase 3 explicitly said failures did not block merge/deploy. Repository workflows do not prove remote branch settings. Enable required checks and inspect the trigger; the new `cloudbuild.yaml` gates its own deployment only if adopted. |
| P1 | What are current Cloud Run memory/concurrency/min/max-instance settings and billing restrictions? | New DOM parsing needs more memory than the Phase 3 regex code. The proposed config uses 2 GiB, at most one instance and concurrency four. Confirm cost/quota and performance on the actual service. Do not promise “free” or guaranteed uptime. |
| P1 | Can the release owner export new Cloud Logging evidence? | Capture one 200 request and one expected error on the new revision, showing timestamp, status, latency and SHA/revision. Q2.3 currently contains local logs and an explicitly labeled live Phase 3 reachability observation, not new deployed logs. |
| P2 | Do references need the legally incorporated 2018 WCAG text rather than the latest editorial revision? | The report references the regulation and WCAG 2.1; confirm course citation preferences. No legal compliance certification is claimed. |

## Known implementation limits and operational risks to carry into Phase 5

1. Detection covers a bounded subset. No complete WCAG/PDF-UA assessment, OCR, semantic alt-text judgment, PDF/DOCX visual contrast, external CSS, or automatic file repair. A browser extension, image/PPTX input and file modification remain outside this implementation; the Phase 2 sketch alone is not proof these are required milestones.
2. Groq code is tested using controlled responses; no real provider call or human semantic review occurred. The provider may change models, limits or output behavior. Keep the model configurable and rerun the benchmark before enabling it.
3. Test sessions/reports live in memory without durability or expiration. Restarts/scale-to-zero lose sessions, and multiple revisions/instances may split them. The proposed single-instance setting reduces splitting but does not make sessions durable.
4. Live per-session line coverage remains unavailable. The coverage report from CI/local testing must not be relabeled as coverage of a specific deployed session.
5. The public tester accepts arbitrary HTTP(S) targets, as in Phase 3. It does not yet restrict private/link-local targets, redirects, or public request rates. Restrict tester access/egress or add vetted target controls before treating it as a hardened public service. Do not give the service account unnecessary privileges.
6. The 10 MiB performance fixture contains one long comment. Its passing result does not prove performance on dense documents, concurrent load or cold starts. The worker/provider stage budgets do not include upload transfer time. Phase 5 must measure representative p95 latency and memory on Cloud Run.
7. HTML accessible-name computation and CSS contrast are bounded approximations. DOCX language/style resolution and PDF tag inspection are incomplete. Report manual-review boundaries prominently; do not convert every empty findings array into a full pass.
8. Production dependency audit passed after updating multer and the vulnerable body-parser dependency. A full development-dependency audit still reports moderate glob/minimatch findings. Do not use `npm audit fix --force` blindly because its proposed downgrades break tools; reassess patched compatible tooling separately.
9. Redocly validates the current OpenAPI with one advisory for the intentional localhost development server. ESLint has zero warnings. The schema itself does not encode every semantic AC, so passing schema validation alone is insufficient.
10. Common contract response fields are unchanged, but implementation behavior is stricter for corrupted files. The old “valid PDF” fixture was a header/trailer stub with zero pages; it has been replaced by a generated PDF with real page/image/tag objects. Confirm shared fixtures are valid documents before assigning mismatch ownership.

## Reproduce local verification

The host originally had Node 10. A verified Node 22 toolchain was placed at `/tmp/accessassist-tools/node/bin` for this session; it is temporary. Install/use Node 22.22.2+ on a persistent development machine (the current jsdom package requires a recent Node 22 release; this session uses 22.23.4).

```bash
export PATH=/tmp/accessassist-tools/node/bin:$PATH
npm ci
npm run lint
npm run lint:openapi
npm run audit
npm run test:coverage
npm run evidence
npm start
```

Open `http://localhost:8080`, try HTML/PDF/Word examples, inspect page/XML locations, and download JSON. Local T-13 skips because local HTTP has no TLS; remote T-16 skips because fault injection must not be enabled on public targets.

## Release and complete the remaining evidence

1. Review the `phase4` branch and report; obtain the outstanding scope/quality decisions. Open a PR and record its CI link. No release tag or deployment has been created by this session.
2. Confirm the GCP project (`phase-3-511821` in Phase 3), service, region, Artifact Registry repository, billing and service-account permissions. Review/adopt `cloudbuild.yaml`; either supply `_GIT_SHA` from the trigger's `$COMMIT_SHA`, or submit manually with the command below. The default `UNSET` SHA deliberately prevents an untraceable release.
3. Keep deterministic mode for a no-secret release unless the agreed milestone requires runtime AI. For Groq, provision the key in Secret Manager, grant only secret access to the runtime identity, bind `GROQ_API_KEY`, configure the model/mode, then run live-provider checks and the human rubric. Never add a key to Git.
4. After deployment, verify `/about` returns app version 0.4.0 and the expected commit. Run the same suite and collect evidence; unexpected revision mismatch must fail rather than test an older release.
5. Export Cloud Run logs, confirm the final CI URL, update the registry/team docs, and replace every `PENDING` field in the report. Keep the old Phase 3 result as historical evidence, not the Phase 4 result.
6. Obtain each teammate's actual Q8 record. Re-export the report. Cross-team execution and Q6 remain your team's separate work.

```bash
# Run only after the code is committed/reviewed and the account/configuration is confirmed.
gcloud builds submit --project=phase-3-511821 --config=cloudbuild.yaml \
  --substitutions="_GIT_SHA=$(git rev-parse HEAD)"

BASE_URL=https://accessassist-git-365255122806.europe-west1.run.app/system \
EXPECTED_SHA="$(git rev-parse HEAD)" EVIDENCE_DIR=docs/evidence/phase4-live npm run evidence

BASE_URL=https://accessassist-git-365255122806.europe-west1.run.app/system npm run test:remote
```

If the existing automatic trigger is retained, confirm it passes the same SHA into Docker's `GIT_SHA` build argument and runs validation before deployment. Its current configuration cannot be inferred from repository YAML alone.

## Report fields that are deliberately not fabricated

- Cover page / Q2.1 / Q4.5: Phase 4 release SHA, tag, revision and deployed result.
- Q2.2: actual registry/shared-document edit dates and links.
- Q2.3: Phase 4 Cloud Logging excerpt and observed operating limits/costs.
- Q3.2: pod agreement date/channel and full shared specification.
- Q4.3/Q4.4: a CI run URL for the new code and verified merge/deployment enforcement.
- Q4.2/Q8: human remediation review and teammates' actual personal records.

The report already answers every requested question using available evidence and labels these gaps. They cannot truthfully become completed facts until the corresponding external actions happen.
