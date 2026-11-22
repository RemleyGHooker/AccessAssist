# Team 19 design requirements (Phase 5)

<!-- Generated from src/design.js by `npm run design:doc`. Do not edit by hand; CI fails if this file is out of date. -->

**Design version:** Team 19 design v5.0 (Phase 5: Figure 1 request workflow and state model, Figure 2 architecture).

Each design requirement is one element of our design models. When our tester runs against our own system, `coverage.model` in its report counts how many of these were evaluated by at least one executed test (pass or fail). Tests are defined in [`src/cases.js`](../src/cases.js). Requirements with no tests in the suite are listed honestly and counted as not covered.

| ID | Model element | Design requirement | Pod requirements | Tests |
| --- | --- | --- | --- | --- |
| DR-01 | Figure 1, intake checkpoint 1 | Size is checked while the file uploads: over 10 MB ends in 413 FILE_TOO_LARGE before anything else; exactly 10 MB continues. | REQ-02, REQ-12 | T-10, T-11 |
| DR-02 | Figure 1, intake checkpoint 2 | A request with no file, or a wcag_level other than A or AA, ends in 400 (MISSING_FILE / INVALID_WCAG_LEVEL). | REQ-01, REQ-13 | T-08, T-09 |
| DR-03 | Figure 1, intake checkpoint 3 | The type comes from the declared MIME type (extension when generic); anything other than HTML, PDF or DOCX ends in 415. | REQ-02 | T-04 |
| DR-04 | Figure 1, intake checkpoint 4 | An empty file, or one whose bytes do not match its type, ends in 422 UNPROCESSABLE_FILE before evaluation. | REQ-03 | T-06, T-07 |
| DR-05 | Figure 1, Parsing by type | A file that passes intake but cannot be parsed exits Parsing with 422, not 503. | REQ-03 | T-25 |
| DR-06 | Figure 1, Parsing by type (Phase 5 complexity guard) | An HTML page over 150,000 elements or nested over 1,000 levels exits with 422 before the full parse, within 30 s, instead of exhausting memory or the stack. | REQ-03, REQ-12 | T-30, T-31 |
| DR-07 | Figure 1, Running WCAG rules | wcag_level=A runs only the Level A rows of the criteria table; AA runs all rows. | REQ-04 | T-26 |
| DR-08 | Figure 2, criteria table (criteria.js) | Every issue is reported under one of the eight agreed criteria, and checks_run lists exactly the criteria that the file type's rule set runs at the requested level. | REQ-04, REQ-05 | T-34 |
| DR-09 | Figure 1, end state "issue list" | Each issue carries its criterion, a location where one exists, a severity, a description and a fix; fixtures report exactly their known criteria. | REQ-05, REQ-06, REQ-07 | T-05, T-17, T-18, T-19, T-20, T-22, T-23, T-27 |
| DR-10 | Figure 1, end state "no violations" | A file with no detected problems gets an empty issues array and the explicit no-violations message, in every format. | REQ-08 | T-15, T-21, T-24, T-28 |
| DR-11 | Figure 1, Rewording fixes (optional Groq step) | Groq may only reword suggested_fix; if it fails, the rule-written fix is kept and the evaluation still completes. | REQ-06, REQ-09 | none in the suite (CI unit tests in test/analyzer.test.js only; needs a Groq key) |
| DR-12 | Figure 1, exit "processing failure" (dependency) | When a required service is unavailable, the answer is 503 PROCESSING_UNAVAILABLE with no issues. | REQ-09, REQ-13 | T-16 |
| DR-13 | Figure 1, exit "processing failure" (rule crash, Phase 5) | When evaluation fails after some rules already found issues, the answer is still 503 with no issues, never partial results. | REQ-09, REQ-13 | T-29 |
| DR-14 | Figure 2, in-memory upload handling | Uploads live in memory for one request only, and answers are marked Cache-Control: no-store so no copy is kept downstream. | REQ-10 | T-32 |
| DR-15 | Figure 2, test interface and live coverage | System /test/report returns well-formed code coverage for the tester's session without running project operations. | course testing interface | T-33 |
| DR-16 | Figure 2, system router (health and formats) | GET /health answers {"status":"ok"} and GET /formats publishes the accepted types and a limit of at least 10 MB. | REQ-02, REQ-13 | T-03, T-12 |
