// Optional AI-written remediation wording through Groq (Phase 2 Decision 1, Risk 1 fallback).
// Detection and the WCAG mapping are always rule-based; Groq only rewrites each issue's
// suggested_fix into more specific guidance. It is OFF unless GROQ_API_KEY is set (in
// Cloud Run, from Secret Manager). Every issue already carries a complete rule-written fix,
// so if Groq is slow, rate-limited or returns something unusable, that fix is kept and the
// evaluation is still complete (REQ-09 is not triggered by an optional enhancer).

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const TIMEOUT_MS = 8_000; // keeps the whole request well inside the 30 s limit (REQ-12)
const MAX_ISSUES = 25; // bound cost and latency; the rest keep their rule-written fix
const MIN_LEN = 20;
const MAX_LEN = 600;

const SYSTEM_PROMPT = [
  'You help university faculty fix accessibility problems in course documents (WCAG 2.1 AA).',
  'For each numbered issue, rewrite the suggested fix as one or two plain-language sentences a non-expert can follow,',
  'specific to the snippet when one is given. Do not change the WCAG criterion, do not invent new problems,',
  'and do not claim the document will be fully compliant.',
  'Reply with JSON only: {"fixes":[{"id":<number>,"fix":"<text>"}]}.',
].join(' ');

export function remediationEnabled() {
  return Boolean(process.env.GROQ_API_KEY);
}

function acceptable(text) {
  return typeof text === 'string' && text.trim().length >= MIN_LEN && text.trim().length <= MAX_LEN && !/<\s*script/i.test(text);
}

// Returns a new issues array. Never throws: any failure leaves the rule-written fixes in place.
export async function improveFixes(issues, { fileType, fetchImpl = fetch, log = console } = {}) {
  if (!remediationEnabled() || issues.length === 0) return issues;
  const batch = issues.slice(0, MAX_ISSUES).map((i, id) => ({
    id,
    wcag_criterion: i.wcag_criterion,
    problem: i.description,
    current_fix: i.suggested_fix,
    // Only the short markup snippet (at most ~120 characters) leaves the service, never the file (REQ-10).
    snippet: i.location?.snippet?.slice(0, 120),
  }));
  try {
    const res = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ file_type: fileType, issues: batch }) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Groq answered HTTP ${res.status}`);
    const body = await res.json();
    const parsed = JSON.parse(body?.choices?.[0]?.message?.content ?? '{}');
    const fixes = new Map((Array.isArray(parsed.fixes) ? parsed.fixes : []).map((f) => [f?.id, f?.fix]));
    let improved = 0;
    const out = issues.map((issue, id) => {
      const fix = fixes.get(id);
      if (id >= MAX_ISSUES || !acceptable(fix)) return issue;
      improved++;
      return { ...issue, suggested_fix: fix.trim() };
    });
    log.log(JSON.stringify({ severity: 'INFO', message: 'groq remediation applied', improved, total: issues.length }));
    return out;
  } catch (e) {
    log.log(JSON.stringify({ severity: 'WARNING', message: 'groq remediation unavailable; kept rule-based fixes', error: String(e?.message ?? e) }));
    return issues;
  }
}
