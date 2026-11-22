// Accessibility analyzer (Phase 4: REQ-04 to REQ-08; Phase 5: REQ-09, REQ-12).
// Each supported file type has a rule set in src/checks/. Rules are deterministic: they
// detect the problem, map it to one WCAG 2.1 criterion (src/criteria.js), say where it is,
// and write a fix. Groq may reword the fixes afterwards (src/remediation.js), but it never
// decides what is reported.
//
// Failure paths (Phase 5 design, Figure 1):
//   - the file cannot be parsed, or is too complex to evaluate safely -> UnprocessableFileError (422, REQ-03)
//   - a required service is unavailable                                -> DependencyUnavailableError (503, REQ-09)
//   - anything else goes wrong while evaluating                       -> EvaluationFailedError (503, REQ-09)
// In every failure case no issues are returned, so partial results are never presented as a
// finished evaluation.

import { MAX_ISSUES_PER_CRITERION, runRules } from './criteria.js';
import { htmlRules, loadHtml, UnreadableHtmlError } from './checks/html.js';
import { loadPdf, pdfRules, UnreadablePdfError } from './checks/pdf.js';
import { docxRules, loadDocx, UnreadableDocxError } from './checks/docx.js';
import { improveFixes } from './remediation.js';

export class DependencyUnavailableError extends Error {}
// The file passed the intake checks but turned out to be unreadable once parsed (-> 422, REQ-03).
// `reason` is safe to show the caller; it never contains file content.
export class UnprocessableFileError extends Error {
  constructor(message, { reason } = {}) { super(message); this.reason = reason; }
}
// An unexpected failure inside the evaluation itself (a rule or parser crash). It is logged with
// its stack trace and reported as 503 without any issues (REQ-09).
export class EvaluationFailedError extends Error {}

// Test-only fault injection (REQ-09 / AC-09). src/system.js only passes a fault for a request
// that names a live test session, so ordinary uploads can never trigger one.
export const FAULTS = ['dependency-unavailable', 'evaluation-crash'];

export const NO_VIOLATIONS =
  'No supported violations were detected. This does not certify full ADA or WCAG compliance.';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ENGINES = {
  'text/html': { load: async (buf) => loadHtml(buf), rules: htmlRules, label: 'html' },
  'application/pdf': { load: loadPdf, rules: pdfRules, label: 'pdf' },
  [DOCX]: { load: async (buf) => loadDocx(buf), rules: docxRules, label: 'docx' },
};

// For the evaluation-crash fault: a rule that fails after the first real rule has already found
// issues, which is exactly the situation where partial results could leak out.
function withCrash(rules) {
  const [first, ...rest] = rules;
  const crash = { criterion: first.criterion, run: () => { throw new Error('Simulated rule crash (test fault injection)'); } };
  return [first, crash, ...rest];
}

export async function analyze({ mime, buffer, wcagLevel, fault = null }) {
  if (fault === 'dependency-unavailable') {
    // Behaves like an outside service outage before evaluation starts.
    throw new DependencyUnavailableError('Simulated dependency outage (test fault injection)');
  }
  const engine = ENGINES[mime];
  if (!engine) throw new Error(`No analyzer for ${mime}`);

  let ctx;
  try {
    ctx = await engine.load(buffer);
  } catch (e) {
    if (e instanceof UnreadableHtmlError) throw new UnprocessableFileError(e.message, { reason: e.message });
    if (e instanceof UnreadablePdfError || e instanceof UnreadableDocxError) throw new UnprocessableFileError(e.message);
    throw new EvaluationFailedError(`Parser failed: ${e?.message ?? e}`, { cause: e });
  }

  try {
    const rules = fault === 'evaluation-crash' ? withCrash(engine.rules) : engine.rules;
    const { issues, checks_run, omitted } = await runRules(rules, ctx, wcagLevel);
    const finalIssues = await improveFixes(issues, { fileType: engine.label });
    const result = { wcag_level: wcagLevel, issues: finalIssues, checks_run, no_violations_detected: finalIssues.length === 0 };
    if (finalIssues.length === 0) result.message = NO_VIOLATIONS;
    const extra = Object.entries(omitted);
    if (extra.length > 0) {
      result.message = `Showing the first ${MAX_ISSUES_PER_CRITERION} issues per criterion. Also found: `
        + extra.map(([c, n]) => `${n} more under ${c}`).join(', ') + '. Fixing the pattern behind the listed issues usually fixes the rest.';
    }
    return result;
  } catch (e) {
    if (e instanceof DependencyUnavailableError) throw e;
    throw new EvaluationFailedError(`Evaluation failed: ${e?.message ?? e}`, { cause: e });
  }
}
