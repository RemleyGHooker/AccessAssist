// Accessibility analyzer (Phase 4: REQ-04 to REQ-08).
// Each supported file type has a rule set in src/checks/. Rules are deterministic: they
// detect the problem, map it to one WCAG 2.1 criterion (src/criteria.js), say where it is,
// and write a fix. Groq may reword the fixes afterwards (src/remediation.js), but it never
// decides what is reported.

import { MAX_ISSUES_PER_CRITERION, runRules } from './criteria.js';
import { htmlRules, loadHtml } from './checks/html.js';
import { loadPdf, pdfRules, UnreadablePdfError } from './checks/pdf.js';
import { docxRules, loadDocx, UnreadableDocxError } from './checks/docx.js';
import { improveFixes } from './remediation.js';

export class DependencyUnavailableError extends Error {}
// The file passed the intake checks but turned out to be unreadable once parsed (-> 422, REQ-03).
export class UnprocessableFileError extends Error {}

export const NO_VIOLATIONS =
  'No supported violations were detected. This does not certify full ADA or WCAG compliance.';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ENGINES = {
  'text/html': { load: async (buf) => loadHtml(buf), rules: htmlRules, label: 'html' },
  'application/pdf': { load: loadPdf, rules: pdfRules, label: 'pdf' },
  [DOCX]: { load: async (buf) => loadDocx(buf), rules: docxRules, label: 'docx' },
};

export async function analyze({ mime, buffer, wcagLevel }) {
  if (process.env.SIMULATE_DEPENDENCY_FAILURE === 'true') {
    // Fault injection for REQ-09 tests: behaves like an outside service outage.
    throw new DependencyUnavailableError('Simulated dependency outage');
  }
  const engine = ENGINES[mime];
  if (!engine) throw new Error(`No analyzer for ${mime}`);

  let ctx;
  try {
    ctx = await engine.load(buffer);
  } catch (e) {
    if (e instanceof UnreadablePdfError || e instanceof UnreadableDocxError) throw new UnprocessableFileError(e.message);
    throw e;
  }

  const { issues, checks_run, omitted } = await runRules(engine.rules, ctx, wcagLevel);
  const finalIssues = await improveFixes(issues, { fileType: engine.label });
  const result = { wcag_level: wcagLevel, issues: finalIssues, checks_run, no_violations_detected: finalIssues.length === 0 };
  if (finalIssues.length === 0) result.message = NO_VIOLATIONS;
  const extra = Object.entries(omitted);
  if (extra.length > 0) {
    result.message = `Showing the first ${MAX_ISSUES_PER_CRITERION} issues per criterion. Also found: `
      + extra.map(([c, n]) => `${n} more under ${c}`).join(', ') + '. Fixing the pattern behind the listed issues usually fixes the rest.';
  }
  return result;
}
