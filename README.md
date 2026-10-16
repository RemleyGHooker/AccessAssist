# AccessAssist (ECE 30861, Team 19, Pod F)

AccessAssist checks course documents against the ADA Title II web rule, which requires public universities' online content and documents to meet WCAG 2.1 Level AA (28 CFR §35.200). Professors upload a file and get back each accessibility problem, the WCAG rule it breaks, and how to fix it.

**Phase 3 status:** the secure intake layer is complete (REQ-01, 02, 03, 11, 13). Two HTML checks run end to end (WCAG 1.1.1 image text alternatives, 3.1.1 page language). Full detection, PDF and Word checks, and AI-written fix suggestions are Phase 4.

## Try it

Open https://accessassist-git-365255122806.europe-west1.run.app in a browser, upload an HTML, PDF or Word file (or click a sample), and see each problem with its WCAG rule and a fix.

## Endpoints

One Cloud Run service hosts both parts, on different paths:

| Part | Base path | Endpoints |
| --- | --- | --- |
| System (pod common interface) | `/system` | `GET /health`, `GET /formats`, `POST /analyze`, `POST /test/setup`, `GET /test/report` |
| Tester (course testing interface) | `/tester` | `POST /test/setup`, `POST /test/run`, `GET /test/report` |

The full contract is in [`openapi.yaml`](openapi.yaml). Errors always look like `{"code": "...", "message": "..."}`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `MISSING_FILE` / `INVALID_WCAG_LEVEL` | No file attached, or `wcag_level` not `A`/`AA` |
| 413 | `FILE_TOO_LARGE` | Over 10 MB (exactly 10 MB is accepted) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Not HTML, PDF or DOCX |
| 422 | `UNPROCESSABLE_FILE` | Empty, cut off, or not really the type it claims |
| 503 | `PROCESSING_UNAVAILABLE` | A required service failed; safe to retry |

**Accepted types:** `text/html`, `application/pdf`, and Word `.docx`. The type comes from the declared MIME type, or the file extension when the type is generic. A file that claims a supported type but whose contents don't match gets 422, not 415.

## Running it

```bash
npm ci
npm start                 # http://localhost:8080/system and /tester
npm test                  # full suite against a fresh local server
BASE_URL=https://<service>.run.app/system npm run test:remote   # same suite against a live system
```

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
| T-05 | Missing alt text reported under 1.1.1 | AC-01, AC-02 |
| T-06, T-07 | Empty file and cut-off PDF rejected with 422 | AC-03 |
| T-08, T-09 | Missing file and `wcag_level=AAA` rejected with 400 | AC-03 |
| T-10, T-11 | 10 MB + 1 byte rejected (413); exactly 10 MB accepted within 30 s | AC-03, AC-12 |
| T-12, T-13 | Health check; plain HTTP refused or redirected | AC-11 |
| T-14 | Every error has `code` + `message`, never `issues` | AC-13 |
| T-15 | Clean file gets an explicit no-violations message | AC-07, AC-08, AC-13 |
| T-16 | Simulated outage returns 503, never partial results (CI only) | AC-09 |

Coverage for the tester's report uses this pod component list: `health`, `formats`, `validation`, `analyze`, `test-interface`.

## CI and deployment

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and push to main: ESLint (zero warnings), OpenAPI validation, `npm audit` (high and critical), and the full test suite with coverage. Turn on branch protection for `main` requiring the **Lint, scan, contract, tests** check so failures block merges.

**Hosting:** Google Cloud Run (project `phase-3-511821`, region `europe-west1`, service `accessassist-git`). Google Cloud Build watches this repo and deploys every push to `main`. The [`live-check`](.github/workflows/live-check.yml) workflow then waits for that deploy and runs the full suite against the live address.

Live system: https://accessassist-git-365255122806.europe-west1.run.app/system
Live tester: https://accessassist-git-365255122806.europe-west1.run.app/tester

The service scales to zero when idle, so the first request after a quiet period takes a few extra seconds while it starts.

## Data handling

Uploads are held in memory for one request and dropped once the answer is sent. Nothing is written to disk or a database. Keys belong in Google Secret Manager or GitHub secrets, never in this repo (`.env` is git-ignored). Each request logs one JSON line (method, path, status, error code, latency, version), visible in Cloud Run Logs.

## Known limitations

- Only two HTML checks exist yet. PDF and Word files are accepted, but the response says no evaluation was performed (`checks_run: []`), so it is never mistaken for a pass.
- Test sessions live in memory and reset when the service restarts.
- `/system/test/report` returns `null` code coverage with a reason; CI reports line coverage for every commit.
