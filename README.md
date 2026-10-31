# AccessAssist — Team 19, Pod F

AccessAssist accepts HTML, PDF and DOCX course documents and reports selected WCAG 2.1 findings with locations and repair instructions. It supports accessibility review; it does not certify ADA, WCAG or PDF/UA compliance.

**Phase 4 implementation: 0.4.0.** The `phase4` branch contains real document checks, optional Groq remediation, contract validation and a report UI. **The existing public service was still running Phase 3 when checked on November 1, 2026; deployment of this version remains pending.** See [handoff.md](handoff.md) for release tasks and missing team/account information.

## Delivered source and report

- Phase 4 report answers are retained locally and excluded from this branch.
- [Implemented rule scope, data flow and limitations](docs/IMPLEMENTATION.md)
- [Updated system models](docs/MODELS.md)
- [Human remediation review procedure](docs/REMEDIATION_REVIEW.md)
- [Local evidence](docs/evidence/local/summary.md) and [existing Phase 3 live baseline](docs/evidence/phase3-live/summary.md)

## Run locally

Use Node 22.22.2+ (the Node 22 line is used in CI/Docker). The session toolchain, if still present, is `/tmp/accessassist-tools/node/bin`.

```bash
npm ci
npm start
npm test
npm run test:coverage
npm run evidence
```

Open `http://localhost:8080`. The page includes HTML/PDF/Word examples, WCAG A/AA selection, page/line/XML locations and JSON report export. Example documents and PDF/SVG/PNG models are included in Git; `npm run samples` regenerates the examples manually. The Phase 4 report files (`docs/PHASE4_REPORT.md`, `.pdf` and `.docx`) remain local and are excluded from this branch.

## API

| Part | Base path | Operations |
| --- | --- | --- |
| System | `/system` | `GET /health`, `GET /formats`, `POST /analyze`, `POST /test/setup`, `GET /test/report` |
| Tester | `/tester` | `POST /test/setup`, `POST /test/run`, `GET /test/report` |
| Release identity | `/about` | App version, commit if configured, Cloud Run revision, remediation mode |

The common [OpenAPI contract](openapi.yaml) is unchanged at version 0.3.0; the implementation version is separate. `POST /system/analyze` accepts multipart `file` and optional `wcag_level` (`A` or `AA`, default `AA`). The inclusive file limit is 10 MiB (10,485,760 bytes).

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `MISSING_FILE`, `INVALID_WCAG_LEVEL` | Missing/invalid request |
| 413 | `FILE_TOO_LARGE` | File exceeds the inclusive limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported declared type/extension |
| 422 | `UNPROCESSABLE_FILE` | Empty, corrupt, encrypted or unsupported document package |
| 503 | `PROCESSING_UNAVAILABLE` | Required processing/provider/capacity failed; no partial report |

Errors use top-level `code` and `message`. The course test interface uses its existing `message`/`source` error shape. Every success includes findings, the criteria attempted and a scope message. An empty findings array is only a clean result for those supported checks.

## What is checked

- HTML: image alternatives, form labels, custom heading levels, document title/language, unnamed controls and static solid-color contrast at AA. No uploaded scripts run and no remote resources are fetched.
- PDF: actual PDF parsing, title/language metadata, structure-tree presence and text alternatives on tagged Figure elements, with page locations when available.
- DOCX: actual ZIP/XML parsing, DrawingML picture alternatives/decorative flags, empty explicitly marked table headers and inspected language declarations.

See [the scope table](docs/IMPLEMENTATION.md) for exact boundaries. OCR, complete semantic accessibility, external CSS, PDF/DOCX visual contrast and automatic file repair are not implemented. Shared scope confirmation remains a team task; these limits are not presented as a pod-approved scope reduction.

## Remediation configuration

The default `REMEDIATION_MODE=deterministic` uses concrete rule-authored instructions and needs no external key. To use the implemented Groq adapter, configure `REMEDIATION_MODE=groq`, `GROQ_API_KEY` and optionally `GROQ_MODEL` (default `llama-3.3-70b-versatile`) in server-side environment/secrets. Never commit an API key.

The adapter sends only generic criterion/fix templates, not file bytes, filenames, snippets or document text. It preserves deterministic findings and appends labeled AI wording only after validating a complete response. Missing credentials, timeout, 429/5xx or invalid output yield 503. Real Groq operation and human quality review are still pending.

## Tests and evidence

`src/cases.js` contains T-01–T-30 and drives both CLI and deployed tester. The suite validates responses against the actual checked-in OpenAPI schemas with Ajv. Additional H/P/D/G/O/U tests exercise contrast oracles, HTML/PDF/DOCX parsing, provider mocks, cleanup/logging, protocol behavior and UI rendering. Backend coverage includes all `src/**/*.js`; it is aggregate test-process coverage, not deployed per-session coverage.

```bash
BASE_URL=https://<host>/system npm run test:remote
BASE_URL=https://<host>/system EXPECTED_SHA=<released-sha> npm run evidence
```

`npm run evidence` starts a local server when BASE_URL is absent and writes timestamped JSON, request logs and a Markdown summary under `docs/evidence/local/`. With a remote target it writes under `docs/evidence/remote/` (override with EVIDENCE_DIR). It fails on a wrong expected commit, failed/error tests or invalid operation responses. Eight additional protocol probes cover setup/report success and errors. T-13 skips on local HTTP; T-16 skips remotely because it requires local fault injection.

## Deployment and CI

The existing target is Google Cloud Run, project `phase-3-511821`, region `europe-west1`, service `accessassist-git`:

- System: https://accessassist-git-365255122806.europe-west1.run.app/system
- Tester: https://accessassist-git-365255122806.europe-west1.run.app/tester

CI runs ESLint, Redocly, production dependency auditing, the full test suite and evidence collection. The new [cloudbuild.yaml](cloudbuild.yaml) validates before deployment and embeds the supplied SHA. It is a proposed replacement/configuration for the existing trigger; adoption and permissions have not been confirmed. The live workflow now requires the served commit to match the triggering SHA. Branch protection must be verified in GitHub settings; repository files alone do not prove a failing check blocks merge.

The proposed service configuration is 2 GiB memory, one maximum instance, zero minimum instances and four concurrent HTTP requests. At most two analyses run per Node process, each with a 15-second parser budget and 512 MiB worker heap; Groq has an 8-second timeout. Cold starts, upload time and realistic production load require separate measurement. See [handoff.md](handoff.md) for release commands, registry updates and final evidence capture.

## Data and known operational limitations

Documents are processed in memory, worker threads are terminated after analysis, and original request buffers are overwritten/released on completion. No uploaded document or report history is stored in a database. Test sessions/reports stay in memory and are lost on restart; live per-session code coverage is reported as null with a reason. Structured logs contain request metadata and release identity, never upload contents or secrets.

The public tester's arbitrary-target behavior and lack of rate control require access/egress hardening. Representative deployed p95 latency, provider quality and full retention review remain unfinished. Production dependency audit is clean in this session; development-tool audit advisories and the localhost OpenAPI advisory are documented in handoff.md.
