# AccessAssist (ECE 30861, Team 19, Pod F)

AccessAssist checks course documents against the ADA Title II web rule, which requires public universities' online content and documents to meet WCAG 2.1 Level AA (28 CFR §35.200). Professors upload a file and get back each accessibility problem, the WCAG rule it breaks, and how to fix it.

**Phase 4 status:** the evaluation engine is in place (REQ-04 to REQ-08) on top of the Phase 3 intake layer (REQ-01, 02, 03, 11, 13). HTML, PDF and Word files are all checked against a bounded set of eight WCAG 2.1 criteria; every issue names its criterion, location, severity and a fix, and a clean file gets an explicit no-violations message. Optional Groq rewording of fixes is built in and off until a key is configured.

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
| 422 | `UNPROCESSABLE_FILE` | Empty, cut off, not really the type it claims, or fails to parse during analysis |
| 503 | `PROCESSING_UNAVAILABLE` | A required service failed; safe to retry |

**Accepted types:** `text/html`, `application/pdf`, and Word `.docx`. The type comes from the declared MIME type, or the file extension when the type is generic. A file that claims a supported type but whose contents don't match gets 422, not 415.

## Running it

```bash
npm ci
npm start                 # http://localhost:8080/system and /tester
npm test                  # full suite against a fresh local server
BASE_URL=https://<service>.run.app/system npm run test:remote   # same suite against a live system
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
| T-16 | Simulated outage returns 503, never partial results (CI only) | AC-09 |
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

Fixtures that should produce specific criteria are checked for *exactly* those criteria, so both missed violations and false positives fail. [`test/analyzer.test.js`](test/analyzer.test.js) adds unit tests for each rule (contrast math, decorative images, RoleMap figures, Word highlights, Groq fallback, and so on). The fix wording itself (AC-06 quality) still needs human review against the pod rubric.

Coverage for the tester's report uses this pod component list: `health`, `formats`, `validation`, `analyze`, `test-interface`.

**Live code coverage.** `POST /system/test/setup` starts V8's built-in precise coverage (or resets it), and `GET /system/test/report` returns how many executable lines of the system's own source files ran since then. Sessions that overlap in time share counters. It is off when c8 is measuring (CI) or when `LIVE_COVERAGE=off`.

**Tester error handling.** A target that answers HTTP 5xx where the contract defines no such answer is recorded as `error` with source `system` (not `fail`), and malformed JSON sent to the tester is labeled source `tester`.

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
- Long runs of letters, digits or spaces in HTML (padding, base64-embedded images) are shortened before parsing, so a 10 MB file of that kind needs little memory. A 10 MB page made of hundreds of thousands of real elements still needs close to 1 GB, so give the Cloud Run service at least 1 GiB of memory.
- Test sessions live in memory and reset when the service restarts.
- Live code coverage is shared by sessions that run at the same time.
