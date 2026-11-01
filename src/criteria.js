// The bounded set of WCAG 2.1 success criteria AccessAssist checks (Phase 4, REQ-04/REQ-05).
// Each rule in src/checks/* reports under exactly one of these criteria, so the WCAG mapping
// is fixed in code and never left to an AI model. "level" decides which rules run for
// wcag_level=A (Level A only) versus wcag_level=AA (Level A and AA).

export const CRITERIA = {
  '1.1.1': { name: 'Non-text Content', level: 'A' },
  '1.3.1': { name: 'Info and Relationships', level: 'A' },
  '1.4.3': { name: 'Contrast (Minimum)', level: 'AA' },
  '1.4.5': { name: 'Images of Text', level: 'AA' },
  '2.4.2': { name: 'Page Titled', level: 'A' },
  '2.4.4': { name: 'Link Purpose (In Context)', level: 'A' },
  '3.1.1': { name: 'Language of Page', level: 'A' },
  '4.1.2': { name: 'Name, Role, Value', level: 'A' },
};

export function appliesAt(criterion, wcagLevel) {
  const c = CRITERIA[criterion];
  if (!c) throw new Error(`Unknown WCAG criterion ${criterion}`);
  return wcagLevel === 'AA' || c.level === 'A';
}

// A document with thousands of copies of one problem (a whole page in a light gray) would
// otherwise produce a response of many megabytes. Each criterion reports at most this many
// issues; the result's message says how many more were found.
export const MAX_ISSUES_PER_CRITERION = 50;

// Run the rules that apply at the requested level. Returns the issues found, the criteria
// that were actually checked (checks_run, sorted), and how many issues were left out per criterion.
export async function runRules(rules, ctx, wcagLevel) {
  const active = rules.filter((r) => appliesAt(r.criterion, wcagLevel));
  const issues = [];
  const omitted = {};
  const kept = {};
  for (const rule of active) {
    for (const issue of await rule.run(ctx)) {
      kept[rule.criterion] = (kept[rule.criterion] ?? 0) + 1;
      if (kept[rule.criterion] > MAX_ISSUES_PER_CRITERION) {
        omitted[rule.criterion] = (omitted[rule.criterion] ?? 0) + 1;
        continue;
      }
      // A rule may give its location as a function so it is only worked out for kept issues.
      const location = typeof issue.location === 'function' ? issue.location() : issue.location;
      issues.push({ wcag_criterion: rule.criterion, ...issue, location });
    }
  }
  const checks_run = [...new Set(active.map((r) => r.criterion))].sort(compareCriteria);
  return { issues, checks_run, omitted };
}

export function compareCriteria(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}
