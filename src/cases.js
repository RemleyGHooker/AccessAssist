// The Team 19 test suite. One list of tests drives both the CI run (npm test)
// and the deployed tester service (POST /tester/test/run), so they never drift apart.
// Expected answers come from the pod contract (Phase 2, Sections 5.1 and 5.2),
// not from what our own system happens to return.

import { fixtures } from './fixtures.js';

const ERROR_CODES = { 400: ['MISSING_FILE', 'INVALID_WCAG_LEVEL'], 413: ['FILE_TOO_LARGE'], 415: ['UNSUPPORTED_MEDIA_TYPE'], 422: ['UNPROCESSABLE_FILE'], 503: ['PROCESSING_UNAVAILABLE'] };
const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];

const TIMEOUT_MS = 30_000; // REQ-12 limit

// The target answered with a server failure (HTTP 5xx) where the contract defines no such answer.
// That is an error in the system under test, not a failed check (course testing interface).
export class TargetServerError extends Error {}

async function call(base, path, init = {}, { allowServerError = false } = {}) {
  const started = Date.now();
  const res = await fetch(base.replace(/\/$/, '') + path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON body is itself a conformance failure */ }
  if (res.status >= 500 && !allowServerError) {
    throw new TargetServerError(`Target answered HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body, ms: Date.now() - started };
}

function analyze(base, fixture, fields = {}, options = {}) {
  const form = new FormData();
  if (fixture) form.append('file', new Blob([fixture.data], { type: fixture.type }), fixture.name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return call(base, '/analyze', { method: 'POST', body: form }, options);
}

// ---- shared assertions ----
const fail = (message) => ({ outcome: 'fail', message });
const pass = (message) => ({ outcome: 'pass', message });

function isError(r, status, code) {
  if (r.status !== status) return fail(`Expected HTTP ${status}; received ${r.status}.`);
  if (!r.body || r.body.code !== code || typeof r.body.message !== 'string' || !r.body.message) {
    return fail(`Expected error body with code ${code} and a message; received ${JSON.stringify(r.body)}.`);
  }
  if ('issues' in r.body) return fail('Error response must not contain an issues array.');
  return pass(`Expected ${status} ${code}; received ${status} ${code}.`);
}

function validIssue(i) {
  return typeof i.wcag_criterion === 'string' && /^\d+\.\d+\.\d+$/.test(i.wcag_criterion)
    && (i.location === null || typeof i.location === 'object')
    && SEVERITIES.includes(i.severity)
    && typeof i.description === 'string' && i.description.length > 0
    && typeof i.suggested_fix === 'string' && i.suggested_fix.length > 0;
}

function isResult(r) {
  if (r.status !== 200) return fail(`Expected HTTP 200; received ${r.status} ${JSON.stringify(r.body)}.`);
  if (!r.body || !Array.isArray(r.body.issues)) return fail('Expected an issues array.');
  if ('code' in r.body) return fail('Successful response must not contain an error code.');
  if (!r.body.issues.every(validIssue)) return fail('An issue is missing a required field or has an invalid value.');
  if (r.body.issues.length === 0 && typeof r.body.message !== 'string') {
    return fail('An empty issues array must come with an explicit message (REQ-08).');
  }
  return pass(`Received 200 with ${r.body.issues.length} issue(s) in the contract format.`);
}

const criteriaOf = (r) => [...new Set(r.body.issues.map((i) => i.wcag_criterion))].sort();

// The fixture has exactly the listed problems, so the report must name exactly these criteria:
// a missing one is a missed violation, an extra one is a false positive (AC-04, AC-05).
async function expectExactly(b, fixture, expected, fields) {
  return exactly(await analyze(b, fixture, fields), expected);
}

function exactly(r, expected) {
  const base = isResult(r);
  if (base.outcome !== 'pass') return base;
  const got = criteriaOf(r);
  const want = [...expected].sort();
  return JSON.stringify(got) === JSON.stringify(want)
    ? pass(`Expected criteria ${want.join(', ')}; received ${got.join(', ')}.`)
    : fail(`Expected criteria [${want.join(', ')}]; received [${got.join(', ')}] ${JSON.stringify(r.body.issues.map((i) => i.description))}.`);
}

async function expectClean(b, fixture) {
  const r = await analyze(b, fixture);
  const base = isResult(r);
  if (base.outcome !== 'pass') return base;
  return r.body.issues.length === 0 && /no supported violations/i.test(r.body.message ?? '')
    ? pass('Received an empty issues array with an explicit no-violations message.')
    : fail(`Expected no issues and an explicit no-violations message; received ${JSON.stringify(r.body)}.`);
}

const hasLocation = (i) => i.location !== null && typeof i.location === 'object'
  && ['selector', 'line', 'page', 'snippet'].some((k) => i.location[k] !== undefined && i.location[k] !== '');

// ---- the suite ----
// local: true means the test needs control of the server process (fault injection) and
// only runs in CI, never against another team's deployed service.
export const cases = [
  { id: 'T-01', ac: ['AC-01'], component: 'analyze', name: 'Accessible HTML file is accepted and evaluated',
    run: async (b) => isResult(await analyze(b, fixtures.accessibleHtml)) },
  { id: 'T-02', ac: ['AC-01'], component: 'analyze', name: 'Valid PDF is accepted',
    run: async (b) => isResult(await analyze(b, fixtures.validPdf)) },
  { id: 'T-03', ac: ['AC-02'], component: 'formats', name: 'GET /formats lists types and a limit of at least 10 MB',
    run: async (b) => {
      const r = await call(b, '/formats');
      if (r.status !== 200) return fail(`Expected 200; received ${r.status}.`);
      const ok = Array.isArray(r.body?.supported_mime_types) && r.body.supported_mime_types.length > 0
        && typeof r.body.max_file_size_mb === 'number' && r.body.max_file_size_mb >= 10;
      return ok ? pass('Received a non-empty type list and max_file_size_mb >= 10.') : fail(`Unexpected body ${JSON.stringify(r.body)}.`);
    } },
  { id: 'T-04', ac: ['AC-02'], component: 'validation', name: 'Executable file is rejected as unsupported (415)',
    run: async (b) => isError(await analyze(b, fixtures.executable), 415, 'UNSUPPORTED_MEDIA_TYPE') },
  { id: 'T-05', ac: ['AC-04', 'AC-05', 'AC-06', 'AC-07'], component: 'analyze', name: 'HTML with a missing alt attribute is reported under 1.1.1',
    run: async (b) => {
      const r = await analyze(b, fixtures.missingAltHtml);
      const base = isResult(r);
      if (base.outcome !== 'pass') return base;
      return r.body.issues.some((i) => i.wcag_criterion === '1.1.1')
        ? pass('Expected a 1.1.1 issue; received one.')
        : fail('Expected an issue with wcag_criterion 1.1.1; none was reported.');
    } },
  { id: 'T-06', ac: ['AC-03'], component: 'validation', name: 'Empty file is rejected (422)',
    run: async (b) => isError(await analyze(b, fixtures.emptyFile), 422, 'UNPROCESSABLE_FILE') },
  { id: 'T-07', ac: ['AC-03'], component: 'validation', name: 'Truncated PDF is rejected (422)',
    run: async (b) => isError(await analyze(b, fixtures.truncatedPdf), 422, 'UNPROCESSABLE_FILE') },
  { id: 'T-08', ac: ['AC-13'], component: 'validation', name: 'Request with no file is rejected (400)',
    run: async (b) => isError(await analyze(b, null, { wcag_level: 'AA' }), 400, 'MISSING_FILE') },
  { id: 'T-09', ac: ['AC-13'], component: 'validation', name: 'wcag_level "AAA" is rejected (400)',
    run: async (b) => isError(await analyze(b, fixtures.accessibleHtml, { wcag_level: 'AAA' }), 400, 'INVALID_WCAG_LEVEL') },
  { id: 'T-10', ac: ['AC-02'], component: 'validation', name: 'File one byte over 10 MB is rejected (413)',
    run: async (b) => isError(await analyze(b, fixtures.overMaxSize), 413, 'FILE_TOO_LARGE') },
  { id: 'T-11', ac: ['AC-02', 'AC-12'], component: 'analyze', name: 'File of exactly 10 MB is accepted within 30 s',
    run: async (b) => {
      const r = await analyze(b, fixtures.exactlyMaxSize);
      const base = isResult(r);
      if (base.outcome !== 'pass') return base;
      return r.ms <= TIMEOUT_MS ? pass(`Accepted in ${r.ms} ms.`) : fail(`Took ${r.ms} ms, over the 30 s limit.`);
    } },
  { id: 'T-12', ac: ['AC-13'], component: 'health', name: 'GET /health answers {"status":"ok"}',
    run: async (b) => {
      const r = await call(b, '/health');
      return r.status === 200 && r.body?.status === 'ok' ? pass('Received 200 {"status":"ok"}.') : fail(`Received ${r.status} ${JSON.stringify(r.body)}.`);
    } },
  { id: 'T-13', ac: ['AC-11'], component: 'health', name: 'Plain HTTP is refused or redirected to HTTPS',
    run: async (b) => {
      if (!b.startsWith('https://')) return { outcome: 'skip', message: 'Target is not served over HTTPS (local run); check applies to deployed services only.' };
      try {
        const res = await fetch(b.replace(/^https:/, 'http:') + '/health', { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
        const loc = res.headers.get('location') ?? '';
        return res.status >= 300 && res.status < 400 && loc.startsWith('https://')
          ? pass(`Plain HTTP redirected to HTTPS (${res.status}).`)
          : fail(`Plain HTTP answered ${res.status} without redirecting to HTTPS.`);
      } catch {
        return pass('Plain HTTP connection was refused.');
      }
    } },
  { id: 'T-14', ac: ['AC-13'], component: 'validation', name: 'Every error has code and message and never issues',
    run: async (b) => {
      const checks = [
        [await analyze(b, fixtures.executable), 415],
        [await analyze(b, fixtures.emptyFile), 422],
        [await analyze(b, null, {}), 400],
      ];
      for (const [r, status] of checks) {
        if (r.status !== status || !ERROR_CODES[status].includes(r.body?.code) || !r.body?.message || 'issues' in (r.body ?? {})) {
          return fail(`Inconsistent error response: ${r.status} ${JSON.stringify(r.body)}.`);
        }
      }
      return pass('All three error responses share the { code, message } shape with no issues array.');
    } },
  { id: 'T-15', ac: ['AC-08', 'AC-13'], component: 'analyze', name: 'Clean file gets an explicit no-violations message',
    run: async (b) => {
      const r = await analyze(b, fixtures.accessibleHtml);
      const base = isResult(r);
      if (base.outcome !== 'pass') return base;
      return r.body.issues.length === 0 && /no supported violations/i.test(r.body.message ?? '')
        ? pass('Received an empty issues array with an explicit no-violations message.')
        : fail(`Expected an explicit no-violations message; received ${JSON.stringify(r.body)}.`);
    } },
  { id: 'T-16', ac: ['AC-09'], component: 'analyze', name: 'Dependency outage returns 503, never partial results', local: true,
    run: async (b) => isError(await analyze(b, fixtures.missingAltHtml, {}, { allowServerError: true }), 503, 'PROCESSING_UNAVAILABLE') },

  // ---- Phase 4: the evaluation engine (REQ-04 to REQ-08) ----
  { id: 'T-17', ac: ['AC-04', 'AC-05'], component: 'analyze', name: 'HTML text below 4.5:1 contrast is reported under 1.4.3',
    run: async (b) => expectExactly(b, fixtures.lowContrastHtml, ['1.4.3']) },
  { id: 'T-18', ac: ['AC-04', 'AC-05'], component: 'analyze', name: 'HTML heading that skips a level is reported under 1.3.1',
    run: async (b) => expectExactly(b, fixtures.headingSkipHtml, ['1.3.1']) },
  { id: 'T-19', ac: ['AC-04', 'AC-05'], component: 'analyze', name: 'HTML with no page language and no title is reported under 3.1.1 and 2.4.2',
    run: async (b) => expectExactly(b, fixtures.noLangNoTitleHtml, ['2.4.2', '3.1.1']) },
  { id: 'T-20', ac: ['AC-04', 'AC-05', 'AC-06', 'AC-07'], component: 'analyze', name: 'Word image with no alt text is reported under 1.1.1',
    run: async (b) => expectExactly(b, fixtures.missingAltDocx, ['1.1.1']) },
  { id: 'T-21', ac: ['AC-08'], component: 'analyze', name: 'Accessible Word file gets an explicit no-violations message',
    run: async (b) => expectClean(b, fixtures.accessibleDocx) },
  { id: 'T-22', ac: ['AC-04', 'AC-05'], component: 'analyze', name: 'Untagged PDF is reported under 1.3.1',
    run: async (b) => {
      const r = await analyze(b, fixtures.untaggedPdf);
      const base = isResult(r);
      if (base.outcome !== 'pass') return base;
      return criteriaOf(r).includes('1.3.1')
        ? pass('Expected a 1.3.1 issue for the untagged PDF; received one.')
        : fail(`Expected an issue with wcag_criterion 1.3.1; received [${criteriaOf(r).join(', ')}].`);
    } },
  { id: 'T-23', ac: ['AC-04', 'AC-05', 'AC-07'], component: 'analyze', name: 'Tagged PDF figure with no alt text is reported under 1.1.1 on page 1',
    run: async (b) => {
      const r = await analyze(b, fixtures.figureNoAltPdf);
      const exact = exactly(r, ['1.1.1']);
      if (exact.outcome !== 'pass') return exact;
      return r.body.issues[0]?.location?.page === 1
        ? pass('Received a 1.1.1 issue located on page 1.')
        : fail(`Expected location.page 1; received ${JSON.stringify(r.body.issues[0]?.location)}.`);
    } },
  { id: 'T-24', ac: ['AC-08'], component: 'analyze', name: 'Accessible tagged PDF gets an explicit no-violations message',
    run: async (b) => expectClean(b, fixtures.accessiblePdf) },
  { id: 'T-25', ac: ['AC-03'], component: 'validation', name: 'Corrupt Word file is rejected (422), never evaluated',
    run: async (b) => isError(await analyze(b, fixtures.corruptDocx), 422, 'UNPROCESSABLE_FILE') },
  { id: 'T-26', ac: ['AC-04', 'AC-13'], component: 'analyze', name: 'wcag_level=A leaves out Level AA criteria such as 1.4.3',
    run: async (b) => {
      const aa = await analyze(b, fixtures.lowContrastHtml, { wcag_level: 'AA' });
      const a = await analyze(b, fixtures.lowContrastHtml, { wcag_level: 'A' });
      for (const r of [aa, a]) { const base = isResult(r); if (base.outcome !== 'pass') return base; }
      if (!criteriaOf(aa).includes('1.4.3')) return fail('Expected 1.4.3 at level AA; it was not reported.');
      return criteriaOf(a).includes('1.4.3')
        ? fail('1.4.3 is a Level AA criterion but was reported for wcag_level=A.')
        : pass('1.4.3 reported at AA and left out at A.');
    } },
  { id: 'T-27', ac: ['AC-06', 'AC-07'], component: 'analyze', name: 'Every issue in a page with five problems has a location and a fix',
    run: async (b) => {
      const r = await analyze(b, fixtures.manyProblemsHtml);
      const base = isResult(r);
      if (base.outcome !== 'pass') return base;
      const want = ['1.1.1', '1.3.1', '1.4.3', '2.4.4'];
      const missing = want.filter((c) => !criteriaOf(r).includes(c));
      if (missing.length) return fail(`Expected issues under ${missing.join(', ')}; none reported.`);
      if (!r.body.issues.some((i) => ['1.3.1', '3.3.2', '4.1.2'].includes(i.wcag_criterion) && /label|name/i.test(i.description))) {
        return fail('Expected the unlabeled form field to be reported (1.3.1, 3.3.2 or 4.1.2).');
      }
      const unlocated = r.body.issues.filter((i) => !hasLocation(i));
      return unlocated.length === 0
        ? pass(`All ${r.body.issues.length} issues name a location and carry a fix.`)
        : fail(`${unlocated.length} issue(s) have no location: ${JSON.stringify(unlocated)}.`);
    } },
  { id: 'T-28', ac: ['AC-04', 'AC-08'], component: 'analyze', name: 'Accessible page with tables, forms and links has no false positives',
    run: async (b) => expectClean(b, fixtures.richAccessibleHtml) },
];

// Pod component list used for component coverage (proposed to the pod in Phase 3).
export const COMPONENTS = ['health', 'formats', 'validation', 'analyze', 'test-interface'];
export const TOTAL_ACCEPTANCE_CRITERIA = 13; // AC-01 to AC-13

export async function runCase(c, base) {
  try {
    return await c.run(base);
  } catch (e) {
    if (e instanceof TargetServerError) return { outcome: 'error', source: 'system', message: `${c.name}: ${e.message}` };
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { outcome: 'error', source: timeout || e?.cause ? 'communication' : 'tester', message: `${c.name}: ${e?.message ?? e}` };
  }
}
