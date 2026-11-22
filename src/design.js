// Team 19 design requirements for Phase 5, used for coverage.model in the tester's report when it
// tests our own system (course spec, "Model coverage"). Each requirement is one element of our
// design models: Figure 1 (request workflow and state model) and Figure 2 (system architecture),
// Phase 5 versions in Diagrams/phase5/. `tests` lists the suite tests (src/cases.js) that evaluate
// it; a requirement counts as covered when at least one of them ran to a pass or fail verdict.
//
// docs/design-requirements.md is generated from this file (npm run design:doc) and a unit test
// fails if the two disagree, or if a requirement names a test that does not exist.

export const DESIGN_VERSION = 'Team 19 design v5.0 (Phase 5: Figure 1 request workflow and state model, Figure 2 architecture)';
export const DESIGN_MAPPING_URL = 'https://github.com/RemleyGHooker/AccessAssist/blob/main/docs/design-requirements.md';

export const DESIGN_REQUIREMENTS = [
  { id: 'DR-01', model: 'Figure 1, intake checkpoint 1', reqs: ['REQ-02', 'REQ-12'],
    text: 'Size is checked while the file uploads: over 10 MB ends in 413 FILE_TOO_LARGE before anything else; exactly 10 MB continues.',
    tests: ['T-10', 'T-11'] },
  { id: 'DR-02', model: 'Figure 1, intake checkpoint 2', reqs: ['REQ-01', 'REQ-13'],
    text: 'A request with no file, or a wcag_level other than A or AA, ends in 400 (MISSING_FILE / INVALID_WCAG_LEVEL).',
    tests: ['T-08', 'T-09'] },
  { id: 'DR-03', model: 'Figure 1, intake checkpoint 3', reqs: ['REQ-02'],
    text: 'The type comes from the declared MIME type (extension when generic); anything other than HTML, PDF or DOCX ends in 415.',
    tests: ['T-04'] },
  { id: 'DR-04', model: 'Figure 1, intake checkpoint 4', reqs: ['REQ-03'],
    text: 'An empty file, or one whose bytes do not match its type, ends in 422 UNPROCESSABLE_FILE before evaluation.',
    tests: ['T-06', 'T-07'] },
  { id: 'DR-05', model: 'Figure 1, Parsing by type', reqs: ['REQ-03'],
    text: 'A file that passes intake but cannot be parsed exits Parsing with 422, not 503.',
    tests: ['T-25'] },
  { id: 'DR-06', model: 'Figure 1, Parsing by type (Phase 5 complexity guard)', reqs: ['REQ-03', 'REQ-12'],
    text: 'An HTML page over 150,000 elements or nested over 1,000 levels exits with 422 before the full parse, within 30 s, instead of exhausting memory or the stack.',
    tests: ['T-30', 'T-31'] },
  { id: 'DR-07', model: 'Figure 1, Running WCAG rules', reqs: ['REQ-04'],
    text: 'wcag_level=A runs only the Level A rows of the criteria table; AA runs all rows.',
    tests: ['T-26'] },
  { id: 'DR-08', model: 'Figure 2, criteria table (criteria.js)', reqs: ['REQ-04', 'REQ-05'],
    text: 'Every issue is reported under one of the eight agreed criteria, and checks_run lists exactly the criteria that the file type\'s rule set runs at the requested level.',
    tests: ['T-34'] },
  { id: 'DR-09', model: 'Figure 1, end state "issue list"', reqs: ['REQ-05', 'REQ-06', 'REQ-07'],
    text: 'Each issue carries its criterion, a location where one exists, a severity, a description and a fix; fixtures report exactly their known criteria.',
    tests: ['T-05', 'T-17', 'T-18', 'T-19', 'T-20', 'T-22', 'T-23', 'T-27'] },
  { id: 'DR-10', model: 'Figure 1, end state "no violations"', reqs: ['REQ-08'],
    text: 'A file with no detected problems gets an empty issues array and the explicit no-violations message, in every format.',
    tests: ['T-15', 'T-21', 'T-24', 'T-28'] },
  { id: 'DR-11', model: 'Figure 1, Rewording fixes (optional Groq step)', reqs: ['REQ-06', 'REQ-09'],
    text: 'Groq may only reword suggested_fix; if it fails, the rule-written fix is kept and the evaluation still completes.',
    tests: [] },
  { id: 'DR-12', model: 'Figure 1, exit "processing failure" (dependency)', reqs: ['REQ-09', 'REQ-13'],
    text: 'When a required service is unavailable, the answer is 503 PROCESSING_UNAVAILABLE with no issues.',
    tests: ['T-16'] },
  { id: 'DR-13', model: 'Figure 1, exit "processing failure" (rule crash, Phase 5)', reqs: ['REQ-09', 'REQ-13'],
    text: 'When evaluation fails after some rules already found issues, the answer is still 503 with no issues, never partial results.',
    tests: ['T-29'] },
  { id: 'DR-14', model: 'Figure 2, in-memory upload handling', reqs: ['REQ-10'],
    text: 'Uploads live in memory for one request only, and answers are marked Cache-Control: no-store so no copy is kept downstream.',
    tests: ['T-32'] },
  { id: 'DR-15', model: 'Figure 2, test interface and live coverage', reqs: ['course testing interface'],
    text: 'System /test/report returns well-formed code coverage for the tester\'s session without running project operations.',
    tests: ['T-33'] },
  { id: 'DR-16', model: 'Figure 2, system router (health and formats)', reqs: ['REQ-02', 'REQ-13'],
    text: 'GET /health answers {"status":"ok"} and GET /formats publishes the accepted types and a limit of at least 10 MB.',
    tests: ['T-03', 'T-12'] },
];

// Requirements evaluated by a run: those with at least one mapped test that reached a verdict.
export function modelCoverage(results) {
  const evaluated = new Set(results.filter((r) => r.outcome === 'pass' || r.outcome === 'fail').map((r) => r.test_id));
  const covered = DESIGN_REQUIREMENTS.filter((d) => d.tests.some((t) => evaluated.has(t)));
  const uncovered = DESIGN_REQUIREMENTS.filter((d) => !covered.includes(d)).map((d) => d.id);
  return {
    covered: covered.length,
    total: DESIGN_REQUIREMENTS.length,
    basis: `Design requirements of ${DESIGN_VERSION} evaluated by at least one executed test (pass or fail).`
      + (uncovered.length ? ` Not evaluated in this run: ${uncovered.join(', ')}.` : '')
      + ` Mapping between design requirements and tests: ${DESIGN_MAPPING_URL}`,
  };
}

// Markdown for docs/design-requirements.md.
export function designDoc() {
  const lines = [
    '# Team 19 design requirements (Phase 5)',
    '',
    `<!-- Generated from src/design.js by \`npm run design:doc\`. Do not edit by hand; CI fails if this file is out of date. -->`,
    '',
    `**Design version:** ${DESIGN_VERSION}.`,
    '',
    'Each design requirement is one element of our design models. When our tester runs against our own system, `coverage.model` in its report counts how many of these were evaluated by at least one executed test (pass or fail). Tests are defined in [`src/cases.js`](../src/cases.js). Requirements with no tests in the suite are listed honestly and counted as not covered.',
    '',
    '| ID | Model element | Design requirement | Pod requirements | Tests |',
    '| --- | --- | --- | --- | --- |',
    ...DESIGN_REQUIREMENTS.map((d) => `| ${d.id} | ${d.model} | ${d.text.replace(/\|/g, '\\|')} | ${d.reqs.join(', ')} | ${d.tests.length ? d.tests.join(', ') : 'none in the suite (CI unit tests in test/analyzer.test.js only; needs a Groq key)'} |`),
    '',
  ];
  return lines.join('\n');
}
