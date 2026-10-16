// Accessibility analyzer.
// Phase 3 ships two rule-based checks for HTML so the report format is exercised
// end to end. The full rule set, PDF/Word checks, and AI-written fix suggestions
// arrive in Phase 4 (REQ-04 to REQ-06).

export class DependencyUnavailableError extends Error {}

const NO_CHECKS_YET =
  'This file type was accepted, but automated accessibility checks for it are not available yet. '
  + 'No evaluation was performed, so this is not a compliance result.';

const NO_VIOLATIONS =
  'No supported violations were detected. This does not certify full ADA or WCAG compliance.';

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function checkHtml(text) {
  const issues = [];

  // WCAG 2.1 SC 1.1.1 Non-text Content: every image needs a text alternative.
  for (const match of text.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/i.test(match[0])) {
      issues.push({
        wcag_criterion: '1.1.1',
        location: { line: lineOf(text, match.index), snippet: match[0].slice(0, 120) },
        severity: 'critical',
        description: 'Image has no alt attribute, so screen reader users get no description of it.',
        suggested_fix: 'Add a descriptive alt attribute, or alt="" if the image is purely decorative.',
      });
    }
  }

  // WCAG 2.1 SC 3.1.1 Language of Page: the page must declare its language.
  const htmlTag = text.match(/<html\b[^>]*>/i);
  if (htmlTag && !/\blang\s*=/i.test(htmlTag[0])) {
    issues.push({
      wcag_criterion: '3.1.1',
      location: { line: lineOf(text, htmlTag.index), snippet: htmlTag[0].slice(0, 120) },
      severity: 'serious',
      description: 'The page does not declare its language, so screen readers may mispronounce it.',
      suggested_fix: 'Add a lang attribute to the html element, for example <html lang="en">.',
    });
  }

  return { issues, checks_run: ['1.1.1', '3.1.1'] };
}

export async function analyze({ mime, buffer, wcagLevel }) {
  if (process.env.SIMULATE_DEPENDENCY_FAILURE === 'true') {
    // Fault injection for REQ-09 tests: behaves like an outside service outage.
    throw new DependencyUnavailableError('Simulated dependency outage');
  }

  if (mime !== 'text/html') {
    return { wcag_level: wcagLevel, issues: [], checks_run: [], no_violations_detected: false, message: NO_CHECKS_YET };
  }

  const { issues, checks_run } = checkHtml(buffer.toString('utf8'));
  const result = { wcag_level: wcagLevel, issues, checks_run, no_violations_detected: issues.length === 0 };
  if (issues.length === 0) result.message = NO_VIOLATIONS;
  return result;
}
