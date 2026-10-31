# Phase 4 implementation and supported checks

Implementation version: **0.4.0**. The checked-in common contract remains **0.3.0**; no pod agreement is asserted by this implementation.

## Request flow

`app.js` logs request metadata and mounts the system, tester, and upload page. `system.js` enforces the inclusive 10 MiB file limit, validates settings/type/readability, and calls `analyzer.js`. Each analysis runs in a new worker with a 15-second parsing budget and 512 MiB old-generation heap limit. At most two analyses are active in one Node process. A worker is terminated after completion; the original upload buffer is overwritten and released on both successful and failed request paths.

The worker chooses `checks/html.js`, `checks/pdf.js`, or `checks/docx.js`. Each detector produces a fixed WCAG mapping and an actionable deterministic repair instruction. `remediation.js` optionally appends validated Groq wording; the original criterion, location, severity, description, and deterministic instruction remain unchanged. If required processing fails, the endpoint returns 503 with no issues array. Unreadable documents return 422.

## Implemented scope

These are bounded checks within WCAG criteria, not full implementations of every criterion. Passing all of them is not a certification of WCAG, ADA, or PDF/UA compliance.

| Format | Criterion | Implemented check | Important boundary |
| --- | --- | --- | --- |
| HTML | 1.1.1 | Missing image/functional image text alternative; role=img names | Does not judge whether an existing description is meaningful; decorative alt="" is allowed |
| HTML | 1.3.1 | Missing associated form labels; missing/invalid level on custom ARIA headings | Does not infer visual heading structure or automatically flag every skipped heading level |
| HTML | 2.4.2 | Empty/missing document title | Does not judge title quality |
| HTML | 3.1.1 | Missing/invalid default language tag | Does not infer the language of the text |
| HTML | 4.1.2 | Unnamed buttons and links | A bounded accessible-name approximation, not a complete browser accessibility-tree implementation |
| HTML, AA only | 1.4.3 | Static solid foreground/background contrast, including embedded style rules and inheritance | No external CSS, scripts, gradients, background images, opacity effects, or unsupported computed font units; default background is white |
| PDF | 1.1.1 | Tagged Figure elements without Alt or ActualText, with page when available | Untagged images, image quality, OCR and complete structure-tree validation are not covered |
| PDF | 1.3.1 | Missing/unusable structure-tree entry | Does not prove tag correctness or reading order |
| PDF | 2.4.2 | Missing title metadata | Does not judge descriptive quality |
| PDF | 3.1.1 | Missing/invalid catalog Lang | Does not verify per-span language |
| DOCX | 1.1.1 | DrawingML pictures without descriptions or a decorative flag | Main document part only; no VML pictures, headers/footers or image semantics |
| DOCX | 1.3.1 | Empty explicitly marked table header rows | Layout tables are not assumed to be data tables; missing header associations require manual review |
| DOCX | 3.1.1 | No language declaration in inspected defaults/content | Does not resolve all style inheritance or verify every language span |

PDF and DOCX do not perform visual contrast analysis. They report the criteria actually attempted in `checks_run`, and the `message` explains the format-specific limits. Level A omits HTML contrast; Level AA includes the Level A checks plus supported AA checks.

## Parsers and limits

- HTML uses [jsdom](https://github.com/jsdom/jsdom) with no script execution or external resource loading. DOM source locations supply line numbers and snippets. UTF-8 HTML is the supported text encoding.
- PDF uses [pdf-lib](https://pdf-lib.js.org/docs/api/classes/pdfdocument). The service rejects encrypted/unreadable PDFs and PDFs with no readable pages. PDF inspection is limited to 500 pages.
- DOCX uses [yauzl](https://github.com/thejoshwolfe/yauzl) for lazy in-memory ZIP reads and [xmldom](https://github.com/xmldom/xmldom) for XML parsing. Only content types, the main document and styles are read. DTD/entity declarations, malformed XML, duplicate required parts, and more than 20 MiB of expanded required XML are rejected. Transitional OOXML is supported; Strict OOXML and password-encrypted Office files are not.
- The analysis budget is 50,000 HTML elements, 50,000 PDF structure visits, 50,000 Word paragraphs, 1,000 Word drawings and 1,000 findings where enforced. Resource/time/capacity exhaustion returns 503 rather than a truncated success report. These limits must be reviewed with the pod before claiming unrestricted support for every file below 10 MiB.
- The 15-second worker deadline and 8-second provider timeout bound processing stages. Upload transfer time, cold starts and production load have not been certified below 30 seconds.

## Remediation modes

`REMEDIATION_MODE=deterministic` is the default. It needs no secret and produces specific rule-authored instructions. `REMEDIATION_MODE=groq` requires `GROQ_API_KEY`; `GROQ_MODEL` defaults to `llama-3.3-70b-versatile` and should be checked before release.

Groq receives only generic criterion/fix templates, deduplicated by criterion and instruction. It receives no file bytes, document text, filename, snippet, or location. Responses must be valid JSON with exactly one bounded suggestion per template ID. Invalid, incomplete, rate-limited or timed-out responses cause 503; the service does not silently switch modes after a failure. AI wording is appended and labeled for review. Schema checks cannot prove semantic correctness, so the quality rubric in `docs/REMEDIATION_REVIEW.md` remains a human gate.

## Contract and evidence

The `openapi.yaml` schemas are used by Ajv to validate runtime test responses. The core contract suite is shared by CLI and the deployed tester. Separate tests exercise parsers, Groq adapter mocks, cleanup/logging, protocol behavior and the browser result renderer. `npm run evidence` records test IDs, AC tags, operation probes, timestamps, version metadata and a source fingerprint. The report's system-model coverage is AC reachability, not proof of every model transition or complete semantic coverage.

## Data and operation

Uploaded files are not persisted. Parser workers are short lived and original request buffers are zeroed. Test sessions/reports remain in process memory until restart; no database is used. Request logs contain timestamp, method, path, status, error code, latency, version/revision/commit and no upload body. `/about` and `X-App-Version` expose release identity; a deployment must set `GIT_SHA` to make commit verification possible.

Cloud Run remains the deployment target. The supplied `cloudbuild.yaml` is a proposed release configuration with tests before build/deploy, 2 GiB memory, one maximum instance and zero minimum instances. Its adoption, billing impact, Artifact Registry repository and service-account permissions are not confirmed. The existing host was still serving Phase 3 when probed; see `docs/evidence/phase3-live/`.
