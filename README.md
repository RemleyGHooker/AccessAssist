# AccessAssist (ECE 30861, Team 19, Pod F)

AccessAssist checks course documents against the ADA Title II web rule, which requires public universities' online content and documents to meet WCAG 2.1 Level AA (28 CFR §35.200). Professors upload a file and get back each accessibility problem, the WCAG rule it breaks, and how to fix it.

**Phase 5 status:** reliability hardening (REQ-09, REQ-10, REQ-12) on top of the Phase 4 evaluation engine (REQ-04 to REQ-08) and the Phase 3 intake layer (REQ-01, 02, 03, 11, 13). HTML, PDF and Word files are checked against a bounded set of eight WCAG 2.1 criteria; every issue names its criterion, location, severity and a fix, and a clean file gets an explicit no-violations message. New in Phase 5:

- **Failures never leak partial results (REQ-09).** Any failure during evaluation, including a rule crashing after other rules already found issues, answers `503 PROCESSING_UNAVAILABLE` with no issues and logs the stack trace. A guarded fault-injection switch makes this testable on the deployed service (T-16, T-29), not only in CI.
- **Every file of 10 MB or less is answered, fast (REQ-12, LIM-04).** A streaming pre-scan refuses HTML pages over 150,000 elements or nested over 1,000 levels with `422` and the reason, instead of exhausting memory (a 10 MB page of 1.3 million elements needed ~1.9 GB) or overflowing the stack (a 200 KB page nested 20,000 deep crashed). It is answered in under a second.
- **No retention (REQ-10).** Every system response carries `Cache-Control: no-store`; uploads stay in memory for one request, and a test checks that no temporary files appear.
- **Safer tester (LIM-07).** `target_url` must resolve to public addresses only; credentials, queries and redirects to other hosts are refused.
- **Model coverage.** When our tester tests our own system, its report adds `coverage.model`: how many of the 16 Team 19 design requirements in [`docs/design-requirements.md`](docs/design-requirements.md) the suite evaluated. Cross-team reports omit it.

Optional Groq rewording of fixes is built in and off until a key is configured.

## What is checked

Detection and the WCAG mapping are deterministic rules ([`src/checks/`](src/checks)); the criterion list lives in [`src/criteria.js`](src/criteria.js). `wcag_level=A` runs only the Level A rows; `AA` (default) runs all of them. `checks_run` in every result lists exactly which criteria ran.

| WCAG 2.1 | Level | HTML | PDF | Word (.docx) |
| --- | --- | --- | --- | --- |
| 1.1.1 Non-text Content | A | `img` without alt (or a file name / generic word as alt), image buttons, image-map areas, `svg role="img"` | Figure tags without `/Alt`; images in an untagged PDF | Pictures, charts, SmartArt without alt text (decorative ones skipped) |
| 1.3.1 Info and Relationships | A | Skipped heading levels; data tables with no header cells | Untagged PDF; tables with no `TH` | Skipped heading levels; bold/large text used instead of Heading styles; tables with no header row |
| 1.4.3 Contrast (Minimum) | AA | Text below 4.5:1 (3:1 for large text), from inline styles and `<style>` rules | — | Font colors below 4.5:1 against page, shading or highlight |
| 1.4.5 Images of Text | AA | — | Pages with images but no real text (scans) | — |
| 2.4.2 Page Titled | A | Missing or empty `<title>` | No title, or title not shown (`DisplayDocTitle`) | No Title property |
| 2.4.4 Link Purpose | A | Links with no text, or "click here"-style text | — | Same as HTML |
| 3.1.1 Language of Page | A | Missing or invalid `lang` | Missing or invalid `/Lang` | No default proofing language |
| 4.1.2 Name, Role, Value | A | Unlabeled form fields, unnamed buttons, untitled iframes | Form fields with no tooltip (`/TU`) | — |

Colors the checker cannot know for sure (CSS variables, transparency, background images) are skipped, not guessed. Locations are `{selector, line, snippet}` for HTML, `{page, snippet}` for PDF, and `{snippet}` naming the paragraph for Word.

**AI-written fixes (optional).** If `GROQ_API_KEY` is set (Cloud Run: mount it from Secret Manager), each issue's `suggested_fix` is reworded by Groq (`GROQ_MODEL`, default `llama-3.1-8b-instant`, temperature 0, 8 s timeout). Only the criterion, the rule's description and fix, and the short location snippet are sent, never the file. Groq cannot add, remove or re-map issues; if it fails or answers badly, the rule-written fix is kept, so the evaluation is still complete.

## Try it

Open https://accessassist-git-365255122806.europe-west1.run.app in a browser, upload an HTML, PDF or Word file (or click a sample), and see each problem with its WCAG rule and a fix.

## Endpoints

One Cloud Run service hosts both parts, on different paths:

| Part | Base path | Endpoints |
| --- | --- | --- |
| System (pod common interface) | `/system` | `GET /health`, `GET /formats`, `POST /analyze`, `POST /test/setup`, `GET /test/report` |
| Tester (course testing interface) | `/tester` | `POST /test/setup`, `POST /test/run`, `GET /test/report` |

The full contract is in [`openapi.yaml`](openapi.yaml); the tester is described in [`tester-openapi.yaml`](tester-openapi.yaml). Errors always look like `{"code": "...", "message": "..."}`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `MISSING_FILE` / `INVALID_WCAG_LEVEL` | No file attached, or `wcag_level` not `A`/`AA` |
| 413 | `FILE_TOO_LARGE` | Over 10 MB (exactly 10 MB is accepted) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Not HTML, PDF or DOCX |
| 422 | `UNPROCESSABLE_FILE` | Empty, cut off, not really the type it claims, fails to parse during analysis, or an HTML page over 150,000 elements / 1,000 levels of nesting (the message gives the reason) |
| 503 | `PROCESSING_UNAVAILABLE` | A required service failed, or evaluation failed partway; no issues are returned; safe to retry |

Every system response carries `Cache-Control: no-store`.

**Test fault injection (Team 19 extension, not in the pod contract).** A request to `/analyze` that names a live test session in `X-Test-Session` (created through `POST /test/setup`) may add `X-Test-Fault: dependency-unavailable` or `X-Test-Fault: evaluation-crash` to get a simulated failure for that one request. Without a live session the headers are ignored, an unknown fault for a live session gets `400 INVALID_TEST_FAULT`, and `FAULT_INJECTION=off` turns the feature off. Injected requests are logged with `fault_injected`.

**Accepted types:** `text/html`, `application/pdf`, and Word `.docx`. The type comes from the declared MIME type, or the file extension when the type is generic. A file that claims a supported type but whose contents don't match gets 422, not 415.

## Running it

```bash
npm ci
npm start                 # http://localhost:8080/system and /tester
npm test                  # full suite against a fresh local server
BASE_URL=https://<service>.run.app/system npm run test:remote   # same suite against a live system
OWN_SYSTEM=true BASE_URL=https://accessassist-git-365255122806.europe-west1.run.app/system npm run test:remote   # ours, incl. Team 19 design checks
npm run design:doc        # regenerate docs/design-requirements.md after editing src/design.js
```

The npm scripts work the same in bash, PowerShell and cmd. In PowerShell, set the live address with `$env:BASE_URL = "https://<service>.run.app/system"; npm run test:remote`.

Test another team from our deployed tester:

```bash
curl -X POST https://<our-service>.run.app/tester/test/setup \
  -H 'content-type: application/json' -d '{"target_url":"https://<their-service>/system"}'
curl -X POST https://<our-service>.run.app/tester/test/run \
  -H 'content-type: application/json' -d '{"session_id":"<id from setup>"}'
```

## Tests

One suite, [`src/cases.js`](src/cases.js), drives both CI (`npm test`) and the deployed tester, so they can't drift apart. Expected answers come from the pod contract, not from our own output.

| Test | Checks | Pod criterion |
| --- | --- | --- |
| T-01, T-02 | Valid HTML and PDF accepted | AC-01 |
| T-03 | `/formats` lists types and a limit of 10 MB or more | AC-02 |
| T-04 | `.exe` rejected with 415 | AC-02 |
| T-05 | Missing alt text reported under 1.1.1 | AC-04, AC-05, AC-06, AC-07 |
| T-06, T-07 | Empty file and cut-off PDF rejected with 422 | AC-03 |
| T-08, T-09 | Missing file and `wcag_level=AAA` rejected with 400 | AC-13 |
| T-10, T-11 | 10 MB + 1 byte rejected (413); exactly 10 MB accepted within 30 s | AC-02, AC-12 |
| T-12 | Health check | AC-13 |
| T-13 | Plain HTTP refused or redirected to HTTPS | AC-11 |
| T-14 | Every error has `code` + `message`, never `issues` | AC-13 |
| T-15 | Clean file gets an explicit no-violations message | AC-08, AC-13 |
| T-16 | Simulated dependency outage returns 503, never partial results (own system) | AC-09 |
| T-17 | Low-contrast HTML text reported under 1.4.3 (and nothing else) | AC-04, AC-05 |
| T-18 | Skipped HTML heading level reported under 1.3.1 | AC-04, AC-05 |
| T-19 | HTML with no language and no title reported under 3.1.1 and 2.4.2 | AC-04, AC-05 |
| T-20 | Word image with no alt text reported under 1.1.1 | AC-04 to AC-07 |
| T-21 | Accessible Word file gets the no-violations message | AC-08 |
| T-22 | Untagged PDF reported under 1.3.1 | AC-04, AC-05 |
| T-23 | Tagged PDF figure with no alt reported under 1.1.1, on page 1 | AC-04, AC-05, AC-07 |
| T-24 | Accessible tagged PDF gets the no-violations message | AC-08 |
| T-25 | Corrupt Word file rejected with 422, never evaluated | AC-03 |
| T-26 | `wcag_level=A` leaves out Level AA criteria (1.4.3) | AC-04, AC-13 |
| T-27 | Every issue in a five-problem page has a location and a fix | AC-06, AC-07 |
| T-28 | Accessible page with tables, forms and links has no false positives | AC-04, AC-08 |
| T-29 | Rule crash after issues were found returns 503 with no partial issues (own system) | AC-09 |
| T-30 | 10 MB page of 1.3 million elements answered within 30 s (result or 422), never a crash | AC-12, AC-03 |
| T-31 | HTML nested 20,000 levels deep answered (result or 422), never a crash | AC-03, AC-13 |
| T-32 | Results and errors carry `Cache-Control: no-store` (own system) | AC-10 |
| T-33 | System `/test/report` returns well-formed code coverage for the tester's session | test interface |
| T-34 | `checks_run` lists exactly the HTML criteria run at A and AA; every issue is under one of them (own system) | AC-04, AC-05 |

Tests marked *own system* check a Team 19 design requirement through a Team 19 extension (fault injection, `checks_run`, `no-store`). They run whenever the target is our own system (locally, in CI, on the deployed service) and are skipped, never failed, for other teams' systems.

Fixtures that should produce specific criteria are checked for *exactly* those criteria, so both missed violations and false positives fail. [`test/analyzer.test.js`](test/analyzer.test.js) adds unit tests for each rule (contrast math, decorative images, RoleMap figures, Word highlights, Groq fallback, and so on). The fix wording itself (AC-06 quality) still needs human review against the pod rubric.

**Coverage in the tester's report.**

| Field | Counts | When |
| --- | --- | --- |
| `code` | Copied from the target's `GET /test/report` (checked for well-formed counts) | Always |
| `component` | Pod components (`health`, `formats`, `validation`, `analyze`, `test-interface`) exercised by an executed test | Always |
| `system` | Pod acceptance criteria AC-01 to AC-13 evaluated by an executed test | Always |
| `model` | Team 19 design requirements DR-01 to DR-16 evaluated by an executed test; `basis` names the design version and links the [mapping](docs/design-requirements.md) | Only when the target is our own system |

"Our own system" means the target is the deployed Team 19 system, any address in `OWN_SYSTEM_URLS`, or `/system` on the same origin that reached the tester. DR-11 (Groq fallback) is covered only by CI unit tests because Groq is off in deployment, so a full own-system run reports 15/16. `src/design.js` is the single source; `test/design.test.js` fails if the generated doc is stale or a requirement names a test that doesn't exist.

**Live code coverage.** `GET /system/test/report` counts executable lines of the system's project code (not the test interface or the tester) run by project requests since that session's `POST /system/test/setup`. Reading the report doesn't change it, later requests can raise it, and a new session starts from zero. Sessions that overlap in time see each other's requests, because V8 counts per process. It is off when c8 is measuring (CI) or when `LIVE_COVERAGE=off`.

**Tester error handling.** A target that answers HTTP 5xx where the contract defines no such answer is recorded as `error` with source `system` (not `fail`), and malformed JSON sent to the tester is labeled source `tester`. System setup must answer 201 with the same `session_id`; its errors are forwarded with the same status, message and source. If the tester aborts, the test in progress is recorded as `error` from source `tester` and the rest as `skip`.

**Tester targets (LIM-07).** `target_url` must be an http(s) base URL with no credentials, query or fragment, and its host must resolve only to public addresses; loopback, private, link-local (including the cloud metadata server) and other internal ranges are refused with 400. Redirects are never followed. `ALLOW_PRIVATE_TARGETS=true` lifts the address rule for local development, and `ALLOWED_TARGET_HOSTS` can limit targets to the registered pod hosts.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8080` | Listening port |
| `GROQ_API_KEY`, `GROQ_MODEL` | unset, `llama-3.1-8b-instant` | Turn on optional AI rewording of fixes |
| `LIVE_COVERAGE` | on | `off` disables live code coverage |
| `FAULT_INJECTION` | on (needs a live test session) | `off` ignores `X-Test-Fault` entirely |
| `ALLOW_PRIVATE_TARGETS` | unset | `true` lets the tester call loopback/private addresses (local development, tests) |
| `ALLOWED_TARGET_HOSTS` | unset | Comma-separated host names the tester may target |
| `OWN_SYSTEM_URLS` | unset | Extra addresses of our own system, for `coverage.model` |

## CI and deployment

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and push to main: ESLint (zero warnings), OpenAPI validation, `npm audit` (high and critical), and the full test suite with coverage. Turn on branch protection for `main` requiring the **Lint, scan, contract, tests** check so failures block merges.

**Hosting:** Google Cloud Run (project `phase-3-511821`, region `europe-west1`, service `accessassist-git`). Google Cloud Build watches this repo and deploys every push to `main`. The [`live-check`](.github/workflows/live-check.yml) workflow then waits for that deploy and runs the full suite against the live address.

Live system: https://accessassist-git-365255122806.europe-west1.run.app/system
Live tester: https://accessassist-git-365255122806.europe-west1.run.app/tester

The service scales to zero when idle, so the first request after a quiet period takes a few extra seconds while it starts.

## Data handling

Uploads are held in memory for one request and dropped once the answer is sent. Nothing is written to disk or a database. Keys belong in Google Secret Manager or GitHub secrets, never in this repo (`.env` is git-ignored). Each request logs one JSON line (method, path, status, error code, latency, version), visible in Cloud Run Logs.

## Known limitations

- Checks are limited to the eight criteria above. A clean result means none of *those* problems were found, which the response states; it is not a full WCAG audit, and judgment calls (is this alt text meaningful? does this chart rely on color?) still need a person.
- HTML contrast uses inline styles and `<style>` blocks only; linked stylesheets, CSS variables and text over images are not evaluated. PDF contrast and reading order are not checked. Word colors set through styles (not directly on text) are not checked.
- Word locations are paragraph numbers, not page numbers, because .docx files have no fixed pages.
- Long runs of letters, digits or spaces in HTML (padding, base64-embedded images) are shortened before parsing, so a 10 MB file of that kind needs little memory. HTML pages over 150,000 elements or nested over 1,000 levels are refused with 422 rather than evaluated; at those limits one evaluation peaks at about 550 MB, so keep the Cloud Run service at 1 GiB or more and its concurrency modest.
- Test sessions live in memory and reset when the service restarts.
- Live code coverage is shared by sessions that run at the same time.
- The tester checks a target's DNS answer at setup; it does not pin that address for the later calls of the run.
